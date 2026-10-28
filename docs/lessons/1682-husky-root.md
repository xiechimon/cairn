---
Category: Repository-relative setup and evidence paths were evaluated from apps/web
Source: PR #1769 delivery setup (2026-10-28)
Level: 1
Safeguard: Evidence transfers use absolute destination paths; hook generation and its existence assertion use the repository-root working directory
Intercepts: 1
Recurrences: 1
Notes: The wrong-directory setup stopped before any commit or push when the hook-file assertion failed. A later evidence copy also used a root-relative destination from apps/web and failed without writing. Absolute evidence destinations remove that dependency on the caller's directory. Running pnpm exec husky from the repository root generated the hook and passed the existence assertion. Installation used ignore-scripts throughout.
---
