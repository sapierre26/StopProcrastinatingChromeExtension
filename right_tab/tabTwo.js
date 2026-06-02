const ASSIGNMENTS_KEY = "canvas_due_tracker_assignments";
const ALPACA_CLICK_SOUND_PATHS = [
  "sounds/alpaca-click-1.mp3",
  "sounds/alpaca-click-2.mp3",
  "sounds/alpaca-click-3.mp3",
  "sounds/alpaca-click-4.mp3",
  "sounds/alpaca-click-5.mp3"
];
const REWARD_TIERS = [
  { label: "Gold", hoursBeforeDue: 48, rewardType: "alpaca", icon: "\u{1F451}", description: "New alpaca friend" },
  { label: "Silver", hoursBeforeDue: 24, rewardType: "customization", icon: "\u{1F338}", description: "Farm decoration" },
  { label: "Bronze", hoursBeforeDue: 1, rewardType: "customization", icon: "\u{1F9E3}", description: "Alpaca accessory" }
];
const CUSTOMIZATION_ITEMS = ["Bright Scarf", "Festival Banner", "Sparkle Saddle", "Cozy Blanket", "Party Hat"];
const ACCESSORY_STYLES = {
  "Bright Scarf": { className: "scarf", icon: "\u{1F9E3}" },
  "Festival Banner": { className: "banner", icon: "\u2691\uFE0F" },
  "Sparkle Saddle": { className: "saddle", icon: "\u2728" },
  "Cozy Blanket": { className: "blanket", icon: "\u{1F7E6}" },
  "Party Hat": { className: "party-hat", icon: "\u{1F389}" }
};

let alpacaAudioContext = null;
let alpacaClickAudioClips = [];

