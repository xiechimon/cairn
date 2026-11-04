---
Category: Weekly pack export used GNU date -d and left wx outputs that blocked same-day retries
Source: Issue #2097 review gate (2026-10-28)
Level: 2
Safeguard: Portable UTC day offsets via Node; rm pack intermediates before write and on label failure; ops CLI regression for week-window and export/label retry
Intercepts: 1
Recurrences: 0
Notes: Independent review blocked the first head; macOS date rejects -d, and traj:export/traj:label refuse existing out paths
---
