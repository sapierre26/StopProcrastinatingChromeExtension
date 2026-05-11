(function canvasDueTracker() {
  const ASSIGNMENTS_KEY = "canvas_due_tracker_assignments";
  const LAST_SCAN_KEY = "canvas_due_tracker_last_scan";
  const BADGE_CLASS = "cdt-badge";
  const TOAST_CLASS = "cdt-toast";
  const SCAN_DELAY_MS = 900;
  const MAX_CARD_TEXT_LENGTH = 2200;
  const MAX_API_PAGES = 8;
  const MAX_DASHBOARD_COURSES = 16;

  let scanTimer = null;
  let lastScanSignature = "";

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message && message.type === "CDT_SCAN_NOW") {
      scanAndStore({ showToast: !message.silent }).then(sendResponse);
      return true;
    }
    return false;
  });

  if (!isLikelyCanvasPage()) {
    return;
  }

  // Run once when Chrome injects this content script after a page load or refresh.
  // The URL/page check above prevents non-Canvas pages from doing any work.
  scheduleScan({ showToast: false });

  function scheduleScan(options) {
    window.clearTimeout(scanTimer);
    scanTimer = window.setTimeout(() => {
      scanAndStore(options).catch((error) => {
        console.warn("[Canvas Due Tracker] Scan failed", error);
      });
    }, SCAN_DELAY_MS);
  }

  async function scanAndStore({ showToast }) {
    if (!isLikelyCanvasPage()) {
      if (showToast) {
        showToastMessage("This does not look like a Canvas page.");
      }
      return { ok: false, found: 0, reason: "not_canvas" };
    }

    const apiAssignments = await fetchCanvasAssignments().catch((error) => {
      console.warn("[Canvas Due Tracker] API scan skipped", error);
      return [];
    });
    const domAssignments = scanVisibleCanvasCards();
    const assignments = mergeAssignments([...apiAssignments, ...domAssignments]);
    const signature = assignments
      .map((assignment) => `${assignment.id}:${assignment.status}:${assignment.dueISO || assignment.dueText}`)
      .sort()
      .join("|");

    if (!assignments.length) {
      if (showToast) {
        showToastMessage("No Canvas assignments with due dates were found.");
      }
      return { ok: true, found: 0 };
    }

    if (signature === lastScanSignature && !showToast) {
      return { ok: true, found: assignments.length, skipped: true };
    }

    lastScanSignature = signature;
    await saveAssignments(assignments);
    decorateCards(domAssignments);

    if (showToast) {
      const apiCount = apiAssignments.length;
      const source = apiCount ? "Canvas API and visible page" : "visible page";
      showToastMessage(`Saved ${assignments.length} assignment${assignments.length === 1 ? "" : "s"} from ${source}.`);
    }

    return { ok: true, found: assignments.length };
  }

  async function fetchCanvasAssignments() {
    const courseMap = await getCourseMap();
    const currentCourseId = getCourseIdFromUrl(location.pathname);

    if (currentCourseId) {
      const courseName = courseMap.get(currentCourseId) || getCourseNameFromPage() || `Course ${currentCourseId}`;
      const assignments = await fetchAssignmentsForCourse(currentCourseId, courseName);
      return assignments;
    }

    const courses = Array.from(courseMap.entries()).slice(0, MAX_DASHBOARD_COURSES);
    const allAssignments = [];

    for (const [courseId, courseName] of courses) {
      const bucketed = await fetchAssignmentsForCourse(courseId, courseName, ["upcoming", "overdue", "unsubmitted"]);
      allAssignments.push(...bucketed);
    }

    return allAssignments;
  }

  async function getCourseMap() {
    const map = new Map();
    const currentCourseId = getCourseIdFromUrl(location.pathname);

    if (currentCourseId) {
      map.set(currentCourseId, getCourseNameFromPage() || `Course ${currentCourseId}`);
    }

    const courses = await fetchJsonPages(
      "/api/v1/users/self/courses",
      {
        per_page: "100"
      },
      [["enrollment_state[]", "active"]]
    ).catch(() => []);

    for (const course of courses) {
      if (course && course.id && !course.access_restricted_by_date) {
        map.set(String(course.id), course.name || course.course_code || `Course ${course.id}`);
      }
    }

    return map;
  }

  async function fetchAssignmentsForCourse(courseId, courseName, buckets = [null]) {
    const byId = new Map();

    for (const bucket of buckets) {
      const params = {
        per_page: "100",
        order_by: "due_at"
      };

      if (bucket) {
        params.bucket = bucket;
      }

      const url = `/api/v1/courses/${encodeURIComponent(courseId)}/assignments`;
      const assignments = await fetchJsonPages(url, params, [
        ["include[]", "submission"],
        ["include[]", "all_dates"]
      ]).catch(() => []);

      for (const assignment of assignments) {
        const normalized = normalizeCanvasAssignment(assignment, courseId, courseName);
        if (normalized && !byId.has(normalized.id)) {
          byId.set(normalized.id, normalized);
        }
      }
    }

    return Array.from(byId.values());
  }

  async function fetchJsonPages(path, params = {}, extraPairs = []) {
    const results = [];
    let url = new URL(path, location.origin);

    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    for (const [key, value] of extraPairs) {
      url.searchParams.append(key, value);
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

  function getNextPageUrl(linkHeader) {
    if (!linkHeader) {
      return null;
    }

    const next = linkHeader
      .split(",")
      .map((part) => part.trim())
      .find((part) => /rel="next"/i.test(part));
    const match = next && next.match(/<([^>]+)>/);
    return match ? new URL(match[1], location.origin) : null;
  }

  function normalizeCanvasAssignment(assignment, courseId, courseName) {
    if (!assignment || !assignment.id || !assignment.name) {
      return null;
    }

    const dueISO = getBestDueISO(assignment);
    if (!dueISO) {
      return null;
    }

    const submission = assignment.submission || {};
    const statusInfo = getCanvasStatus(submission, dueISO);
    const url = assignment.html_url || `${location.origin}/courses/${courseId}/assignments/${assignment.id}`;
    const now = new Date().toISOString();

    return {
      id: `canvas_${courseId}_${assignment.id}`,
      title: stripHtml(assignment.name),
      course: courseName || `Course ${courseId}`,
      dueText: formatDateText(dueISO),
      dueISO,
      status: statusInfo.status,
      submitted: statusInfo.submitted,
      submittedAt: submission.submitted_at || null,
      score: submission.score ?? null,
      grade: submission.grade ?? null,
      late: Boolean(submission.late || submission.late_policy_status === "late"),
      missing: Boolean(submission.missing || submission.late_policy_status === "missing"),
      sourceUrl: url,
      pageUrl: location.href,
      source: "canvas_api",
      foundAt: now,
      lastSeenAt: now
    };
  }

  function getBestDueISO(assignment) {
    if (assignment.due_at) {
      return assignment.due_at;
    }

    const allDates = Array.isArray(assignment.all_dates) ? assignment.all_dates : [];
    const firstDate = allDates.find((date) => date && date.due_at);
    return firstDate ? firstDate.due_at : null;
  }

  function getCanvasStatus(submission, dueISO) {
    const workflowState = String(submission.workflow_state || "").toLowerCase();
    const hasSubmittedAt = Boolean(submission.submitted_at);
    const hasGrade = submission.grade !== null && submission.grade !== undefined && submission.grade !== "";
    const missing = Boolean(submission.missing || submission.late_policy_status === "missing");

    if (missing) {
      return { status: "missing", submitted: false };
    }

    if (hasSubmittedAt || workflowState === "submitted" || workflowState === "graded" || workflowState === "pending_review") {
      return { status: workflowState === "graded" || hasGrade ? "graded" : "submitted", submitted: true };
    }

    if (new Date(dueISO).getTime() < Date.now()) {
      return { status: "overdue", submitted: false };
    }

    if (workflowState === "unsubmitted") {
      return { status: "unsubmitted", submitted: false };
    }

    return { status: "due", submitted: false };
  }

  function scanVisibleCanvasCards() {
    const candidates = getCandidateCards();
    const assignments = [];
    const seenIds = new Set();

    for (const card of candidates) {
      const assignment = extractVisibleAssignment(card);
      if (!assignment || seenIds.has(assignment.id)) {
        continue;
      }
      seenIds.add(assignment.id);
      assignments.push(assignment);
    }

    return assignments;
  }

  function getCandidateCards() {
    const selectors = [
      "#assignments .assignment",
      ".assignment",
      "li.assignment",
      ".ig-row",
      ".planner-item",
      ".todo-list li",
      ".to-do-list li",
      "[data-testid*='assignment' i]",
      "[data-testid*='planner' i]",
      "article",
      "li",
      "tr"
    ];
    const likelyElements = Array.from(document.querySelectorAll(selectors.join(",")));
    const candidates = [];
    const seen = new Set();

    for (const element of likelyElements) {
      if (!isVisible(element) || element.closest(`.${TOAST_CLASS}`) || element.closest(`.${BADGE_CLASS}`)) {
        continue;
      }

      const text = getCleanText(element);
      if (!looksLikeCanvasAssignmentText(text)) {
        continue;
      }

      const card = findBestCard(element);
      if (!card || seen.has(card)) {
        continue;
      }

      const cardText = getCleanText(card);
      if (cardText.length < 10 || cardText.length > MAX_CARD_TEXT_LENGTH || !looksLikeCanvasAssignmentText(cardText)) {
        continue;
      }

      seen.add(card);
      candidates.push(card);
    }

    return candidates;
  }

  function findBestCard(element) {
    let best = element;
    let node = element;

    while (node && node !== document.body) {
      const text = getCleanText(node);
      const isCardish = node.matches(
        "#assignments .assignment, .assignment, li.assignment, .ig-row, .planner-item, .todo-list li, .to-do-list li, article, li, tr"
      );

      if (
        isCardish &&
        text.length >= 20 &&
        text.length <= MAX_CARD_TEXT_LENGTH &&
        looksLikeCanvasAssignmentText(text)
      ) {
        best = node;
      }

      if (text.length > MAX_CARD_TEXT_LENGTH) {
        break;
      }

      node = node.parentElement;
    }

    return best;
  }

  function extractVisibleAssignment(card) {
    const lines = getLines(card);
    const fullText = lines.join(" ");
    const due = extractDue(fullText, lines);

    if (!due) {
      return null;
    }

    const title = extractTitle(card, lines);
    if (!title) {
      return null;
    }

    const assignmentUrl = extractAssignmentUrl(card) || location.href;
    const dueISO = parseDueDate(due.text);
    if (!dueISO) {
      return null;
    }

    const courseId = getCourseIdFromUrl(assignmentUrl) || getCourseIdFromUrl(location.pathname) || "visible";
    const assignmentId = getAssignmentIdFromUrl(assignmentUrl) || hashString(`${title}|${due.text}|${assignmentUrl}`);
    const statusInfo = extractVisibleStatus(fullText, dueISO);
    const now = new Date().toISOString();

    return {
      id: `canvas_${courseId}_${assignmentId}`,
      title,
      course: getCourseNameFromPage() || `Course ${courseId}`,
      dueText: due.text,
      dueISO,
      status: statusInfo.status,
      submitted: statusInfo.submitted,
      sourceUrl: assignmentUrl,
      pageUrl: location.href,
      source: "visible_page",
      cardSelectorHint: getSelectorHint(card),
      foundAt: now,
      lastSeenAt: now,
      _card: card
    };
  }

  function extractDue(fullText, lines) {
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (!/\b(due|due date)\b/i.test(line)) {
        continue;
      }

      const combined = /^due(?: date)?$/i.test(line) && lines[index + 1]
        ? `Due ${lines[index + 1]}`
        : line;
      const dueText = cleanDueText(combined);
      if (dueText) {
        return { text: dueText };
      }
    }

    const match = fullText.match(
      /\bDue(?:\s+date)?\s*:?\s*(today|tomorrow|yesterday|(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,?\s+)?(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:,\s*\d{4})?(?:,?\s*(?:at\s*)?\d{1,2}(?::\d{2})?\s*(?:AM|PM)?)?|[0-9]{1,2}\/[0-9]{1,2}(?:\/[0-9]{2,4})?(?:\s+\d{1,2}(?::\d{2})?\s*(?:AM|PM)?)?/i
    );

    if (match) {
      return { text: cleanDueText(match[0]) };
    }

    return null;
  }

  function cleanDueText(value) {
    const cleaned = value
      .replace(/\s+/g, " ")
      .replace(/\bDue\s+date\b/i, "Due")
      .replace(/\bNo due date\b/i, "")
      .replace(/\bAvailable\b.*$/i, "")
      .trim();

    if (!cleaned || /^due$/i.test(cleaned) || /no due date/i.test(cleaned)) {
      return "";
    }

    const dueMatch = cleaned.match(/\bDue\s*:?\s*(.+)$/i);
    if (dueMatch && dueMatch[1]) {
      return dueMatch[1].replace(/\s+/g, " ").trim();
    }

    return cleaned.replace(/^Due\s*:?\s*/i, "").trim();
  }

  function extractVisibleStatus(fullText, dueISO) {
    if (/\b(missing|not submitted)\b/i.test(fullText)) {
      return { status: "missing", submitted: false };
    }
    if (/\b(submitted|turned in|graded|complete|done)\b/i.test(fullText)) {
      return { status: /\bgraded\b/i.test(fullText) ? "graded" : "submitted", submitted: true };
    }
    if (new Date(dueISO).getTime() < Date.now()) {
      return { status: "overdue", submitted: false };
    }
    return { status: "due", submitted: false };
  }

  function extractTitle(card, lines) {
    const selectors = [
      "a[href*='/assignments/']",
      "a[href*='/quizzes/']",
      "a[href*='/discussion_topics/']",
      ".ig-title",
      ".assignment-title",
      ".planner-item-title",
      "h1",
      "h2",
      "h3",
      "h4",
      "[role='heading']"
    ];

    const selected = firstMeaningfulText(
      Array.from(card.querySelectorAll(selectors.join(",")))
        .map((element) => getCleanText(element))
        .sort((a, b) => b.length - a.length)
    );
    if (selected) {
      return selected;
    }

    return firstMeaningfulText(lines);
  }

  function firstMeaningfulText(values) {
    return values
      .map((value) => value.replace(/\s+/g, " ").trim())
      .find((value) => {
        return (
          value.length >= 3 &&
          value.length <= 160 &&
          !/\bdue\b/i.test(value) &&
          !/\b(submitted|not submitted|missing|assigned|returned|graded|points?|score|available|until|view feedback)\b/i.test(value)
        );
      }) || "";
  }

  function extractAssignmentUrl(card) {
    const assignmentLink = Array.from(card.querySelectorAll("a[href]"))
      .map((anchor) => anchor.href)
      .find((href) => /\/courses\/\d+\/(assignments|quizzes|discussion_topics)\//i.test(href));

    return assignmentLink || "";
  }

  function parseDueDate(dueText) {
    const text = dueText
      .replace(/\bat\b/gi, "")
      .replace(/\bDue\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();
    const now = new Date();
    const lower = text.toLowerCase();

    if (lower.startsWith("today")) {
      return withTimeFromText(now, text).toISOString();
    }

    if (lower.startsWith("tomorrow")) {
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      return withTimeFromText(tomorrow, text).toISOString();
    }

    if (lower.startsWith("yesterday")) {
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      return withTimeFromText(yesterday, text).toISOString();
    }

    const hasYear = /\b\d{4}\b/.test(text);
    const candidateText = hasYear ? text : `${text}, ${now.getFullYear()}`;
    let parsed = new Date(candidateText);

    if (!Number.isNaN(parsed.getTime())) {
      if (!hasYear && parsed < startOfToday(now)) {
        parsed = new Date(`${text}, ${now.getFullYear() + 1}`);
      }
      return parsed.toISOString();
    }

    return null;
  }

  function withTimeFromText(date, text) {
    const timeMatch = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(AM|PM)\b/i);
    const next = new Date(date);

    if (timeMatch) {
      let hours = Number(timeMatch[1]);
      const minutes = Number(timeMatch[2] || 0);
      const meridiem = timeMatch[3].toUpperCase();

      if (meridiem === "PM" && hours !== 12) {
        hours += 12;
      }
      if (meridiem === "AM" && hours === 12) {
        hours = 0;
      }

      next.setHours(hours, minutes, 0, 0);
    } else {
      next.setHours(23, 59, 0, 0);
    }

    return next;
  }

  function startOfToday(date) {
    const today = new Date(date);
    today.setHours(0, 0, 0, 0);
    return today;
  }

  async function saveAssignments(assignments) {
    const now = new Date().toISOString();
    const stored = await chrome.storage.local.get({
      [ASSIGNMENTS_KEY]: {},
      [LAST_SCAN_KEY]: null
    });
    const existing = stored[ASSIGNMENTS_KEY] || {};
    const next = { ...existing };

    for (const rawAssignment of assignments) {
      const { _card, ...assignment } = rawAssignment;
      const previous = next[assignment.id] || {};
      const statusChanged = previous.status && previous.status !== assignment.status;
      const dueChanged = previous.dueText && previous.dueText !== assignment.dueText;
      const history = Array.isArray(previous.history) ? [...previous.history] : [];

      if (statusChanged || dueChanged || !previous.id) {
        history.push({
          at: now,
          status: assignment.status,
          submitted: assignment.submitted,
          dueText: assignment.dueText,
          dueISO: assignment.dueISO,
          submittedAt: assignment.submittedAt || null
        });
      }

      next[assignment.id] = {
        ...previous,
        ...assignment,
        foundAt: previous.foundAt || assignment.foundAt || now,
        lastSeenAt: now,
        history: history.slice(-25)
      };
    }

    await chrome.storage.local.set({
      [ASSIGNMENTS_KEY]: next,
      [LAST_SCAN_KEY]: {
        at: now,
        url: location.href,
        found: assignments.length,
        host: location.hostname
      }
    });
  }

  function mergeAssignments(assignments) {
    const byId = new Map();

    for (const assignment of assignments) {
      const existing = byId.get(assignment.id);
      if (!existing) {
        byId.set(assignment.id, assignment);
        continue;
      }

      if (existing.source !== "canvas_api" && assignment.source === "canvas_api") {
        byId.set(assignment.id, { ...existing, ...assignment, _card: existing._card });
      }
    }

    return Array.from(byId.values());
  }

  function decorateCards(assignments) {
    for (const assignment of assignments) {
      const card = assignment._card;
      if (!card || card.querySelector(`.${BADGE_CLASS}`)) {
        continue;
      }

      const badge = document.createElement("span");
      badge.className = BADGE_CLASS;
      badge.dataset.cdtSubmitted = String(assignment.submitted);
      badge.textContent = assignment.submitted ? "Tracked: submitted" : `Tracked: ${assignment.status}`;

      const target =
        card.querySelector("a[href*='/assignments/'], a[href*='/quizzes/'], h1, h2, h3, h4, [role='heading']") ||
        card.firstElementChild ||
        card;
      target.appendChild(badge);
    }
  }

  function showToastMessage(message) {
    document.querySelector(`.${TOAST_CLASS}`)?.remove();
    const toast = document.createElement("div");
    toast.className = TOAST_CLASS;
    toast.textContent = message;
    document.documentElement.appendChild(toast);

    window.setTimeout(() => {
      toast.remove();
    }, 3200);
  }

  function getLines(element) {
    return getCleanText(element)
      .split(/\n+| {2,}/)
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter(Boolean);
  }

  function getCleanText(element) {
    const text = "innerText" in element ? element.innerText : element.textContent;
    return (text || "").replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").trim();
  }

  function looksLikeCanvasAssignmentText(text) {
    return (
      /\bdue\b/i.test(text) &&
      /\b(assignment|quiz|discussion|submitted|not submitted|missing|graded|points?|available|due)\b/i.test(text)
    );
  }

  function isVisible(element) {
    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
      return false;
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function isLikelyCanvasPage() {
    const host = location.hostname.toLowerCase();
    return (host.startsWith("canvas.calpoly.edu/"));
  }

  function getCourseIdFromUrl(value) {
    const match = String(value || "").match(/\/courses\/(\d+)/);
    return match ? match[1] : "";
  }

  function getAssignmentIdFromUrl(value) {
    const match = String(value || "").match(/\/(assignments|quizzes|discussion_topics)\/(\d+)/);
    return match ? `${match[1]}_${match[2]}` : "";
  }

  function getCourseNameFromPage() {
    const breadcrumb = firstMeaningfulText(
      Array.from(document.querySelectorAll("#breadcrumbs a, nav[aria-label*='breadcrumb' i] a"))
        .map((element) => getCleanText(element))
    );
    if (breadcrumb) {
      return breadcrumb;
    }

    const title = document.title.replace(/\s*:\s*.*$/, "").replace(/\s*-\s*Canvas\s*$/i, "").trim();
    return title || "Canvas";
  }

  function getSelectorHint(element) {
    const role = element.getAttribute("role");
    if (element.id) {
      return `#${element.id}`;
    }
    if (role) {
      return `${element.tagName.toLowerCase()}[role="${role}"]`;
    }
    return element.tagName.toLowerCase();
  }

  function formatDateText(isoValue) {
    const date = new Date(isoValue);
    if (Number.isNaN(date.getTime())) {
      return "";
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
    return getCleanText(template.content);
  }

  function hashString(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    return (hash >>> 0).toString(36);
  }
})();
