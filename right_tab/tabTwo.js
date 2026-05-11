const ASSIGNMENTS_KEY = "canvas_due_tracker_assignments";

export function initializeTabTwo(root = document) {
  const elements = {
    farmScene: root.querySelector("#farmScene"),
    weatherIcon: root.querySelector("#weatherIcon"),
    accessory: root.querySelector("#accessory"),
    alpaca: root.querySelector("#alpaca"),
    farmMessage: root.querySelector("#farmMessage"),
    assignmentInfo: root.querySelector("#assignmentInfo")
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

    if (!rewardSource) {
      applyReward({ earnedAlpaca: false, accessory: "", weather: "cloudy" });
      elements.farmMessage.textContent = "Scan Canvas, then submit assignments on time to grow your farm.";
      elements.assignmentInfo.textContent = assignments.length
        ? `${assignments.length} assignment${assignments.length === 1 ? "" : "s"} tracked. No completed on-time assignments yet.`
        : "No Canvas assignments have been scanned yet.";
      return;
    }

    const reward = calculateFarmReward(rewardSource);
    applyReward(reward);
    elements.farmMessage.textContent = reward.earnedAlpaca
      ? "You earned an alpaca!"
      : "This assignment was not on time, but your farm is still growing.";
    elements.assignmentInfo.textContent = `${rewardSource.title || "Assignment"} • ${rewardSource.course || "Canvas"} • Weather: ${reward.weather}`;
  }

  function chooseRewardAssignment(assignments) {
    return assignments
      .filter((assignment) => assignment.submitted)
      .sort((a, b) => new Date(b.submittedAt || b.lastSeenAt || 0) - new Date(a.submittedAt || a.lastSeenAt || 0))[0];
  }

  function calculateFarmReward(assignment) {
    const dueDate = parseDate(assignment.dueISO);
    const submittedDate = parseDate(assignment.submittedAt || assignment.lastSeenAt);
    const turnedInOnTime = Boolean(assignment.submitted) && (!dueDate || !submittedDate || submittedDate <= dueDate);
    const hoursEarly = dueDate && submittedDate ? (dueDate - submittedDate) / (1000 * 60 * 60) : 0;
    const grade = parseGrade(assignment.grade ?? assignment.score);

    let accessory = "";
    if (hoursEarly >= 48) {
      accessory = "👑";
    } else if (hoursEarly >= 24) {
      accessory = "🌸";
    } else if (hoursEarly >= 1) {
      accessory = "🧣";
    }

    let weather = "cloudy";
    if (grade !== null) {
      if (grade >= 90) {
        weather = "sunny";
      } else if (grade >= 75) {
        weather = "cloudy";
      } else if (grade >= 60) {
        weather = "rainy";
      } else {
        weather = "stormy";
      }
    } else if (turnedInOnTime) {
      weather = "sunny";
    }

    return {
      earnedAlpaca: turnedInOnTime,
      accessory,
      weather
    };
  }

  function applyReward(reward) {
    elements.farmScene.className = `farm-scene ${reward.weather}`;
    elements.weatherIcon.textContent = weatherEmoji(reward.weather);
    elements.alpaca.textContent = reward.earnedAlpaca ? "🦙" : "🌱";
    elements.accessory.textContent = reward.earnedAlpaca ? reward.accessory : "";
  }

  function weatherEmoji(weather) {
    if (weather === "sunny") return "☀️";
    if (weather === "rainy") return "🌧️";
    if (weather === "stormy") return "⛈️";
    return "☁️";
  }

  function parseDate(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function parseGrade(value) {
    if (value === null || value === undefined || value === "") return null;
    const match = String(value).match(/\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : null;
  }
}