export function initializeTabTwo(root = document) {
  let previousFarmState = null;

  const elements = {
    farmScene: root.querySelector(".farm-scene"),
    weatherIcon: root.querySelector("#weatherIcon"),
    accessory: root.querySelector("#accessory"),
    alpacaContainer: root.querySelector("#alpaca-container"),
    farmMessage: root.querySelector("#farmMessage"),
    assignmentInfo: root.querySelector("#assignmentInfo"),
    farmSummary: root.querySelector("#farmSummary"),
    customizationList: root.querySelector("#customizationList")
  };

  if (!elements.farmScene) {
    console.warn("Farm markup was not found.");
    return;
  }

  prepareAlpacaClickSound();
  renderFromStorage();

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes[ASSIGNMENTS_KEY]) {
      renderFromStorage();
    }
  });

  async function renderFromStorage() {
    const result = await chrome.storage.local.get({ [ASSIGNMENTS_KEY]: {} });
    const assignments = Object.values(result[ASSIGNMENTS_KEY] || {});
    renderFarm(assignments);
  }

  function renderFarm(assignments) {
    const rewardSource = chooseRewardAssignment(assignments);
    const alpacaCount = Math.max(1, 1 + countRewardAssignments(assignments, "Gold"));
    const customizations = buildCustomizationList(assignments);
    let currentReward = { earnedAlpaca: false, weather: "cloudy", accessory: "", message: "", rewardTier: null };

    renderAnimals(alpacaCount, elements.alpacaContainer, customizations);
    renderFarmSummary(alpacaCount, customizations);

    if (!rewardSource) {
      applyReward(currentReward);
      elements.farmMessage.textContent = "Scan Canvas and submit assignments on time to grow your farm.";
      elements.assignmentInfo.textContent = assignments.length
        ? `${assignments.length} assignment${assignments.length === 1 ? "" : "s"} tracked. No completed submissions to reward yet.`
        : "No Canvas assignments have been scanned yet.";
      handleFarmStateChange({ alpacaCount, customizations, reward: currentReward });
      return;
    }

    currentReward = calculateFarmReward(rewardSource);
    applyReward(currentReward);
    elements.farmMessage.textContent = currentReward.message;
    elements.assignmentInfo.textContent = `${rewardSource.title || "Assignment"} - ${rewardSource.course || "Canvas"} - ${currentReward.rewardTier ? currentReward.rewardTier.label : "No reward"}`;
    handleFarmStateChange({ alpacaCount, customizations, reward: currentReward });
  }

  function renderFarmSummary(alpacaCount, customizations) {
    elements.farmSummary.textContent = `Your farm has ${alpacaCount} alpaca${alpacaCount === 1 ? "" : "s"} and ${customizations.length} customization item${customizations.length === 1 ? "" : "s"}.`;
    elements.customizationList.replaceChildren();

    if (!customizations.length) {
      elements.customizationList.textContent = "No customizations earned yet. Earn Silver or Bronze rewards to decorate your alpaca farm.";
      return;
    }

    for (const customization of customizations) {
      const tag = document.createElement("span");
      tag.className = "customization-tag";
      tag.textContent = customization.label;
      elements.customizationList.appendChild(tag);
    }
  }

  function chooseRewardAssignment(assignments) {
    return assignments
      .filter((assignment) => assignment.submitted)
      .sort((a, b) => new Date(b.submittedAt || b.lastSeenAt || 0) - new Date(a.submittedAt || a.lastSeenAt || 0))[0];
  }

  function buildCustomizationList(assignments) {
    const customizationAssignments = assignments
      .map((assignment) => ({ assignment, tier: rewardTierForAssignment(assignment) }))
      .filter(({ tier }) => tier && tier.rewardType === "customization");

    return customizationAssignments.map(({ tier }, index) => {
      const name = CUSTOMIZATION_ITEMS[index % CUSTOMIZATION_ITEMS.length];
      const accessory = ACCESSORY_STYLES[name];

      return {
        name,
        tierLabel: tier.label,
        label: `${name} (${tier.label})`,
        className: accessory.className,
        icon: accessory.icon
      };
    });
  }

  function countRewardAssignments(assignments, label) {
    return assignments.filter((assignment) => {
      const tier = rewardTierForAssignment(assignment);
      return tier?.label === label;
    }).length;
  }

  function calculateFarmReward(assignment) {
    const dueDate = parseDate(assignment.dueISO);
    const submittedDate = parseDate(assignment.submittedAt || assignment.lastSeenAt);
    const turnedInOnTime = Boolean(assignment.submitted) && (!dueDate || !submittedDate || submittedDate <= dueDate);
    const hoursEarly = dueDate && submittedDate ? (dueDate - submittedDate) / (1000 * 60 * 60) : 0;
    const rewardTier = rewardTierForAssignment(assignment);

    let accessory = "";
    let weather = "cloudy";
    let message = "This assignment was not on time, but your farm is still growing.";

    if (rewardTier) {
      if (rewardTier.label === "Gold") {
        accessory = rewardTier.icon;
        weather = "sunny";
        message = "Gold reward! Your alpaca farm is thriving and a new alpaca joined the herd.";
      } else if (rewardTier.label === "Silver") {
        accessory = rewardTier.icon;
        weather = "cloudy";
        message = "Silver reward earned! Your alpaca farm unlocked a new decoration.";
      } else if (rewardTier.label === "Bronze") {
        accessory = rewardTier.icon;
        weather = "cloudy";
        message = "Bronze reward achieved. Your alpaca is relieved and a small customization was earned.";
      }
    } else if (turnedInOnTime) {
      weather = "cloudy";
      message = "Submitted on time, but missed the reward checkpoint. Keep aiming for Gold!";
    }

    if (!turnedInOnTime) {
      weather = "rainy";
      if (dueDate && submittedDate) {
        message = "Your alpaca is stressed by a late or last-minute submission. Try to submit earlier next time.";
      } else {
        message = "Your alpaca is waiting for a submission. Help it stay healthy by finishing on time.";
      }
    }

    if (dueDate && turnedInOnTime && hoursEarly < REWARD_TIERS[2].hoursBeforeDue) {
      weather = "rainy";
      message = "Last-minute submission keeps your alpaca anxious. Submit earlier to improve its health.";
    }

    return {
      earnedAlpaca: rewardTier?.rewardType === "alpaca",
      accessory,
      weather,
      message,
      rewardTier
    };
  }

  function rewardTierForAssignment(assignment) {
    const dueDate = parseDate(assignment.dueISO);
    const submittedDate = parseDate(assignment.submittedAt || assignment.lastSeenAt);

    if (!assignment.submitted || !dueDate || !submittedDate) {
      return null;
    }

    const hoursEarly = (dueDate - submittedDate) / (1000 * 60 * 60);

    return REWARD_TIERS.find((tier) => hoursEarly >= tier.hoursBeforeDue) || null;
  }

  function applyReward(reward) {
    elements.farmScene.className = `farm-scene ${reward.weather}`;
    elements.weatherIcon.textContent = weatherEmoji(reward.weather);
    elements.accessory.textContent = reward.earnedAlpaca ? reward.accessory : "";
  }

  function weatherEmoji(weather) {
    if (weather === "sunny") return "\u2600\uFE0F";
    if (weather === "rainy") return "\u{1F327}\uFE0F";
    return "\u2601\uFE0F";
  }

  function parseDate(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function renderAnimals(count, alpacaContainer, customizations) {
    alpacaContainer.innerHTML = "";

    for (let index = 0; index < count; index += 1) {
      const wrapper = document.createElement("div");
      wrapper.className = "alpaca-wrapper";
      wrapper.style.left = `${Math.random() * 75}%`;
      wrapper.style.top = `${55 + Math.random() * 25}%`;
      wrapper.tabIndex = 0;
      wrapper.setAttribute("role", "button");
      wrapper.setAttribute("aria-label", `Alpaca ${index + 1}. Press to hear alpaca scream.`);

      const animal = document.createElement("img");
      animal.src = chrome.runtime.getURL("images/animal_assets/alpaca.png");
      animal.className = "farm-animal";
      animal.alt = `Alpaca ${index + 1}`;
      animal.title = `Alpaca ${index + 1}`;
      wrapper.title = animal.title;

      wrapper.addEventListener("click", () => makeAlpacaNoise(wrapper, "scream", index));
      wrapper.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          makeAlpacaNoise(wrapper, "scream", index);
        }
      });

      wrapper.appendChild(animal);

      customizations
        .filter((_, customizationIndex) => customizationIndex % count === index)
        .forEach((customization, customizationIndex) => {
          wrapper.appendChild(renderAccessory(customization, customizationIndex));
        });

      alpacaContainer.appendChild(wrapper);
    }
  }

  function renderAccessory(customization, index) {
    const accessory = document.createElement("span");
    accessory.className = `animal-accessory accessory-${customization.className}`;
    accessory.textContent = customization.icon;
    accessory.title = customization.label;
    accessory.setAttribute("aria-label", customization.label);

    if (index > 0) {
      accessory.style.setProperty("--accessory-offset", `${Math.min(index, 3) * 5}px`);
    }

    return accessory;
  }

  function handleFarmStateChange(nextState) {
    const farmState = normalizeFarmState(nextState);

    if (!previousFarmState) {
      previousFarmState = farmState;
      return;
    }

    let eventType = "";
    if (farmState.alpacaCount > previousFarmState.alpacaCount) {
      eventType = "new-alpaca";
    } else if (farmState.customizationKey !== previousFarmState.customizationKey || farmState.accessory !== previousFarmState.accessory) {
      eventType = "customization";
    } else if (farmState.weather !== previousFarmState.weather) {
      eventType = farmState.weather === "rainy" ? "worried" : "happy";
    } else if (farmState.rewardLabel !== previousFarmState.rewardLabel) {
      eventType = farmState.rewardLabel ? "happy" : "worried";
    }

    previousFarmState = farmState;

    if (eventType) {
      makeFarmNoise(eventType);
    }
  }

  function normalizeFarmState({ alpacaCount, customizations, reward }) {
    return {
      alpacaCount,
      customizationKey: customizations.map((customization) => customization.label).join("|"),
      accessory: reward.accessory || "",
      weather: reward.weather || "cloudy",
      rewardLabel: reward.rewardTier?.label || ""
    };
  }

  function makeFarmNoise(eventType) {
    const animals = [...elements.alpacaContainer.querySelectorAll(".alpaca-wrapper")];
    if (!animals.length) {
      playAlpacaBleat(eventType).catch((error) => {
        console.warn("Could not play alpaca sound", error);
      });
      return;
    }

    const focusAnimal = eventType === "new-alpaca" ? animals[animals.length - 1] : animals[0];
    makeAlpacaNoise(focusAnimal, eventType, animals.indexOf(focusAnimal));
  }

  function makeAlpacaNoise(animal, eventType = "click", seed = 0) {
    animal.classList.remove("is-making-noise");
    // Restart the animation when the same alpaca is clicked repeatedly.
    void animal.offsetWidth;
    animal.classList.add("is-making-noise");

    window.setTimeout(() => {
      animal.classList.remove("is-making-noise");
    }, 700);

    const soundPromise = eventType === "scream"
      ? playAlpacaClickSound().catch(() => playAlpacaBleat(eventType, seed))
      : playAlpacaBleat(eventType, seed);

    soundPromise.catch((error) => {
      console.warn("Could not play alpaca sound", error);
    });
  }
}

