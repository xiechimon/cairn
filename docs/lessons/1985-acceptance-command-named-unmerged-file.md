---
Category: A documented acceptance command referenced a test file that only exists in an unmerged PR
Source: Issue #1985 (2026-10-27)
Level: 3
Safeguard: The verify README documents only commands whose files exist on the branch and names the open PR #2014 dependency explicitly, together with the raw-evidence link requirement for the PR body
Intercepts: 1
Recurrences: 0
Notes: No machine surface can validate doc command accuracy; prepush-vitest runs the suite that does exist
---
