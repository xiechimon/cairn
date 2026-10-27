---
Category: Delivery metrics selected main recovery by run start and accepted success after the reporting instant
Source: PR #1787 review (2026-10-28)
Level: 2
Safeguard: delivery-metrics-recovery.test.mjs exercises overlapping successes and a completion beyond the reporting instant; CI runs it beside the original delivery metrics tests
Intercepts: 2
Recurrences: 0
Notes: Both controls failed before implementation. The original code reported 120 minutes instead of 30 and prematurely marked an open failure as recovered. Recovery now uses the earliest qualifying completion at or before the report timestamp; all 25 metric controls pass.
---
