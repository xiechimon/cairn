---
Category: The default-off first-PR prompt had no UI control for enabling it
Source: PR #2026 round 2 (2026-10-27)
Level: 2
Safeguard: Browser tests enable the team setting through Account, reload, display the card, dismiss it permanently, and reject failed saves
Intercepts: 1
Recurrences: 0
Notes: Both new browser tests failed because the switch was absent before implementation and passed after the control was connected to the team mutation
---
