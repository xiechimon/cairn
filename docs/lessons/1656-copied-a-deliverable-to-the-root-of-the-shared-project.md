---
Category: Copied a deliverable to the root of the shared project folder and silently overwrote another thread's file with the same name (`before-after.png`)
Source: Claude thread, sidebar focus ring (2026-10-26)
Level: 5
Safeguard: memory: write project-folder outputs only into a new subdirectory named after the task, and check `ls` for the target name before any `cp` there
Intercepts: 0
Recurrences: 0
Notes: the shared folder lives outside the repo, so no repo gate sees the copy; the overwritten file was recoverable from git (`apps/web/docs/verify/icon-b2/before-after.png`)
---
