---
Category: In a narrow column, the fallback-model row's runtime label wrapped to two lines and the long description pressed against the controls on the right; the problem visible in the screenshot was missed in the previous round
Source: #1521 (2026-10-24)
Level: 2
Safeguard: `apps/web/e2e/agent-fallback-models.spec.ts` layout cases (1280 and 560 wide) measure that the label height stays within one line and that the description box and the control box do not intersect and both stay in the row
Intercepts: 1
Recurrences: 0
Notes: Negative control: both widths were red before the fix (label height 32 vs single-line height 17), green after adding whitespace-nowrap and flex-none on the control area
---