function prepareAlpacaClickSound() {
  if (!alpacaClickAudioClips.length && typeof Audio !== "undefined") {
    alpacaClickAudioClips = ALPACA_CLICK_SOUND_PATHS.map((path) => {
      const clip = new Audio(getExtensionUrl(path));
      clip.preload = "auto";
      clip.volume = 0.95;
      return clip;
    });
  }
}

async function playAlpacaClickSound() {
  prepareAlpacaClickSound();

  if (!alpacaClickAudioClips.length) {
    throw new Error("Audio playback is not available.");
  }

  const randomIndex = Math.floor(Math.random() * alpacaClickAudioClips.length);
  const sound = alpacaClickAudioClips[randomIndex].cloneNode();
  sound.currentTime = 0;
  sound.volume = 0.95;
  await sound.play();
}

function getExtensionUrl(path) {
  if (typeof chrome !== "undefined" && chrome.runtime?.getURL) {
    return chrome.runtime.getURL(path);
  }

  return path;
}

async function playAlpacaBleat(eventType = "click", seed = 0) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    return;
  }

  if (!alpacaAudioContext) {
    alpacaAudioContext = new AudioContextClass();
  }

  if (alpacaAudioContext.state === "suspended") {
    await alpacaAudioContext.resume();
  }

  const context = alpacaAudioContext;
  const now = context.currentTime;
  const settings = bleatSettings(eventType, seed);
  const master = context.createGain();
  const filter = context.createBiquadFilter();

  filter.type = settings.filterType || "bandpass";
  filter.frequency.setValueAtTime(settings.filterFrequency, now);
  filter.Q.setValueAtTime(settings.filterQ, now);

  master.gain.setValueAtTime(0.0001, now);
  master.gain.exponentialRampToValueAtTime(settings.volume, now + 0.035);
  master.gain.exponentialRampToValueAtTime(0.0001, now + settings.totalDuration);

  master.connect(filter);
  filter.connect(context.destination);

  scheduleBleatSyllable(context, master, now, settings.firstDuration, settings.baseFrequency, settings.wobbleAmount, settings.voiceType);
  scheduleBleatSyllable(context, master, now + settings.secondDelay, settings.secondDuration, settings.secondFrequency, settings.wobbleAmount + 6, settings.voiceType);

  window.setTimeout(() => {
    master.disconnect();
    filter.disconnect();
  }, Math.ceil((settings.totalDuration + 0.12) * 1000));
}

