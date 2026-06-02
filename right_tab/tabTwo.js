const ASSIGNMENTS_KEY = "canvas_due_tracker_assignments";
const ALPACA_CLICK_SOUND_PATHS = [
  "sounds/alpaca-click-1.mp3",
  "sounds/alpaca-click-2.mp3",
  "sounds/alpaca-click-3.mp3",
  "sounds/alpaca-click-4.mp3",
  "sounds/alpaca-click-5.mp3"
];
const REWARD_TIERS = [
  { label: "Gold", hoursBeforeDue: 48, rewardType: "alpaca", icon: "👑", medalIcon: "🥇", description: "New alpaca friend" },
  { label: "Silver", hoursBeforeDue: 24, rewardType: "customization", icon: "🌸", medalIcon: "🥈", description: "Farm decoration" },
  { label: "Bronze", hoursBeforeDue: 1, rewardType: "customization", icon: "🧣", medalIcon: "🥉", description: "Alpaca accessory" }
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
    farmBackground: root.querySelector("#farm-background"),
    weatherIcon: root.querySelector("#weatherIcon"),
    accessory: root.querySelector("#accessory"),
    alpacaContainer: root.querySelector("#alpaca-container"),
    farmMessage: root.querySelector("#farmMessage"),
    assignmentInfo: root.querySelector("#assignmentInfo"),
    farmSummary: root.querySelector("#farmSummary"),
    customizationList: root.querySelector("#customizationList"),
    shareButton: root.querySelector("#shareFarmBtn"),
    shareModal: root.querySelector("#shareFarmModal"),
    farmTitleInput: root.querySelector("#farmTitleInput"),
    downloadFarmButton: root.querySelector("#downloadFarmBtn"),
    cancelShareButton: root.querySelector("#cancelShareBtn"),
    shareStatus: root.querySelector("#shareStatus")
  };

  if (!elements.farmScene) {
    console.warn("Farm markup was not found.");
    return;
  }

  prepareAlpacaClickSound();

  let currentAssignments = [];
  let lastFocusedElement = null;

  initializeShareControls();
  renderFromStorage();

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes[ASSIGNMENTS_KEY]) {
      renderFromStorage();
    }
  });

  async function renderFromStorage() {
    const result = await chrome.storage.local.get({ [ASSIGNMENTS_KEY]: {} });
    const assignments = Object.values(result[ASSIGNMENTS_KEY] || {});
    currentAssignments = assignments;
    renderFarm(assignments);
  }

  function renderFarm(assignments) {
    const rewardSource = chooseRewardAssignment(assignments);
    const alpacaCount = Math.max(1, 1 + countRewardAssignments(assignments, "Gold"));
    const customizations = buildCustomizationList(assignments);
    let currentReward = { earnedAlpaca: false, weather: "cloudy", accessory: "", message: "", rewardTier: null };

    renderAnimals(alpacaCount, elements.alpacaContainer, customizations);
    renderFarmSummary(alpacaCount, customizations, assignments);

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

  function renderFarmSummary(alpacaCount, customizations, assignments) {
    const rewardCounts = getRewardCounts(assignments);
    const totalRewards = rewardCounts.Gold + rewardCounts.Silver + rewardCounts.Bronze;

    elements.farmSummary.textContent = `Your farm has ${alpacaCount} alpaca${alpacaCount === 1 ? "" : "s"}, ${customizations.length} customization item${customizations.length === 1 ? "" : "s"}, and ${rewardCounts.Gold} Gold, ${rewardCounts.Silver} Silver, ${rewardCounts.Bronze} Bronze reward${totalRewards === 1 ? "" : "s"}.`;
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

  function initializeShareControls() {
    if (!elements.shareButton || !elements.shareModal) {
      return;
    }

    elements.shareButton.addEventListener("click", openShareModal);
    elements.cancelShareButton?.addEventListener("click", closeShareModal);
    elements.downloadFarmButton?.addEventListener("click", handleDownloadFarmPicture);
    elements.shareModal.addEventListener("click", (event) => {
      if (event.target === elements.shareModal) {
        closeShareModal();
      }
    });
    elements.farmTitleInput?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        handleDownloadFarmPicture();
      }
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !elements.shareModal.hidden) {
        closeShareModal();
      }
    });
  }

  function openShareModal() {
    lastFocusedElement = document.activeElement;
    elements.shareStatus.textContent = "";
    elements.farmTitleInput.value = "";
    elements.shareModal.hidden = false;
    window.requestAnimationFrame(() => elements.farmTitleInput.focus());
  }

  function closeShareModal() {
    elements.shareModal.hidden = true;
    elements.shareStatus.textContent = "";

    if (lastFocusedElement && typeof lastFocusedElement.focus === "function") {
      lastFocusedElement.focus();
    }
  }

  async function handleDownloadFarmPicture() {
    const title = elements.farmTitleInput.value.trim() || "My Alpaca Farm";

    try {
      elements.downloadFarmButton.disabled = true;
      elements.shareStatus.textContent = "Creating your farm picture...";

      const blob = await createFarmShareImage(title, currentAssignments);
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = `${slugify(title)}-alpaca-farm.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();

      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
      elements.shareStatus.textContent = "Downloaded!";
      window.setTimeout(closeShareModal, 600);
    } catch (error) {
      console.error("Could not create farm share image", error);
      elements.shareStatus.textContent = "Could not create the picture. Try again after the farm finishes loading.";
    } finally {
      elements.downloadFarmButton.disabled = false;
    }
  }

  async function createFarmShareImage(title, assignments) {
    const rewardCounts = getRewardCounts(assignments);
    const sceneRect = elements.farmScene.getBoundingClientRect();
    const sceneRatio = sceneRect.height && sceneRect.width ? sceneRect.height / sceneRect.width : 0.75;
    const canvasWidth = 1000;
    const padding = 52;
    const titleHeight = 122;
    const sceneWidth = canvasWidth - padding * 2;
    const sceneHeight = Math.round(sceneWidth * sceneRatio);
    const medalHeight = 154;
    const canvasHeight = titleHeight + sceneHeight + medalHeight + padding;
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");

    canvas.width = canvasWidth;
    canvas.height = canvasHeight;

    drawShareBackground(context, canvasWidth, canvasHeight);
    drawTitle(context, title, canvasWidth, titleHeight);
    await drawFarmScene(context, sceneRect, padding, titleHeight, sceneWidth, sceneHeight);
    drawMedalShowcase(context, rewardCounts, padding, titleHeight + sceneHeight + 30, sceneWidth, 98);

    return canvasToBlob(canvas);
  }

  function drawShareBackground(context, width, height) {
    context.fillStyle = "#f7fee7";
    context.fillRect(0, 0, width, height);
    context.fillStyle = "#ffffff";
    roundedRect(context, 28, 26, width - 56, height - 52, 32);
    context.fill();
  }

  function drawTitle(context, title, width, titleHeight) {
    context.fillStyle = "#14532d";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = "bold 42px Arial, sans-serif";
    wrapCenteredText(context, title, width / 2, 62, width - 150, 48, 2);

    context.fillStyle = "#4b5563";
    context.font = "22px Arial, sans-serif";
    context.fillText("Stop Procrastinating: Alpaca Farm", width / 2, titleHeight - 24);
  }

  async function drawFarmScene(context, sceneRect, x, y, width, height) {
    context.save();
    roundedRect(context, x, y, width, height, 24);
    context.clip();

    const backgroundDrawn = await drawFarmBackgroundImage(context, x, y, width, height);
    if (!backgroundDrawn) {
      drawFarmGradient(context, x, y, width, height, getCurrentWeather());
    }

    drawClouds(context, x, y, width, height);
    drawWeatherIcon(context, x, y, width);
    await drawFarmAnimals(context, sceneRect, x, y, width, height);
    drawAccessory(context, sceneRect, x, y, width, height);

    context.restore();

    context.strokeStyle = "#14532d";
    context.lineWidth = 6;
    roundedRect(context, x, y, width, height, 24);
    context.stroke();
  }

  async function drawFarmBackgroundImage(context, x, y, width, height) {
    if (!elements.farmBackground?.src) {
      return false;
    }

    try {
      const image = await loadImage(elements.farmBackground.src);
      drawImageCover(context, image, x, y, width, height);
      return true;
    } catch (error) {
      console.warn("Farm background could not be drawn", error);
      return false;
    }
  }

  function drawFarmGradient(context, x, y, width, height, weather) {
    const gradient = context.createLinearGradient(0, y, 0, y + height);

    if (weather === "rainy") {
      gradient.addColorStop(0, "#6f8799");
      gradient.addColorStop(0.55, "#aab7c4");
      gradient.addColorStop(0.56, "#5da85b");
      gradient.addColorStop(1, "#3e8f3e");
    } else if (weather === "cloudy") {
      gradient.addColorStop(0, "#bfc7d1");
      gradient.addColorStop(0.55, "#d8dde3");
      gradient.addColorStop(0.56, "#78c850");
      gradient.addColorStop(1, "#4caf50");
    } else {
      gradient.addColorStop(0, "#8ed8ff");
      gradient.addColorStop(0.55, "#b8ecff");
      gradient.addColorStop(0.56, "#78c850");
      gradient.addColorStop(1, "#4caf50");
    }

    context.fillStyle = gradient;
    context.fillRect(x, y, width, height);
  }

  function drawClouds(context, x, y, width, height) {
    drawCloud(context, x + width * 0.16, y + height * 0.16, width * 0.12);
    drawCloud(context, x + width * 0.77, y + height * 0.27, width * 0.1);
  }

  function drawCloud(context, centerX, centerY, size) {
    context.save();
    context.fillStyle = "rgba(255, 255, 255, 0.88)";
    context.beginPath();
    context.ellipse(centerX - size * 0.42, centerY + size * 0.08, size * 0.52, size * 0.28, 0, 0, Math.PI * 2);
    context.ellipse(centerX, centerY - size * 0.16, size * 0.38, size * 0.36, 0, 0, Math.PI * 2);
    context.ellipse(centerX + size * 0.42, centerY + size * 0.04, size * 0.5, size * 0.3, 0, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }

  function drawWeatherIcon(context, x, y, width) {
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = "56px Arial, sans-serif";
    context.fillText(elements.weatherIcon.textContent || "☀️", x + width - 62, y + 66);
  }

  async function drawFarmAnimals(context, sceneRect, sceneX, sceneY, sceneWidth, sceneHeight) {
    const animals = Array.from(elements.alpacaContainer.querySelectorAll(".farm-animal"));

    for (const animal of animals) {
      const animalRect = animal.getBoundingClientRect();
      const target = scaleRectIntoScene(animalRect, sceneRect, sceneX, sceneY, sceneWidth, sceneHeight);

      try {
        const image = await loadImage(animal.src);
        context.drawImage(image, target.x, target.y, target.width, target.height);
      } catch (error) {
        context.font = `${Math.max(42, target.height * 0.75)}px Arial, sans-serif`;
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText("🦙", target.x + target.width / 2, target.y + target.height / 2);
      }
    }

    const animalAccessories = Array.from(elements.alpacaContainer.querySelectorAll(".animal-accessory"));
    animalAccessories.forEach((accessory) => drawAnimalAccessory(context, accessory, sceneRect, sceneX, sceneY, sceneWidth, sceneHeight));

    const badges = Array.from(elements.alpacaContainer.querySelectorAll(".animal-badge"));
    badges.forEach((badge) => drawBadge(context, badge, sceneRect, sceneX, sceneY, sceneWidth, sceneHeight));
  }

  function drawAnimalAccessory(context, accessory, sceneRect, sceneX, sceneY, sceneWidth, sceneHeight) {
    const accessoryText = accessory.textContent.trim();

    if (!accessoryText) {
      return;
    }

    const accessoryRect = accessory.getBoundingClientRect();
    const target = scaleRectIntoScene(accessoryRect, sceneRect, sceneX, sceneY, sceneWidth, sceneHeight);
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = `${Math.max(28, target.height)}px Arial, sans-serif`;
    context.fillText(accessoryText, target.x + target.width / 2, target.y + target.height / 2);
  }

  function drawAccessory(context, sceneRect, sceneX, sceneY, sceneWidth, sceneHeight) {
    const accessoryText = elements.accessory.textContent.trim();

    if (!accessoryText) {
      return;
    }

    const accessoryRect = elements.accessory.getBoundingClientRect();
    const target = scaleRectIntoScene(accessoryRect, sceneRect, sceneX, sceneY, sceneWidth, sceneHeight);
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = `${Math.max(36, target.height)}px Arial, sans-serif`;
    context.fillText(accessoryText, target.x + target.width / 2, target.y + target.height / 2);
  }

  function drawBadge(context, badge, sceneRect, sceneX, sceneY, sceneWidth, sceneHeight) {
    const badgeRect = badge.getBoundingClientRect();
    const target = scaleRectIntoScene(badgeRect, sceneRect, sceneX, sceneY, sceneWidth, sceneHeight);
    const badgeWidth = Math.max(120, target.width);
    const badgeHeight = Math.max(32, target.height);

    context.save();
    context.fillStyle = "rgba(255, 255, 255, 0.9)";
    context.strokeStyle = "#65a30d";
    context.lineWidth = 3;
    roundedRect(context, target.x, target.y, badgeWidth, badgeHeight, 16);
    context.fill();
    context.stroke();

    context.fillStyle = "#14532d";
    context.font = "bold 18px Arial, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(badge.textContent, target.x + badgeWidth / 2, target.y + badgeHeight / 2, badgeWidth - 14);
    context.restore();
  }

  function drawMedalShowcase(context, rewardCounts, x, y, width, height) {
    context.fillStyle = "#ecfccb";
    roundedRect(context, x, y, width, height, 24);
    context.fill();

    context.fillStyle = "#14532d";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = "bold 25px Arial, sans-serif";
    context.fillText("Reward Showcase", x + width / 2, y + 24);

    const columns = REWARD_TIERS.length;
    const columnWidth = width / columns;

    REWARD_TIERS.forEach((tier, index) => {
      const centerX = x + columnWidth * index + columnWidth / 2;
      const count = rewardCounts[tier.label] || 0;

      context.font = "40px Arial, sans-serif";
      context.fillText(tier.medalIcon, centerX, y + 58);
      context.fillStyle = "#111827";
      context.font = "bold 26px Arial, sans-serif";
      context.fillText(`${count} ${tier.label}`, centerX, y + 91);
      context.fillStyle = "#14532d";
    });
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

  function getRewardCounts(assignments) {
    return REWARD_TIERS.reduce((counts, tier) => {
      counts[tier.label] = countRewardAssignments(assignments, tier.label);
      return counts;
    }, {});
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

  function getCurrentWeather() {
    if (elements.farmScene.classList.contains("rainy")) return "rainy";
    if (elements.farmScene.classList.contains("sunny")) return "sunny";
    return "cloudy";
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
      startAlpacaWiggle(animal);

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
function startAlpacaWiggle(animal) {
  setInterval(() => {
    const moveX = Math.floor(Math.random() * 21) - 10;
    const moveY = Math.floor(Math.random() * 11) - 5;
    const flip = Math.random() > 0.5 ? -1 : 1;

    animal.style.transform =
      `translate(${moveX}px, ${moveY}px) scaleX(${flip})`;
  }, 1800);
}

function drawImageCover(context, image, x, y, width, height) {
  const imageRatio = image.width / image.height;
  const targetRatio = width / height;
  let sourceWidth = image.width;
  let sourceHeight = image.height;
  let sourceX = 0;
  let sourceY = 0;

  if (imageRatio > targetRatio) {
    sourceWidth = image.height * targetRatio;
    sourceX = (image.width - sourceWidth) / 2;
  } else {
    sourceHeight = image.width / targetRatio;
    sourceY = (image.height - sourceHeight) / 2;
  }

  context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, x, y, width, height);
}

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = source;
  });
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("Canvas did not create a PNG blob."));
      }
    }, "image/png");
  });
}

function roundedRect(context, x, y, width, height, radius) {
  const safeRadius = Math.min(radius, width / 2, height / 2);

  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.lineTo(x + width - safeRadius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  context.lineTo(x + width, y + height - safeRadius);
  context.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  context.lineTo(x + safeRadius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  context.lineTo(x, y + safeRadius);
  context.quadraticCurveTo(x, y, x + safeRadius, y);
  context.closePath();
}

function scaleRectIntoScene(rect, sceneRect, sceneX, sceneY, sceneWidth, sceneHeight) {
  const widthRatio = sceneWidth / sceneRect.width;
  const heightRatio = sceneHeight / sceneRect.height;

  return {
    x: sceneX + (rect.left - sceneRect.left) * widthRatio,
    y: sceneY + (rect.top - sceneRect.top) * heightRatio,
    width: rect.width * widthRatio,
    height: rect.height * heightRatio
  };
}

function wrapCenteredText(context, text, centerX, y, maxWidth, lineHeight, maxLines) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";

  words.forEach((word) => {
    const testLine = line ? `${line} ${word}` : word;

    if (context.measureText(testLine).width <= maxWidth || !line) {
      line = testLine;
    } else {
      lines.push(line);
      line = word;
    }
  });

  if (line) {
    lines.push(line);
  }

  const visibleLines = lines.slice(0, maxLines);
  if (lines.length > maxLines) {
    visibleLines[maxLines - 1] = `${visibleLines[maxLines - 1].replace(/\s+$/, "")}...`;
  }

  const startY = y - ((visibleLines.length - 1) * lineHeight) / 2;
  visibleLines.forEach((visibleLine, index) => {
    context.fillText(visibleLine, centerX, startY + index * lineHeight, maxWidth);
  });
}

function slugify(value) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "my";
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
