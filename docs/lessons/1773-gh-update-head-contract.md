---
Category: The installed gh pr update-branch command rejected an assumed expected-head flag
Source: PR #2052 merge preparation (2026-10-28)
Level: 1
Safeguard: The GitHub update-branch REST request supplies expected_head_sha, so a changed PR head cannot be overwritten
Intercepts: 0
Recurrences: 0
Notes: The unsupported CLI flag failed before mutation. The conditional REST request succeeded; all reviewed source and test blobs matched the approved commit after synchronization. No unconditional retry or forced push was used.
---
