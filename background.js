const ASSIGNMENTS_KEY = "canvas_due_tracker_assignments";
const FARM_STATE_KEY = "canvas_due_tracker_farm";
const HEALTH_WARNING_HOURS = 1;

chrome.runtime.onInstalled.addListener(async () => {
  await ensureFarmState();
  updateBadge();
  checkHealthNotifications();
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureFarmState();
  updateBadge();
  checkHealthNotifications();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes[ASSIGNMENTS_KEY]) {
    updateBadge();
    checkHealthNotifications();
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'openFullscreen') {
    chrome.windows.create({
      url: chrome.runtime.getURL('expanded.html'),
      type: 'normal',
      width: 1200,
      height: 800
    }).then(() => {
      sendResponse({ success: true });
    }).catch((error) => {
      console.error('Failed to create fullscreen window:', error);
      sendResponse({ success: false, error: error.message });
    });
    return true;
  } else if (request.action === 'openCompact') {
    chrome.windows.create({
      url: chrome.runtime.getURL('expanded.html'),
      type: 'popup',
      width: 420,
      height: 560
    }).then(() => {
      sendResponse({ success: true });
    }).catch((error) => {
      console.error('Failed to create compact window:', error);
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }
});

async function ensureFarmState() {
  const result = await chrome.storage.local.get({ [FARM_STATE_KEY]: null });
  if (!result[FARM_STATE_KEY]) {
    await chrome.storage.local.set({ [FARM_STATE_KEY]: getDefaultFarmState() });
  }
}

function getDefaultFarmState() {
  return {
    createdAt: Date.now(),
    alpacaCount: 1,
    earnedCustomizations: [],
    lastHealthNotifications: {}
  };
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

async function checkHealthNotifications() {
  const result = await chrome.storage.local.get({
    [ASSIGNMENTS_KEY]: {},
    [FARM_STATE_KEY]: getDefaultFarmState()
  });

  const assignments = Object.values(result[ASSIGNMENTS_KEY] || {});
  const farmState = result[FARM_STATE_KEY] || getDefaultFarmState();
  notifyImpendingDeadlines(assignments, farmState);
}

async function notifyImpendingDeadlines(assignments, farmState) {
  const now = Date.now();
  const candidates = assignments
    .filter((assignment) => !assignment.submitted && assignment.dueISO)
    .map((assignment) => ({
      assignment,
      dueDate: new Date(assignment.dueISO).getTime(),
      timeLeftMs: new Date(assignment.dueISO).getTime() - now
    }))
    .filter((item) => item.timeLeftMs > 0 && item.timeLeftMs <= HEALTH_WARNING_HOURS * 60 * 60 * 1000)
    .sort((a, b) => a.timeLeftMs - b.timeLeftMs);

  if (!candidates.length) {
    return;
  }

  const nextAssignment = candidates[0].assignment;
  const notificationKey = nextAssignment.id || nextAssignment.sourceUrl || `${nextAssignment.title}-${nextAssignment.dueISO}`;
  const lastNotifiedDue = farmState.lastHealthNotifications?.[notificationKey];
  const dueStamp = new Date(nextAssignment.dueISO).getTime();

  if (lastNotifiedDue === dueStamp) {
    return;
  }

  await chrome.notifications.create(`alpaca-health-${notificationKey}`, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('images/animal_assets/alpaca.png'),
    title: 'Alpaca health warning',
    message: `Your alpaca is stressed: "${nextAssignment.title || 'An assignment'}" is due soon. Submit before ${new Date(nextAssignment.dueISO).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} to help it.`,
    priority: 2
  });

  farmState.lastHealthNotifications = {
    ...(farmState.lastHealthNotifications || {}),
    [notificationKey]: dueStamp
  };

  await chrome.storage.local.set({ [FARM_STATE_KEY]: farmState });
}
