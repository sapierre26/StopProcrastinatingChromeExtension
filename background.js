const ASSIGNMENTS_KEY = "canvas_due_tracker_assignments";

chrome.runtime.onInstalled.addListener(() => {
  updateBadge();
});

chrome.runtime.onStartup.addListener(() => {
  updateBadge();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes[ASSIGNMENTS_KEY]) {
    updateBadge();
  }
});

async function updateBadge() {
  const result = await chrome.storage.local.get({ [ASSIGNMENTS_KEY]: {} });
  const assignments = Object.values(result[ASSIGNMENTS_KEY] || {});
  const openCount = assignments.filter((assignment) => !assignment.submitted).length;
  const overdueCount = assignments.filter((assignment) => {
    if (assignment.submitted || !assignment.dueISO) {
      return false;
    }
    return new Date(assignment.dueISO).getTime() < Date.now();
  }).length;

  chrome.action.setBadgeText({ text: openCount ? String(openCount) : "" });
  chrome.action.setBadgeBackgroundColor({
    color: overdueCount ? "#991b1b" : "#0f766e"
  });
}
