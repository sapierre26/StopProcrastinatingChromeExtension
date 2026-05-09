const ASSIGNMENTS_KEY = "canvas_due_tracker_assignments";
const LAST_SCAN_KEY = "canvas_due_tracker_last_scan";

const elements = {
  lastScan: document.querySelector("#lastScan"),
  openCount: document.querySelector("#openCount"),
  submittedCount: document.querySelector("#submittedCount"),
  overdueCount: document.querySelector("#overdueCount"),
  assignmentList: document.querySelector("#assignmentList"),
  emptyState: document.querySelector("#emptyState"),
  rescanButton: document.querySelector("#rescanButton"),
  exportButton: document.querySelector("#exportButton"),
  clearButton: document.querySelector("#clearButton"),
  filters: Array.from(document.querySelectorAll(".filter"))
};

let assignments = [];
let activeFilter = "all";

init();

function init() {
  bindEvents();
  loadAssignments();
}

function bindEvents() {
  elements.rescanButton.addEventListener("click", rescanCurrentTab);
  elements.exportButton.addEventListener("click", exportCsv);
  elements.clearButton.addEventListener("click", clearAssignments);

  for (const filter of elements.filters) {
    filter.addEventListener("click", () => {
      activeFilter = filter.dataset.filter;
      elements.filters.forEach((button) => button.classList.toggle("isActive", button === filter));
      render();
    });
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && (changes[ASSIGNMENTS_KEY] || changes[LAST_SCAN_KEY])) {
      loadAssignments();
    }
  });
}

async function loadAssignments() {
  const result = await chrome.storage.local.get({
    [ASSIGNMENTS_KEY]: {},
    [LAST_SCAN_KEY]: null
  });

  assignments = Object.values(result[ASSIGNMENTS_KEY] || {}).sort(sortAssignments);
  render(result[LAST_SCAN_KEY]);
}

function render(lastScan) {
  const open = assignments.filter((assignment) => !assignment.submitted);
  const submitted = assignments.filter((assignment) => assignment.submitted);
  const overdue = assignments.filter(isOverdue);
  const visibleAssignments = assignments.filter(matchesActiveFilter);

  elements.openCount.textContent = open.length;
  elements.submittedCount.textContent = submitted.length;
  elements.overdueCount.textContent = overdue.length;
  elements.lastScan.textContent = lastScan?.at
    ? `Last scan ${formatRelative(lastScan.at)}`
    : "No scans yet";

  elements.assignmentList.innerHTML = "";
  elements.emptyState.hidden = visibleAssignments.length > 0;
  elements.assignmentList.hidden = visibleAssignments.length === 0;

  for (const assignment of visibleAssignments) {
    elements.assignmentList.appendChild(renderAssignment(assignment));
  }
}

function renderAssignment(assignment) {
  const item = document.createElement("li");
  item.className = "assignment";

  const header = document.createElement("div");
  header.className = "assignmentHeader";

  const title = document.createElement("a");
  title.className = "assignmentTitle";
  title.href = assignment.sourceUrl || assignment.pageUrl || "https://canvas.instructure.com/";
  title.target = "_blank";
  title.rel = "noreferrer";
  title.textContent = assignment.title;

  const status = document.createElement("span");
  status.className = `status ${statusClass(assignment)}`;
  status.textContent = isOverdue(assignment) ? "Overdue" : assignment.status;

  const meta = document.createElement("div");
  meta.className = "meta";
  meta.append(
    makeMetaLine("Due", formatDue(assignment)),
    makeMetaLine("Course", assignment.course || "Canvas"),
    makeMetaLine("Seen", formatRelative(assignment.lastSeenAt))
  );

  header.append(title, status);
  item.append(header, meta);
  return item;
}

function makeMetaLine(label, value) {
  const line = document.createElement("span");
  line.textContent = `${label}: ${value}`;
  return line;
}

async function rescanCurrentTab() {
  elements.rescanButton.disabled = true;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      return;
    }

    await chrome.tabs.sendMessage(tab.id, { type: "CDT_SCAN_NOW" });
    await loadAssignments();
  } catch (error) {
    elements.lastScan.textContent = "Open a Canvas tab, then scan.";
  } finally {
    elements.rescanButton.disabled = false;
  }
}

async function clearAssignments() {
  if (!confirm("Clear all tracked assignments?")) {
    return;
  }

  await chrome.storage.local.set({
    [ASSIGNMENTS_KEY]: {},
    [LAST_SCAN_KEY]: null
  });
  await loadAssignments();
}

