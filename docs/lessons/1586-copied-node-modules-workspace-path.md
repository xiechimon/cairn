---
Category: When copying a dependency directory, the absolute pnpm workspace paths from another clone were carried over, triggering a reinstall when checks ran
Source: #1586 (2026-10-24)
Level: 3
Safeguard: Reusing dependencies offline first compares the lockfile, then fixes the workspace state paths in the copied directory and verifies the direct tools run
Intercepts: 1
Recurrences: 0
Notes: This round succeeded after fixing the copied node_modules state; repo code does not own the restore operation of copied dependencies, so a new in-repo gate cannot prevent the external command before copying
---

