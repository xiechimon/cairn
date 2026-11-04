---
Category: Gate recognition incorrectly required an internal verdict immediately before the patch marker and discarded published BLOCK reviews
Source: Issue 1956 (2026-10-28)
Level: 2
Safeguard: A CLI fixture checks the captured production BLOCK header independently from the review transcript layout
Intercepts: 1
Recurrences: 0
Notes: The negative control classified the captured BLOCK comment as unknown; recognition now uses the authenticated publisher and published header and patch markers
---
