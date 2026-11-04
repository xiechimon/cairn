---
Category: An identifier left only in integration fixtures concealed its removal from the application scope
Source: #2023 repair of #1617 (2026-10-28)
Level: 2
Safeguard: The CLI regression in `scripts/doc-drift.test.mjs` removes an application export while retaining its name in an integration fixture; since 2026-10-28
Intercepts: 0
Recurrences: 0
Notes: identifier-scope-red.log records the empty result before narrowing the code search to the acceptance checklist scope; targeted-green.log records the corrected result.
---
