const ASSIGNMENTS_KEY = "canvas_due_tracker_assignments";
const REWARD_TIERS = [
  { label: "Gold", hoursBeforeDue: 48, rewardType: "alpaca", icon: "👑", description: "New alpaca friend" },
  { label: "Silver", hoursBeforeDue: 24, rewardType: "customization", icon: "🌸", description: "Farm decoration" },
  { label: "Bronze", hoursBeforeDue: 1, rewardType: "customization", icon: "🧣", description: "Alpaca accessory" }
];
const CUSTOMIZATION_ITEMS = ["Bright Scarf", "Festival Banner", "Sparkle Saddle", "Cozy Blanket", "Party Hat"];

export function initializeTabTwo(root = document) {
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

    renderAnimals(alpacaCount, elements.alpacaContainer, customizations);
    renderFarmSummary(alpacaCount, customizations);

    if (!rewardSource) {
      applyReward({ weather: "cloudy", accessory: "" });
      elements.farmMessage.textContent = "Scan Canvas and submit assignments on time to grow your farm.";
      elements.assignmentInfo.textContent = assignments.length
        ? `${assignments.length} assignment${assignments.length === 1 ? "" : "s"} tracked. No completed submissions to reward yet.`
        : "No Canvas assignments have been scanned yet.";
      return;
    }

    const reward = calculateFarmReward(rewardSource);
    applyReward(reward);
    elements.farmMessage.textContent = reward.message;
    elements.assignmentInfo.textContent = `${rewardSource.title || "Assignment"} • ${rewardSource.course || "Canvas"} • ${reward.rewardTier ? reward.rewardTier.label : "No reward"}`;
  }

  function renderFarmSummary(alpacaCount, customizations) {
    elements.farmSummary.textContent = `Your farm has ${alpacaCount} alpaca${alpacaCount === 1 ? "" : "s"} and ${customizations.length} customization item${customizations.length === 1 ? "" : "s"}.`;
    elements.customizationList.innerHTML = customizations.length
      ? customizations.map((item) => `<span class="customization-tag">${item}</span>`).join("")
      : "No customizations earned yet. Earn Silver or Bronze rewards to decorate your alpaca farm.";
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
      return `${CUSTOMIZATION_ITEMS[index % CUSTOMIZATION_ITEMS.length]} (${tier.label})`;
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
    if (weather === "sunny") return "☀️";
    if (weather === "rainy") return "🌧️";
    return "☁️";
  }

  function parseDate(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function renderAnimals(count, alpacaContainer, customizations) {
    alpacaContainer.innerHTML = "";

    for (let index = 0; index < count; index += 1) {
      const animal = document.createElement("img");
      animal.src = chrome.runtime.getURL("images/animal_assets/alpaca.png");
      animal.className = "farm-animal";
      animal.style.left = `${Math.random() * 75}%`;
      animal.style.top = `${55 + Math.random() * 25}%`;
      animal.alt = `Alpaca ${index + 1}`;
      animal.title = `Alpaca ${index + 1}`;
      alpacaContainer.appendChild(animal);
    }

    if (customizations.length) {
      customizations.slice(0, count).forEach((item, index) => {
        const badge = document.createElement("span");
        badge.className = "animal-badge";
        badge.textContent = item;
        badge.style.left = `${Math.min(80, 15 + index * 14)}%`;
        badge.style.top = `${60 + (index % 2) * 6}%`;
        alpacaContainer.appendChild(badge);
      });
    }
  }
}
