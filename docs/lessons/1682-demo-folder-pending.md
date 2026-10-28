---
Category: A demo folder-picker request entered pending state and a hidden fallback queried the backend
Source: PR #1769 browser review (2026-10-28)
Level: 1
Safeguard: The handler rejects demo actions before setting pending state and the directory-browser component exists only while its popover is open
Intercepts: 2
Recurrences: 0
Notes: The first valid browser control observed a permanently disabled browse button. After the handler guard, the unchanged zero-traffic assertion caught GET /api/fs/list from the closed fallback. Conditional mounting removes that eager query. All 21 demo browser cases then passed without weakening traffic, notice, or enabled-state assertions.
---
