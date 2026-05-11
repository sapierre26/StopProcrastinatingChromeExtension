const ASSIGNMENTS_KEY = "canvas_due_tracker_assignments";
const LAST_SCAN_KEY = "canvas_due_tracker_last_scan";

export function initializeTabOne(root = document) {
  const elements = {
    storageStatus: root.querySelector("#storageStatus"),
    openCount: root.querySelector("#openCount"),
    submittedCount: root.querySelector("#submittedCount"),
    overdueCount: root.querySelector("#overdueCount"),
    assignmentList: root.querySelector("#assignmentList"),
    emptyState: root.querySelector("#emptyState")
  };

  if (!elements.assignmentList) {
    console.warn("Canvas assignment display markup was not found.");
    return;
  }

  loadAndRenderFromStorage();

  // Listen for extension-local storage changes produced by canvas_integration.
  // This intentionally does not fetch Canvas data or message any browser tabs.
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && (changes[ASSIGNMENTS_KEY] || changes[LAST_SCAN_KEY])) {
      loadAndRenderFromStorage();
    }
  });

  async function loadAndRenderFromStorage() {
    const result = await chrome.storage.local.get({
      [ASSIGNMENTS_KEY]: {},
      [LAST_SCAN_KEY]: null
    });

    const assignmentData = Object.values(result[ASSIGNMENTS_KEY] || {}).sort(sortAssignments);
    const lastScan = result[LAST_SCAN_KEY];

    // FOLLOW-UP: `assignmentData` is the local assignment data saved by
    // canvas_integration. This is the display layer hook: filter, group,
    // decorate, or render this data however you want from here.
    renderAssignments(assignmentData, lastScan);
  }

  function renderAssignments(assignments, lastScan) {
    const open = assignments.filter((assignment) => !assignment.submitted);
    const submitted = assignments.filter((assignment) => assignment.submitted);
    const overdue = assignments.filter(isOverdue);

    elements.openCount.textContent = String(open.length);
    elements.submittedCount.textContent = String(submitted.length);
    elements.overdueCount.textContent = String(overdue.length);
    elements.storageStatus.textContent = getStorageStatusText(lastScan);

    elements.assignmentList.innerHTML = "";
    elements.emptyState.hidden = assignments.length > 0;
    elements.assignmentList.hidden = assignments.length === 0;

    for (const assignment of assignments) {
      elements.assignmentList.appendChild(renderAssignment(assignment));
    }
  }

  function getStorageStatusText(lastScan) {
    if (!lastScan?.at) {
      return "Listening for saved Canvas assignment data.";
    }
    if (lastScan.status === "error") {
      return `Last Canvas scan failed ${formatRelative(lastScan.at)}.`;
    }
    if (lastScan.status === "started") {
      return `Canvas scan started ${formatRelative(lastScan.at)}.`;
    }
    return `Last updated ${formatRelative(lastScan.at)} from ${lastScan.host || "Canvas"}.`;
  }

  function renderAssignment(assignment) {
    const item = document.createElement("li");
    item.className = "assignment";

    const header = document.createElement("div");
    header.className = "assignmentHeader";

    const title = document.createElement("a");
    title.className = "assignmentTitle";
    title.href = assignment.sourceUrl || assignment.pageUrl || "https://canvas.calpoly.edu/";
    title.target = "_blank";
    title.rel = "noreferrer";
    title.textContent = assignment.title || "Untitled assignment";

    const status = document.createElement("span");
    status.className = `status ${statusClass(assignment)}`;
    status.textContent = isOverdue(assignment) ? "Overdue" : assignment.status || "Assigned";

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

  function sortAssignments(a, b) {
    const aTime = a.dueISO ? new Date(a.dueISO).getTime() : Number.MAX_SAFE_INTEGER;
    const bTime = b.dueISO ? new Date(b.dueISO).getTime() : Number.MAX_SAFE_INTEGER;

    if (a.submitted !== b.submitted) {
      return a.submitted ? 1 : -1;
    }
    if (aTime !== bTime) {
      return aTime - bTime;
    }
    return String(a.title || "").localeCompare(String(b.title || ""));
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
    return String(assignment.status || "assigned").toLowerCase().replace(/[^a-z0-9_-]/g, "");
  }

  function formatDue(assignment) {
    if (!assignment.dueISO) {
      return assignment.dueText || "Unknown";
    }

    const due = new Date(assignment.dueISO);
    if (Number.isNaN(due.getTime())) {
      return assignment.dueText || "Unknown";
    }

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
    if (Number.isNaN(date.getTime())) {
      return "Unknown";
    }

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
}
