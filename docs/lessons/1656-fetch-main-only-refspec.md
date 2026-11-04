---
Category: Fetching a lane by name in a main-only clone updated FETCH_HEAD but created no origin/lane reference, so worktree creation failed
Source: #1656 (2026-10-27)
Level: 2
Safeguard: Git rejects worktree creation when the selected base ref is absent; use the fetched FETCH_HEAD or fetch an explicit remote-tracking destination after checking remote.origin.fetch
Intercepts: 1
Recurrences: 0
Notes: Negative control: git worktree add from origin/lane/1656 returned invalid reference under the main-only fetch refspec; creating the isolated worktree from FETCH_HEAD succeeded without changing shared refs
---
