---
Category: Demo mutation dialogs closed without explaining that changes were not saved
Source: PR #1769 review and browser reproduction (2026-10-28)
Level: 1
Safeguard: The shared AcceptDialog handles the demo completion fallback for every caller; resource forms provide the same notice, and browser cases cover both seams
Intercepts: 4
Recurrences: 1
Notes: The two form cases and the OAuth case failed before their notice calls. Later review found the same missing feedback in task completion; its browser case also failed before the fix. Handling the completion fallback in the shared dialog prevents omission at individual task-menu or board callers. Production callbacks and ordinary-fixture close behavior are preserved. Test values are nonsecret and no provider is contacted.
---
