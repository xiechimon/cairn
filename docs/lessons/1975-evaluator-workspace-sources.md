---
Category: Disposable dependency copies imported trusted workspace sources instead of the requested checkout
Source: PR #2067 review round 2 (2026-10-28)
Level: 2
Safeguard: Changed-source fixture and actual evaluator startup exercise checkout imports and root pnpm dependency resolution
Intercepts: 0
Recurrences: 0
Notes: Identical fixture sources hid the stale-package bug; differing sources and the actual evaluator import graph failed before the fixes and passed afterward
---
