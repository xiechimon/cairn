---
Category: The avatar swap only swept `SeededAvatar` call sites; the unbound chief's dashed face `ChiefFaceDashed` was a standalone icon and was missed, caught by ian's screenshot
Source: #1429 (2026-10-25)
Level: 1
Safeguard: The `ChiefFaceDashed` component and its generator entry are deleted, so the old icon cannot be referenced again; `chief-stream-markdown.spec.ts` F-R24 asserts the `svg circle[stroke-dasharray]` count is 0
Intercepts: 0
Recurrences: 0
Notes: When swapping visual assets, inventory every on-screen element of the same kind rather than one component's call sites; that half is judgement a machine cannot gate
---

