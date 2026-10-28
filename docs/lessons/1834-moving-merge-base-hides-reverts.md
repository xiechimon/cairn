---
Category: A merge of main into a lane advanced merge-base and hid discarded upstream code from the attribution interval
Source: PR #1848 repair of #1834 (2026-10-28)
Level: 2
Safeguard: The CLI finds the first ancestor shared with main along the lane first-parent history; a real CLI control verifies that an incoming merge which drops the upstream retry names its owning PR
Intercepts: 0
Recurrences: 0
Notes: The original CLI reports zero unexplained removals on the resolved-merge control. After the repair the same control fails with the exact owning PR, path, line and removed text. The GitHub response is stubbed; repository history and gate execution are real.
---
