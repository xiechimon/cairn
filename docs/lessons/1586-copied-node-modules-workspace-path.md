---
Category: When copying a dependency directory, the absolute pnpm workspace path from another clone was reused, and running checks triggered a reinstall
Source: #1586 (2026-10-24)
Level: 3
Safeguard: before reusing dependencies offline, compare the lockfile, then fix the workspace state paths in the copied directory and verify the direct tools run
Intercepts: 1
Recurrences: 0
Notes: this round fixed the copied node_modules state and the pnpm checks then ran; repo code does not own the restore operation of copied dependencies, so no in-repo gate can prevent the external command before copying
---
