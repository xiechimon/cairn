---
Category: A disabled button keyboard hint shipped at 1.08:1 contrast while axe exempted disabled controls and aria-hidden text
Source: PR #1766 (2026-10-26), preserved from PR #1776 during reconciliation
Level: 2
Safeguard: apps/web/e2e/contrast-probe.ts measures keyboard hints, disabled controls, placeholders and text as part of a11y-axe.spec.ts
Intercepts: 1
Recurrences: 0
Notes: The original negative control recorded three failures at 1.08:1, 1.25:1 and 2.21:1 before the color fixes; this entry preserves that recorded result without claiming a new run of the old build
---
