---
Category: In a narrow column the fallback model row wrapped the runtime label onto two lines and squeezed the long description against the control on the right; the screenshots from the previous round carried the problem without anyone noticing
Source: #1521 (2026-10-24)
Level: 2
Safeguard: the layout case in `apps/web/e2e/agent-fallback-models.spec.ts` (1280 and 560 wide) measures that the label stays one line high and that the description box and the control box do not intersect and stay inside the row
Intercepts: 1
Recurrences: 0
Notes: negative control: both widths went red before the fix (label height 32 vs single-line 17) and turned green after adding `whitespace-nowrap` and `flex-none` on the control area
---
