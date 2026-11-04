---
Category: Copied verification logs introduced trailing whitespace into the delivery diff
Source: Context-window dependency of PR #1879 (2026-10-28)
Level: 2
Safeguard: git diff --check origin/main...HEAD checks committed evidence as well as source
Intercepts: 1
Recurrences: 0
Notes: The committed raw logs failed the existing diff check. Normalizing trailing whitespace and final empty lines made the same check pass without changing output text or outcomes. Checking only the unstaged diff missed newly added evidence files.
---
