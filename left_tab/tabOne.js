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
      makeMetaLine("Course", assignment.course || "Canvas")
    );

    const rewardDeadlines = renderAntiProcrastinationDeadlines(assignment);

    header.append(title, status);
    item.append(header, meta, rewardDeadlines);
    return item;
  }

  function renderAntiProcrastinationDeadlines(assignment) {
    const container = document.createElement("section");
    container.className = "antiDeadlines";
    container.setAttribute("aria-label", "Anti-procrastination reward deadlines");

    const title = document.createElement("strong");
    title.className = "antiDeadlinesTitle";
    title.textContent = "Anti-procrastination reward deadlines";
    container.appendChild(title);

    const dueDate = parseDate(assignment.dueISO);
    if (!dueDate) {
      const missing = document.createElement("p");
      missing.className = "antiDeadlineMissing";
      missing.textContent = "Canvas did not provide a due date, so reward deadlines cannot be calculated yet.";
      container.appendChild(missing);
      return container;
    }

    const submittedAt = parseDate(assignment.submittedAt);
    const tiers = [
      {
        label: "Gold",
        className: "gold",
        hoursBeforeDue: 48,
        rewardText: "Best reward: finish at least 48 hours early."
      },
      {
        label: "Silver",
        className: "silver",
        hoursBeforeDue: 24,
        rewardText: "Solid reward: finish at least 24 hours early."
      },
      {
        label: "Bronze",
        className: "bronze",
        hoursBeforeDue: 1,
        rewardText: "Last-call reward: finish at least 1 hour early."
      }
    ];

    const list = document.createElement("div");
    list.className = "antiDeadlineList";

    for (const tier of tiers) {
      const deadline = new Date(dueDate.getTime() - tier.hoursBeforeDue * 60 * 60 * 1000);
      const earned = Boolean(submittedAt && submittedAt.getTime() <= deadline.getTime());
      const submittedAfterDeadline = Boolean(submittedAt && submittedAt.getTime() > deadline.getTime());
      const submittedButTimeUnknown = Boolean(assignment.submitted && !submittedAt);
      const passed = !earned && deadline.getTime() < Date.now();

      const card = document.createElement("div");
      card.className = `antiDeadline antiDeadline-${tier.className}`;
      if (earned) {
        card.classList.add("isEarned");
      } else if (passed || submittedAfterDeadline) {
        card.classList.add("isPassed");
      }

      const badge = document.createElement("span");
      badge.className = "antiDeadlineBadge";
      badge.textContent = tier.label;

      const details = document.createElement("div");
      details.className = "antiDeadlineDetails";

      const dueLine = document.createElement("span");
      dueLine.className = "antiDeadlineTime";
      dueLine.textContent = `${getRewardDeadlinePrefix({ earned, submittedAfterDeadline, submittedButTimeUnknown, passed })} ${formatDateTime(deadline)}`;

      const blurb = document.createElement("small");
      blurb.className = "antiDeadlineBlurb";
      blurb.textContent = getRewardBlurb({ tier, earned, submittedAfterDeadline, submittedButTimeUnknown });

      details.append(dueLine, blurb);
      card.append(badge, details);
      list.appendChild(card);
    }

    container.appendChild(list);
    return container;
  }

  function makeMetaLine(label, value) {
    const line = document.createElement("span");
    line.textContent = `${label}: ${value}`;
    return line;
  }

  function getRewardDeadlinePrefix({ earned, submittedAfterDeadline, submittedButTimeUnknown, passed }) {
    if (earned) {
      return "Earned by";
    }
    if (submittedAfterDeadline) {
      return "Missed reward deadline";
    }
    if (submittedButTimeUnknown) {
      return "Reward deadline";
    }
    if (passed) {
      return "Was due by";
    }
    return "Finish by";
  }

  function getRewardBlurb({ tier, earned, submittedAfterDeadline, submittedButTimeUnknown }) {
    if (earned) {
      return `Reward earned: submitted in time for the ${tier.label.toLowerCase()} anti-procrastination reward.`;
    }
    if (submittedAfterDeadline) {
      return `Submitted after this checkpoint, so the ${tier.label.toLowerCase()} reward was missed.`;
    }
    if (submittedButTimeUnknown) {
      return `Canvas says this is submitted, but it did not include the submission time needed to confirm the ${tier.label.toLowerCase()} reward.`;
    }
    return `${tier.rewardText} Get it done by then to earn the ${tier.label.toLowerCase()} anti-procrastination reward.`;
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

    const due = parseDate(assignment.dueISO);
    if (!due) {
      return assignment.dueText || "Unknown";
    }

    return formatDateTime(due);
  }

  function formatDateTime(date) {
    return `${date.toLocaleDateString([], {
      month: "short",
      day: "numeric",
      year: "numeric"
    })}, ${date.toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit"
    })}`;
  }

  function parseDate(value) {
    if (!value) {
      return null;
    }

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
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