function exportCsv() {
  if (!assignments.length) {
    return;
  }

  const header = ["Title", "Course", "Due", "Due ISO", "Status", "Submitted", "Last Seen", "URL"];
  const rows = assignments.map((assignment) => [
    assignment.title,
    assignment.course,
    assignment.dueText,
    assignment.dueISO || "",
    assignment.status,
    assignment.submitted ? "yes" : "no",
    assignment.lastSeenAt || "",
    assignment.sourceUrl || assignment.pageUrl || ""
  ]);
  const csv = [header, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = `canvas-due-tracker-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function matchesActiveFilter(assignment) {
  if (activeFilter === "submitted") {
    return assignment.submitted;
  }
  if (activeFilter === "open") {
    return !assignment.submitted;
  }
  if (activeFilter === "overdue") {
    return isOverdue(assignment);
  }
  return true;
}

function sortAssignments(a, b) {
  const aTime = a.dueISO ? new Date(a.dueISO).getTime() : Number.MAX_SAFE_INTEGER;
  const bTime = b.dueISO ? new Date(b.dueISO).getTime() : Number.MAX_SAFE_INTEGER;

  if (a.submitted !== b.submitted) {
    return a.submitted ? 1 : -1;
  }
  if (aTime !== bTime) {
    return aTime - bTime;
  }
  return a.title.localeCompare(b.title);
}

function isOverdue(assignment) {
  if (assignment.submitted || !assignment.dueISO) {
    return false;
  }
  return new Date(assignment.dueISO).getTime() < Date.now();
}

function statusClass(assignment) {
  if (isOverdue(assignment)) {
    return "overdue";
  }
  return assignment.status || "due";
}

function formatDue(assignment) {
  if (!assignment.dueISO) {
    return assignment.dueText || "Unknown";
  }

  const due = new Date(assignment.dueISO);
  return `${due.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric"
  })}, ${due.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit"
  })}`;
}

function formatRelative(value) {
  if (!value) {
    return "Never";
  }

  const date = new Date(value);
  const diffMs = date.getTime() - Date.now();
  const absMs = Math.abs(diffMs);
  const units = [
    ["day", 86400000],
    ["hour", 3600000],
    ["minute", 60000]
  ];

  for (const [unit, ms] of units) {
    if (absMs >= ms) {
      const amount = Math.round(diffMs / ms);
      return new Intl.RelativeTimeFormat([], { numeric: "auto" }).format(amount, unit);
    }
  }

  return "just now";
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}
function calculateFarmReward(assignment) {
  const dueDate = new Date(assignment.due_at);
  const submittedDate = new Date(assignment.submitted_at);

  const turnedInOnTime = submittedDate <= dueDate;
  const hoursEarly = (dueDate - submittedDate) / (1000 * 60 * 60);

  let reward = {
    earnedAlpaca: false,
    accessory: null,
    weather: "cloudy"
  };

  if (turnedInOnTime) {
    reward.earnedAlpaca = true;
  }

  if (hoursEarly >= 48) {
    reward.accessory = "gold crown";
  } else if (hoursEarly >= 24) {
    reward.accessory = "flower hat";
  } else if (hoursEarly >= 1) {
    reward.accessory = "scarf";
  }

  if (assignment.grade >= 90) {
    reward.weather = "sunny";
  } else if (assignment.grade >= 75) {
    reward.weather = "partly cloudy";
  } else if (assignment.grade >= 60) {
    reward.weather = "rainy";
  } else {
    reward.weather = "stormy";
  }

  return reward;
}

// Test assignment for now
const testAssignment = {
  name: "Math Homework",
  due_at: "2026-05-10T23:59:00",
  submitted_at: "2026-05-09T20:00:00",
  grade: 95
};

console.log("Farm reward:", calculateFarmReward(testAssignment));
function calculateFarmReward(assignment) {
  const dueDate = new Date(assignment.due_at);
  const submittedDate = new Date(assignment.submitted_at);

  const turnedInOnTime = submittedDate <= dueDate;
  const hoursEarly = (dueDate - submittedDate) / (1000 * 60 * 60);

  let reward = {
    earnedAlpaca: false,
    accessory: null,
    weather: "cloudy"
  };

  if (turnedInOnTime) {
    reward.earnedAlpaca = true;
  }

  if (hoursEarly >= 48) {
    reward.accessory = "👑";
  } else if (hoursEarly >= 24) {
    reward.accessory = "🌸";
  } else if (hoursEarly >= 1) {
    reward.accessory = "🧣";
  } else {
    reward.accessory = "";
  }

  if (assignment.grade >= 90) {
    reward.weather = "sunny";
  } else if (assignment.grade >= 75) {
    reward.weather = "cloudy";
  } else if (assignment.grade >= 60) {
    reward.weather = "rainy";
  } else {
    reward.weather = "stormy";
  }

  return reward;
}

function renderFarm(assignment) {
  const reward = calculateFarmReward(assignment);

  const farmScene = document.getElementById("farmScene");
  const weatherIcon = document.getElementById("weatherIcon");
  const accessory = document.getElementById("accessory");
  const alpaca = document.getElementById("alpaca");
  const farmMessage = document.getElementById("farmMessage");
  const assignmentInfo = document.getElementById("assignmentInfo");

  farmScene.className = `farm-scene ${reward.weather}`;

  if (reward.weather === "sunny") {
    weatherIcon.textContent = "☀️";
  } else if (reward.weather === "cloudy") {
    weatherIcon.textContent = "☁️";
  } else if (reward.weather === "rainy") {
    weatherIcon.textContent = "🌧️";
  } else {
    weatherIcon.textContent = "⛈️";
  }

  if (reward.earnedAlpaca) {
    alpaca.textContent = "🦙";
    accessory.textContent = reward.accessory;
    farmMessage.textContent = "You earned an alpaca!";
  } else {
    alpaca.textContent = "🌱";
    accessory.textContent = "";
    farmMessage.textContent = "Turn in an assignment on time to grow your farm!";
  }

  assignmentInfo.textContent =
    `${assignment.name} • Grade: ${assignment.grade}% • Weather: ${reward.weather}`;
}

// Fake Canvas assignment for now
const testAssignment = {
  name: "Math Homework",
  due_at: "2026-05-10T23:59:00",
  submitted_at: "2026-05-09T20:00:00",
  grade: 95
};

renderFarm(testAssignment);