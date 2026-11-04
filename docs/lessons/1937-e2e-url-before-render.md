---
Category: An e2e case treated the URL change as proof that the next page had rendered; react-router commits navigation in a transition, so a fast `goBack()` could land before the old page unmounted and the case went red on CI only
Source: #1937 (2026-10-27)
Level: 2
Safeguard: `apps/web/e2e/task-panel.spec.ts` (the leaving case) waits for the old page to be gone and the panel count to be 0 on the new page before going back; after `toHaveURL` on an SPA link, assert something the new page renders before the next navigation
Intercepts: 1
Recurrences: 0
Notes: Red on CI shard 4 at 84b5ce9 and twice locally; green over repeated runs after the wait
---
