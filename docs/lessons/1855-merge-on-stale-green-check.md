---
Category: A PR merged on a green check that had run three hours earlier while main moved underneath (a dependency bump landed in between), so the squash landed red on main and every lane rebasing on it inherited a failing check and burned diagnosis rounds
Source: #1855 (2026-10-26)
Level: 3
Safeguard: Merge rule: before merging, compare the newest check run's start time on the PR head with the current origin/main head commit date; when main advanced after the run started, re-run the checks (or rebase) and merge on the fresh result
Intercepts: 0
Recurrences: 1
Notes: Negative control is the incident itself: #1818's green run started 09:14Z, #1824 bumped pi-ai 1.0.4 to 1.4.0 at 12:32Z, #1818 merged 15:38Z and main went red within seconds. A machine gate in the merge step (fail when the newest check run predates the last main advance) is feasible; promote it if the category recurs
---
