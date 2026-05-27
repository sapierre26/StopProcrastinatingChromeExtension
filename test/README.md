# Canvas course-selection tests

These tests use local sample Canvas-shaped data only. They do not call Canvas, do not use `fetch`, and do not require credentials.

Run from the extension root:

```bash
node --test test/*.test.mjs
```

Expected selected course IDs from the sample data:

```text
101, 106
```

The tests verify that selected courses are active, available, not date-restricted, not concluded/future/unpublished, and have at least one submittable assignment.
