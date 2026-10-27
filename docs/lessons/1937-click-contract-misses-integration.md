---
Category: A change to what a board card click does (open in place instead of navigate) was swept through `apps/web/e2e` but not through `integration/test`, whose live-stack suites also click cards to reach the detail page; the local prepush does not run those suites, so only CI went red
Source: #1937 (2026-10-27)
Level: 1
Safeguard: when a click, route or URL contract changes, grep both `apps/web/e2e` and `integration/test` for the selector or link name, and run the matching integration files with `VITEST_PROJECT_SET=integration pnpm exec vitest run <files>` after a web build
Intercepts: 1
Recurrences: 1
Notes: Thirteen cases in four integration files waited for `.detail-shell` after a card click; they now go through the panel's expand link and pass locally. Recurrence the same day: moving the chief drawer under the panel provider changed the drawer chip click too, and two `chief-stream-markdown` cases still waited for the detail URL; run the full affected set (`pnpm --filter @cairn/web e2e:affected`) before pushing, not only the specs you edited
---
