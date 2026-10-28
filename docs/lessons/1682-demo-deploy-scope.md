---
Category: The demo deployment skip command ignored shared-package and root dependency changes
Source: PR #1769 deployment configuration review (2026-10-28)
Level: 2
Safeguard: Six cases execute the actual configured ignore command from apps/web inside real temporary Git repositories
Intercepts: 4
Recurrences: 0
Notes: The original command returned the skip status for shared source, the lockfile, the workspace catalog, and the root package manifest. Correct repository-relative paths make those four cases request a build while preserving the unrelated-docs skip and web-source build cases. This verifies the command's behavior, not an actual Vercel deployment.
---
