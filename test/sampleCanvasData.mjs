export const sampleCanvasCourses = [
  {
    id: 101,
    name: "Biology 101",
    workflow_state: "available",
    enrollment_state: "active",
    access_restricted_by_date: false,
    start_at: "2026-01-10T00:00:00Z",
    end_at: "2026-12-20T00:00:00Z"
  },
  {
    id: 102,
    name: "History 201 - no online submissions",
    workflow_state: "available",
    enrollment_state: "active",
    access_restricted_by_date: false,
    start_at: "2026-01-10T00:00:00Z",
    end_at: "2026-12-20T00:00:00Z"
  },
  {
    id: 103,
    name: "Archived Course",
    workflow_state: "completed",
    enrollment_state: "completed",
    access_restricted_by_date: false,
    start_at: "2025-01-10T00:00:00Z",
    end_at: "2025-12-20T00:00:00Z"
  },
  {
    id: 104,
    name: "Future Course",
    workflow_state: "available",
    enrollment_state: "active",
    access_restricted_by_date: false,
    start_at: "2026-08-01T00:00:00Z",
    end_at: "2026-12-20T00:00:00Z"
  },
  {
    id: 105,
    name: "Locked Course",
    workflow_state: "available",
    enrollment_state: "active",
    access_restricted_by_date: true,
    start_at: "2026-01-10T00:00:00Z",
    end_at: "2026-12-20T00:00:00Z"
  },
  {
    id: 106,
    name: "Computer Science 150",
    workflow_state: "available",
    enrollment_state: "active",
    access_restricted_by_date: false,
    start_at: null,
    end_at: null
  },
  {
    id: 107,
    name: "Unpublished Course",
    workflow_state: "unpublished",
    enrollment_state: "active",
    access_restricted_by_date: false,
    start_at: null,
    end_at: null
  }
];

export const sampleCanvasAssignmentsByCourseId = {
  101: [
    {
      id: 5001,
      name: "Lab report",
      workflow_state: "published",
      locked_for_user: false,
      published: true,
      submission_types: ["online_upload"],
      due_at: "2026-06-01T23:59:00Z"
    }
  ],
  102: [
    {
      id: 5002,
      name: "Paper handout",
      workflow_state: "published",
      locked_for_user: false,
      published: true,
      submission_types: ["on_paper"],
      due_at: "2026-06-01T23:59:00Z"
    },
    {
      id: 5003,
      name: "Ungraded reading",
      workflow_state: "published",
      locked_for_user: false,
      published: true,
      submission_types: ["not_graded"],
      due_at: "2026-06-02T23:59:00Z"
    }
  ],
  103: [
    {
      id: 5004,
      name: "Old quiz",
      workflow_state: "published",
      locked_for_user: false,
      published: true,
      submission_types: ["online_quiz"]
    }
  ],
  104: [
    {
      id: 5005,
      name: "Future discussion",
      workflow_state: "published",
      locked_for_user: false,
      published: true,
      submission_types: ["discussion_topic"]
    }
  ],
  105: [
    {
      id: 5006,
      name: "Locked upload",
      workflow_state: "published",
      locked_for_user: false,
      published: true,
      submission_types: ["online_upload"]
    }
  ],
  106: [
    {
      id: 5007,
      name: "Project checkpoint",
      workflow_state: "published",
      locked_for_user: false,
      published: true,
      submission_types: ["online_text_entry", "online_upload"]
    },
    {
      id: 5008,
      name: "Hidden draft assignment",
      workflow_state: "unpublished",
      locked_for_user: false,
      published: false,
      submission_types: ["online_upload"]
    }
  ],
  107: [
    {
      id: 5009,
      name: "Unpublished course upload",
      workflow_state: "published",
      locked_for_user: false,
      published: true,
      submission_types: ["online_upload"]
    }
  ]
};
