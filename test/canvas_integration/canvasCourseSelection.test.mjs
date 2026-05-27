import assert from "node:assert/strict";
import test from "node:test";
import {
  sampleCanvasAssignmentsByCourseId,
  sampleCanvasCourses
} from "./sampleCanvasData.mjs";

const SUBMITTABLE_TYPES = new Set([
  "online_text_entry",
  "online_url",
  "online_upload",
  "media_recording",
  "student_annotation",
  "online_quiz",
  "discussion_topic",
  "external_tool"
]);

function isDateInRange(course, now) {
  const start = course.start_at ? new Date(course.start_at) : null;
  const end = course.end_at ? new Date(course.end_at) : null;

  if (start && start > now) return false;
  if (end && end < now) return false;

  return true;
}

function isCourseAvailable(course, now) {
  return (
    course.workflow_state === "available" &&
    course.enrollment_state === "active" &&
    course.access_restricted_by_date !== true &&
    isDateInRange(course, now)
  );
}

function isSubmittableAssignment(assignment) {
  const submissionTypes = assignment.submission_types ?? [];

  return (
    assignment.workflow_state === "published" &&
    assignment.published !== false &&
    assignment.locked_for_user !== true &&
    submissionTypes.some((type) => SUBMITTABLE_TYPES.has(type))
  );
}

function chooseSubmittableCourses(courses, assignmentsByCourseId, now = new Date()) {
  return courses.filter((course) => {
    const assignments = assignmentsByCourseId[course.id] ?? [];

    return (
      isCourseAvailable(course, now) &&
      assignments.some(isSubmittableAssignment)
    );
  });
}

test("does not connect to Canvas or any network endpoint", () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = () => {
    throw new Error("Tests must not call fetch or connect to Canvas.");
  };

  try {
    const selectedCourses = chooseSubmittableCourses(
      sampleCanvasCourses,
      sampleCanvasAssignmentsByCourseId,
      new Date("2026-05-26T12:00:00Z")
    );

    assert.deepEqual(
      selectedCourses.map((course) => course.id),
      [101, 106]
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("chooses only courses with at least one submittable assignment", () => {
  const selectedCourses = chooseSubmittableCourses(
    sampleCanvasCourses,
    sampleCanvasAssignmentsByCourseId,
    new Date("2026-05-26T12:00:00Z")
  );

  assert.deepEqual(
    selectedCourses.map((course) => course.name),
    ["Biology 101", "Computer Science 150"]
  );
});

test("excludes courses with only on-paper or not-graded assignments", () => {
  const selectedCourses = chooseSubmittableCourses(
    sampleCanvasCourses,
    sampleCanvasAssignmentsByCourseId,
    new Date("2026-05-26T12:00:00Z")
  );

  assert.equal(
    selectedCourses.some((course) => course.id === 102),
    false
  );
});

test("excludes concluded courses even when they contain submittable assignments", () => {
  const selectedCourses = chooseSubmittableCourses(
    sampleCanvasCourses,
    sampleCanvasAssignmentsByCourseId,
    new Date("2026-05-26T12:00:00Z")
  );

  assert.equal(
    selectedCourses.some((course) => course.id === 103),
    false
  );
});

test("excludes future, locked, and unpublished courses", () => {
  const selectedCourses = chooseSubmittableCourses(
    sampleCanvasCourses,
    sampleCanvasAssignmentsByCourseId,
    new Date("2026-05-26T12:00:00Z")
  );

  const selectedIds = selectedCourses.map((course) => course.id);

  assert.equal(selectedIds.includes(104), false);
  assert.equal(selectedIds.includes(105), false);
  assert.equal(selectedIds.includes(107), false);
});

test("treats null start_at and end_at as currently available when the course is otherwise active", () => {
  const selectedCourses = chooseSubmittableCourses(
    sampleCanvasCourses,
    sampleCanvasAssignmentsByCourseId,
    new Date("2026-05-26T12:00:00Z")
  );

  assert.equal(
    selectedCourses.some((course) => course.id === 106),
    true
  );
});
