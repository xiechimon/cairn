---
Category: Split approval reused runtime and required-capability checks but omitted the existing home-machine selected-model rejection
Source: PR #1654 independent review (2026-10-28)
Level: 1
Safeguard: The split checker calls homeMachineRejectReason with the complete machine report and the existing merged catalog snapshot, then applies unchanged missingCapabilities semantics
Intercepts: 0
Recurrences: 0
Notes: Before the fix, the checker passed four selected-model cases rejected by the existing home guard: no report, installed false, model absent and catalog dead. The differential regression passes after reusing the guard; a healthy selected model still passes. Global claim eligibility, concurrency and unknown required-capability behavior are unchanged.
---
