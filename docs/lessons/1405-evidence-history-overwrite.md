---
Category: Redirecting a resumed verification run replaced previously committed evidence logs
Source: #1405 (2026-10-30)
Level: 2
Safeguard: node --test docs/verify/1405/evidence-history.test.mjs asserts that red.log and green.log preserve the committed byte prefix
Intercepts: 0
Recurrences: 0
Notes: The original logs were recovered from HEAD and new outputs appended. The round-only overwritten form fails both prefix assertions in review-2-history-red.log; the restored archives pass in review-2-history-green.log. Round-specific logs keep each fresh run independently readable. The resumed untracked review-2-red.log was also replaced and cannot be recovered from HEAD; only its fresh rerun evidence survives.
---
