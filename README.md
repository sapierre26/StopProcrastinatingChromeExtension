# Stop Procrastinating Chrome Extension

## Current architecture

- `canvas_integration/content.js` runs only on `https://canvas.calpoly.edu/*` page loads. It checks the URL, respects a 5-minute cooldown, makes one read-only Canvas Planner API request, normalizes assignment data, and saves it to `chrome.storage.local`.
- `left_tab/` is display-only. It reads the assignment data already saved by `canvas_integration`, listens for `chrome.storage.local` changes, and re-renders the assignment list.
- `right_tab/` is unchanged.

The shared assignment storage key is:

```js
canvas_due_tracker_assignments
```

The shared last-scan metadata key is:

```js
canvas_due_tracker_last_scan
```
