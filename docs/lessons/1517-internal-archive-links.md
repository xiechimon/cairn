---
Category: An internal relative symlink was rejected as an archive escape
Source: "#1517 (2026-10-27)"
Level: 2
Safeguard: The converter resolves link targets against their archive directory before checking root escape, with a regression fixture containing a parent-relative internal link
Intercepts: 1
Recurrences: 0
Notes: The original converter rejected the real base archive for PR 1990; the regression test failed before the correction and passed afterward
---
