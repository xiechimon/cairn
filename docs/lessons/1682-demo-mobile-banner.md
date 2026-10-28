---
Category: The fixed mobile menu button overlapped the demo banner
Source: PR #1769 current screenshot inspection (2026-10-28)
Level: 2
Safeguard: The demo browser test compares the menu button's actual bounds with the banner and checks a 44px touch target
Intercepts: 1
Recurrences: 0
Notes: The screenshot exposed the overlap and the new assertion failed with y=6 against the banner bottom at 36. The demo-only top position accounts for the banner while the production position and touch target remain unchanged.
---
