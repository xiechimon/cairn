---
Category: Relative paths with line suffixes were rejected before path normalization ran
Source: #2081 independent review of #1617 (2026-10-28)
Level: 1
Safeguard: Normalize the span token once before every path classifier and reuse that token for filename checks; since 2026-10-28
Intercepts: 0
Recurrences: 0
Notes: The deletion case in scripts/doc-drift.test.mjs fails with an empty list at fd2d2167 and passes after normalization moves ahead of classification. relative-range-red.log and relative-range-green.log record the control and fix. The resulting weekly report finds one additional missing path.
---
