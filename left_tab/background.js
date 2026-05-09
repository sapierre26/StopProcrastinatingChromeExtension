const ASSIGNMENTS_KEY = "canvas_due_tracker_assignments";
const AUTO_SCAN_ALARM = "canvas_due_tracker_auto_scan";
const AUTO_SCAN_PERIOD_MINUTES = 5;

chrome.runtime.onInstalled.addListener(() => {
  ensureAutoScanAlarm();
  updateBadge();
});

chrome.runtime.onStartup.addListener(() => {
  ensureAutoScanAlarm();
  updateBadge();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === AUTO_SCAN_ALARM) {
    scanOpenTabs();
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && isScannableUrl(tab.url)) {
    requestTabScan(tabId);
  }
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.tabs.get(tabId, (tab) => {
    if (!chrome.runtime.lastError && isScannableUrl(tab?.url)) {
      requestTabScan(tabId);
    }
  });
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes[ASSIGNMENTS_KEY]) {
    updateBadge();
  }
});

function ensureAutoScanAlarm() {
  chrome.alarms.create(AUTO_SCAN_ALARM, {
    delayInMinutes: 1,
    periodInMinutes: AUTO_SCAN_PERIOD_MINUTES
  });
}

function scanOpenTabs() {
  chrome.tabs.query({ url: "https://*/*" }, (tabs) => {
    if (chrome.runtime.lastError || !Array.isArray(tabs)) {
      return;
    }

    for (const tab of tabs) {
      if (tab.id && isScannableUrl(tab.url)) {
        requestTabScan(tab.id);
      }
    }
  });
}

function requestTabScan(tabId, attempt = 0) {
  chrome.tabs.sendMessage(tabId, { type: "CDT_SCAN_NOW", silent: true }, () => {
    if (chrome.runtime.lastError && attempt < 2) {
      setTimeout(() => requestTabScan(tabId, attempt + 1), 1000);
    }
  });
}

function isScannableUrl(url) {
  return typeof url === "string" && url.startsWith("https://");
}

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
