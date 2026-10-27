---
Category: Extracted retry and reporting policies were omitted from harness approval and change detection
Source: PR #1864 review (2026-10-28)
Level: 2
Safeguard: Policy-binding tests drive both CHIEF_DISPATCH_HARNESS_PATHS and touchesHarness for retry code, its budget, coverage, oracle verification, and report generation
Intercepts: 6
Recurrences: 0
Notes: All five paths failed the negative controls before joining the shared binding. The existing item-for-item guard also rejected an unsynchronized saved path list, which is now updated without changing harness_sha. No baseline threshold, allowlist, or saved approval hash was changed.
---
