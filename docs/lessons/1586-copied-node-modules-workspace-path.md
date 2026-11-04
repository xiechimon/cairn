---
Category: When copying a dependency directory, the absolute pnpm workspace paths from another clone were carried over, triggering a reinstall when checks ran
Source: #1586 (2026-10-24)
Level: 3
Safeguard: Resolve workspace package real paths before running tests and keep mutable package-manager state in local directories; Reusing dependencies offline first compares the lockfile, then fixes the workspace state paths in the copied directory and verifies the direct tools run
Intercepts: 1
Recurrences: 1
Notes: Recurred during #1671: whole node_modules symlinks resolved @cairn/shared to main instead of the lane and caused three spurious missing-export failures. Per-module links now point workspace dependencies at the lane, and .pnpm-task-run-state-v1 is a local directory; eight suites then passed 257 tests. This round succeeded after fixing the copied node_modules state; repo code does not own the restore operation of copied dependencies, so a new in-repo gate cannot prevent the external command before copying
---
