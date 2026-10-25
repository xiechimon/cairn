---
Category: A rebase conflict resolution edited the conflicted hunk with a partial string replacement that dropped only the tail of a Chinese doc comment, leaving it unterminated; the file became a parse error and the gates reported hundreds of cascading comment lines instead of the real spot
Source: #1404 S5a rebase (2026-10-25)
Level: 3
Safeguard: Resolve conflict hunks as whole blocks with exact-match structured edits, then read the resolved region back in full and run the three text gates plus typecheck before `git rebase --continue`; a resolution that leaves the tree red is caught in the same minute, not after the whole rebase
Intercepts: 0
Recurrences: 0
Notes: The existing gates caught it (single-use-helper-gate reported "Cannot parse", english-only-gate reported the three leftover Chinese lines); the fix was read back and all gates went to 0
---
