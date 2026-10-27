---
Category: Copied a deliverable to the root of the shared project folder and silently overwrote another thread's file with the same name (`before-after.png`) / A verification script was written to a bare shared `/tmp/roster-diff.mjs`; a parallel lane on the same machine overwrote that path mid-verification, so the next run printed the other lane's script output instead of the intended comparison
Source: Claude thread, sidebar focus ring (2026-10-26) / #1847 (2026-10-26)
Level: 3
Safeguard: memory: write project-folder outputs only into a new subdirectory named after the task, and check `ls` for the target name before any `cp` there / Scratch verification scripts and their outputs live under a lane-scoped directory `/tmp/<ticket>/` (the convention `pnpm prepush` long-test logging already uses as `/tmp/<lane>.log`); read the output's shape before trusting a shared-path script run
Intercepts: 0
Recurrences: 0
Notes: the shared folder lives outside the repo, so no repo gate sees the copy; the overwritten file was recoverable from git (`apps/web/docs/verify/icon-b2/before-after.png`) / The changed output shape exposed it before any false claim; a command-shape hook over every bash call is disproportionate for /tmp hygiene, so this stays a naming rule
---
