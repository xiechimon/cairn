---
Category: A CLI directory argument duplicated the configured Vercel project root
Source: Issue #2109 (2026-10-28)
Level: 2
Safeguard: Node regression executes deployment arguments and upload-filter generation against the recorded project root
Intercepts: 0
Recurrences: 0
Notes: The original workflow fails both new cases in docs/verify/2109/red.log; production upload behavior still requires a real deploy
---
