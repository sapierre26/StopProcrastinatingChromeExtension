(function canvasIntegration() {
  const CANVAS_HOST = "canvas.calpoly.edu";
  const ASSIGNMENTS_KEY = "canvas_due_tracker_assignments";
  const LAST_SCAN_KEY = "canvas_due_tracker_last_scan";
  const MIN_SCAN_INTERVAL_MS = 5 * 60 * 1000; // 5 mins
  const LOOKBACK_DAYS = 14;
  const LOOKAHEAD_DAYS = 30;
  const MAX_API_PAGES = 1;
  const DATA_FILTER_VERSION = "submittable_assignments_v2_keep_unknown_submission_types";
  const CANVAS_SUBMISSION_TYPES = new Set([
    "discussion_topic",
    "external_tool",
    "media_recording",
    "online_quiz",
    "online_text_entry",
    "online_upload",
    "online_url",
    "student_annotation"
  ]);

  console.log("Running the Alpaca extension canvas_integration script");

  if (!isCalPolyCanvasPage()) {
    return;
  }

  scanOnPageLoad().catch((error) => {
    console.warn("[Canvas Integration] Page-load scan failed", error);
  });

  async function scanOnPageLoad() {
    if (!(await shouldRequestCanvasData())) {
      return;
    }

    const scanStartedAt = new Date().toISOString();
    await markScanStarted(scanStartedAt);

    try {
      // Minimum read-only Canvas request for this extension:
      // one Planner API request scoped to the logged-in user and a small date window.
      const plannerItems = await fetchPlannerItems();
      const normalizedPlannerItems = plannerItems
        .map(normalizePlannerItem)
        .filter(Boolean);
      const normalizedAssignments = normalizedPlannerItems.filter(isAssignmentOpenForSubmissions);

      console.log(
        "[Canvas Integration] Planner items fetched:",
        plannerItems.length,
        "Assignments kept:",
        normalizedAssignments.length,
        "Assignments removed:",
        normalizedPlannerItems.length - normalizedAssignments.length
      );

      // FOLLOW-UP: `normalizedAssignments` is the assignment data returned by Canvas
      // after we normalize it for the popup/farm. Add custom processing here if you
      // want to inspect, transform, or react to assignment data before it is saved.
      await saveAssignments(normalizedAssignments, scanStartedAt);
    } catch (error) {
      await markScanFailed(error, scanStartedAt);
      throw error;
    }
  }

  function isCalPolyCanvasPage() {
    return location.protocol === "https:" && location.hostname.toLowerCase() === CANVAS_HOST;
  }

  async function shouldRequestCanvasData() {
    const result = await chrome.storage.local.get({ [LAST_SCAN_KEY]: null });
    const lastScan = result[LAST_SCAN_KEY];
    const lastScanTime = lastScan?.at ? new Date(lastScan.at).getTime() : 0;

    if (lastScan?.filterVersion !== DATA_FILTER_VERSION) {
      return true;
    }

    if (!Number.isFinite(lastScanTime) || lastScanTime <= 0) {
      return true;
    }

    const enoughTimeElapsed = Date.now() - lastScanTime >= MIN_SCAN_INTERVAL_MS;

    if (!enoughTimeElapsed) {
      console.log("[Canvas Integration] Skipping Canvas scan because the 5-minute cooldown is still active.");
    }

    return enoughTimeElapsed;
  }

  async function fetchPlannerItems() {
    const { startDate, endDate } = getPlannerWindow();

    return fetchJsonPages("/api/v1/planner/items", {
      start_date: startDate,
      end_date: endDate,
      per_page: "100"
    });
  }

  async function fetchJsonPages(path, params = {}) {
    const results = [];
    let url = new URL(path, location.origin);

    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    for (let page = 0; url && page < MAX_API_PAGES; page += 1) {
      const response = await fetch(url.toString(), {
        credentials: "same-origin",
        headers: {
          Accept: "application/json"
        }
      });

      if (!response.ok) {
        throw new Error(`Canvas API returned ${response.status}`);
      }

      const json = await response.json();
      if (Array.isArray(json)) {
        results.push(...json);
      } else if (json) {
        results.push(json);
      }

      url = getNextPageUrl(response.headers.get("Link"));
    }

    return results;
  }

  function normalizePlannerItem(item) {
    if (!item || String(item.plannable_type || "").toLowerCase() !== "assignment") {
      return null;
    }

    const assignment = item.plannable || {};
    const courseId = item.course_id || assignment.course_id || "unknown_course";
    const assignmentId = assignment.id || item.plannable_id;

    if (!assignmentId) {
      return null;
    }

    const dueISO = assignment.due_at || assignment.todo_date || item.plannable_date || null;
    const submission = item.submissions && typeof item.submissions === "object" ? item.submissions : {};
    const submissionTypesInfo = getSubmissionTypes(assignment);
    const submissionAvailability = getSubmissionAvailability(assignment, submissionTypesInfo);
    const statusInfo = getSubmissionStatus(submission, dueISO);
    const now = new Date().toISOString();

    return {
      id: `canvas_${courseId}_${assignmentId}`,
      title: stripHtml(assignment.name || assignment.title || item.title || "Untitled assignment"),
      course: item.context_name || assignment.context_name || assignment.course_name || `Course ${courseId}`,
      dueText: dueISO ? formatDateText(dueISO) : "Unknown",
      dueISO,
      status: statusInfo.status,
      submitted: statusInfo.submitted,
      submittedAt: submission.submitted_at || null,
      score: submission.score ?? assignment.score ?? null,
      grade: submission.grade ?? assignment.grade ?? null,
      late: Boolean(submission.late),
      missing: Boolean(submission.missing),
      submissionTypes: submissionTypesInfo.values,
      submissionTypesKnown: submissionTypesInfo.known,
      canSubmit: submissionAvailability.canSubmit,
      submissionUnavailableReason: submissionAvailability.reason,
      lockedForUser: Boolean(assignment.locked_for_user),
      unlockAt: assignment.unlock_at || null,
      lockAt: assignment.lock_at || null,
      sourceUrl: makeAbsoluteUrl(item.html_url || assignment.html_url || `/courses/${courseId}/assignments/${assignmentId}`),
      pageUrl: location.href,
      source: "canvas_planner_api",
      foundAt: now,
      lastSeenAt: now
    };
  }

  function isAssignmentOpenForSubmissions(assignment) {
    // Important: the Planner API may not always include the full Assignment
    // object fields, including `submission_types` or `can_submit`. In that
    // case, do not drop the assignment. Only remove items when Canvas
    // explicitly tells us they have no online submission path.
    return assignment?.canSubmit !== false;
  }

  function getSubmissionTypes(assignment) {
    if (!Array.isArray(assignment.submission_types)) {
      return { known: false, values: [] };
    }

    return {
      known: true,
      values: assignment.submission_types
        .map((type) => String(type || "").toLowerCase())
        .filter(Boolean)
    };
  }

  function getSubmissionAvailability(assignment, submissionTypesInfo) {
    if (typeof assignment.can_submit === "boolean" && assignment.can_submit) {
      return {
        canSubmit: true,
        reason: null
      };
    }

    const submissionTypes = submissionTypesInfo.values;
    const hasCanvasSubmissionType = submissionTypes.some((type) => CANVAS_SUBMISSION_TYPES.has(type));

    if (submissionTypesInfo.known && !hasCanvasSubmissionType) {
      return { canSubmit: false, reason: "no_canvas_submission_type" };
    }

    if (assignment.locked_for_user) {
      return { canSubmit: false, reason: "locked_for_user" };
    }

    const now = Date.now();
    const unlockTime = parseCanvasTime(assignment.unlock_at);
    if (unlockTime && unlockTime > now) {
      return { canSubmit: false, reason: "not_unlocked_yet" };
    }

    const lockTime = parseCanvasTime(assignment.lock_at);
    if (lockTime && lockTime <= now) {
      return { canSubmit: false, reason: "locked_after_lock_at" };
    }

    // If Canvas gave us `can_submit: false` but did not also give us a clear
    // non-submittable `submission_types` value, keep the assignment. That false
    // can mean things other than "this assignment has no submission option"
    // depending on availability, attempts, submission state, or permissions.
    return { canSubmit: true, reason: null };
  }

  function parseCanvasTime(value) {
    if (!value) {
      return null;
    }

    const time = new Date(value).getTime();
    return Number.isFinite(time) ? time : null;
  }

  function getSubmissionStatus(submission, dueISO) {
    const hasSubmissionData = Boolean(submission && Object.keys(submission).length);
    const submitted = Boolean(
      submission.submitted ||
      submission.submitted_at ||
      submission.graded ||
      submission.needs_grading ||
      submission.with_feedback
    );

    if (submission.missing) {
      return { status: "missing", submitted: false };
    }
    if (submitted) {
      return { status: submission.graded ? "graded" : "submitted", submitted: true };
    }
    if (dueISO && new Date(dueISO).getTime() < Date.now()) {
      return { status: "overdue", submitted: false };
    }
    if (hasSubmissionData) {
      return { status: "unsubmitted", submitted: false };
    }
    return { status: "assigned", submitted: false };
  }

  async function saveAssignments(assignments, scanStartedAt) {
    const now = new Date().toISOString();
    const result = await chrome.storage.local.get({ [ASSIGNMENTS_KEY]: {} });
    const existingAssignments = result[ASSIGNMENTS_KEY] || {};
    const nextAssignments = {};

    for (const assignment of assignments) {
      const previous = existingAssignments[assignment.id] || {};
      nextAssignments[assignment.id] = {
        ...previous,
        ...assignment,
        firstSeenAt: previous.firstSeenAt || assignment.foundAt || now,
        lastSeenAt: now
      };
    }

    // This replaces the Canvas assignment cache with the latest submittable
    // assignments. That intentionally removes old cached items that Canvas now
    // reports as non-submittable, locked, or outside the scan window.
    // This is extension-local storage, not window.localStorage. The popup and
    // content script can both access chrome.storage.local, while normal
    // window.localStorage would be separated by website/extension origin.
    await chrome.storage.local.set({
      [ASSIGNMENTS_KEY]: nextAssignments,
      [LAST_SCAN_KEY]: {
        at: scanStartedAt || now,
        completedAt: now,
        url: location.href,
        host: location.hostname,
        found: assignments.length,
        source: "canvas_integration",
        filterVersion: DATA_FILTER_VERSION,
        status: "ok"
      }
    });
  }

  async function markScanStarted(scanStartedAt) {
    await chrome.storage.local.set({
      [LAST_SCAN_KEY]: {
        at: scanStartedAt,
        url: location.href,
        host: location.hostname,
        found: 0,
        source: "canvas_integration",
        filterVersion: DATA_FILTER_VERSION,
        status: "started"
      }
    });
  }

  async function markScanFailed(error, scanStartedAt) {
    await chrome.storage.local.set({
      [LAST_SCAN_KEY]: {
        at: scanStartedAt,
        completedAt: new Date().toISOString(),
        url: location.href,
        host: location.hostname,
        found: 0,
        source: "canvas_integration",
        filterVersion: DATA_FILTER_VERSION,
        status: "error",
        error: error?.message || "Unknown Canvas scan error"
      }
    });
  }

  function getPlannerWindow() {
    const start = new Date();
    start.setDate(start.getDate() - LOOKBACK_DAYS);
    start.setHours(0, 0, 0, 0);

    const end = new Date();
    end.setDate(end.getDate() + LOOKAHEAD_DAYS);
    end.setHours(23, 59, 59, 999);

    return {
      startDate: start.toISOString(),
      endDate: end.toISOString()
    };
  }

  function getNextPageUrl(linkHeader) {
    if (!linkHeader) {
      return null;
    }

    const nextLink = linkHeader
      .split(",")
      .map((part) => part.trim())
      .find((part) => /rel="next"/i.test(part));
    const match = nextLink && nextLink.match(/<([^>]+)>/);

    return match ? new URL(match[1], location.origin) : null;
  }

  function makeAbsoluteUrl(value) {
    try {
      return new URL(value, location.origin).toString();
    } catch (_error) {
      return location.href;
    }
  }

  function formatDateText(isoValue) {
    const date = new Date(isoValue);
    if (Number.isNaN(date.getTime())) {
      return "Unknown";
    }

    return `${date.toLocaleDateString([], {
      month: "short",
      day: "numeric",
      year: "numeric"
    })}, ${date.toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit"
    })}`;
  }

  function stripHtml(value) {
    const template = document.createElement("template");
    template.innerHTML = String(value || "");
    return (template.content.textContent || "").replace(/\s+/g, " ").trim();
  }
})();