function bleatSettings(eventType, seed) {
  const pitchOffset = (seed % 5) * 13 + Math.random() * 12;

  if (eventType === "scream") {
    return {
      baseFrequency: 560 + pitchOffset,
      secondFrequency: 760 + pitchOffset,
      filterType: "highpass",
      filterFrequency: 900,
      filterQ: 0.5,
      volume: 0.16,
      wobbleAmount: 5,
      firstDuration: 0.24,
      secondDelay: 0.16,
      secondDuration: 0.46,
      totalDuration: 0.68,
      voiceType: "triangle"
    };
  }

  if (eventType === "new-alpaca") {
    return {
      baseFrequency: 235 + pitchOffset,
      secondFrequency: 310 + pitchOffset,
      filterFrequency: 780,
      filterQ: 0.9,
      volume: 0.2,
      wobbleAmount: 10,
      firstDuration: 0.28,
      secondDelay: 0.22,
      secondDuration: 0.38,
      totalDuration: 0.74
    };
  }

  if (eventType === "worried") {
    return {
      baseFrequency: 145 + pitchOffset,
      secondFrequency: 125 + pitchOffset,
      filterFrequency: 560,
      filterQ: 1.1,
      volume: 0.16,
      wobbleAmount: 24,
      firstDuration: 0.42,
      secondDelay: 0.3,
      secondDuration: 0.48,
      totalDuration: 0.9
    };
  }

  if (eventType === "customization" || eventType === "happy") {
    return {
      baseFrequency: 205 + pitchOffset,
      secondFrequency: 260 + pitchOffset,
      filterFrequency: 720,
      filterQ: 0.85,
      volume: 0.18,
      wobbleAmount: 14,
      firstDuration: 0.3,
      secondDelay: 0.24,
      secondDuration: 0.36,
      totalDuration: 0.78
    };
  }

  return {
    baseFrequency: 185 + pitchOffset,
    secondFrequency: 152 + pitchOffset,
    filterFrequency: 680,
    filterQ: 0.9,
    volume: 0.18,
    wobbleAmount: 12,
    firstDuration: 0.34,
    secondDelay: 0.27,
    secondDuration: 0.42,
    totalDuration: 0.82
  };
}

function scheduleBleatSyllable(context, destination, startTime, duration, frequency, wobbleAmount, voiceType = "sawtooth") {
  const voice = context.createOscillator();
  const voiceGain = context.createGain();
  const wobble = context.createOscillator();
  const wobbleGain = context.createGain();
  const endTime = startTime + duration;

  voice.type = voiceType;
  voice.frequency.setValueAtTime(frequency, startTime);
  voice.frequency.exponentialRampToValueAtTime(frequency * 1.32, startTime + duration * 0.28);
  voice.frequency.exponentialRampToValueAtTime(frequency * 0.78, endTime);

  voiceGain.gain.setValueAtTime(0.0001, startTime);
  voiceGain.gain.exponentialRampToValueAtTime(0.8, startTime + 0.04);
  voiceGain.gain.exponentialRampToValueAtTime(0.0001, endTime);

  wobble.type = "sine";
  wobble.frequency.setValueAtTime(16, startTime);
  wobbleGain.gain.setValueAtTime(wobbleAmount, startTime);

  wobble.connect(wobbleGain);
  wobbleGain.connect(voice.frequency);
  voice.connect(voiceGain);
  voiceGain.connect(destination);

  voice.start(startTime);
  wobble.start(startTime);
  voice.stop(endTime);
  wobble.stop(endTime);
}
