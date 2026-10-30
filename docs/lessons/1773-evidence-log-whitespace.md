---
Category: Copied verification logs introduced trailing whitespace into the delivery diff
Source: Context-window dependency of PR #1879 (2026-10-28)
Level: 2
Safeguard: git diff --check origin/main...HEAD checks committed evidence as well as source; this run also checks unstaged evidence after normalization; since 2026-10-30
Intercepts: 1
Recurrences: 2
Notes: The committed raw logs failed the existing diff check. Normalizing trailing whitespace and final empty lines made the same check pass without changing output text or outcomes. Checking only the unstaged diff missed newly added evidence files. Ticket 1408 review round 1 caught raw node and Vitest output whitespace before delivery; normalized evidence then passed. Level 1 cannot constrain subprocess output, so normalize at the archive boundary and retain the diff gate. Ticket 1408 review round 2 again caught raw node/Vitest whitespace with the unstaged diff gate; final archived logs are normalized.
---
