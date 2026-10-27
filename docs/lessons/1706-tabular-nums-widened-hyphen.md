---
Category: Global `font-variant-numeric: tabular-nums` widened Inter's hyphen, so `r3-lifecycle` rendered as `r3 - lifecycle`; card-local tabular-nums on the time also pushed the meta strip 0.16px past its box
Source: Claude thread `打磨 Cairn 界面细节` (2026-10-25)
Level: 2
Safeguard: `e2e/ticket-cost.spec.ts` meta-strip overflow assertion went red with tabular-nums on the time and green without it; the global rule was dropped after an isolated render
Intercepts: 1
Recurrences: 0
Notes: Use tabular-nums only on columns of live-changing digits
---

