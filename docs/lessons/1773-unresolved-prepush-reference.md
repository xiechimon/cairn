---
Category: A prepush baseline was incorrectly reconstructed from an abbreviated commit identifier
Source: PR #1879 evidence checkpoint push (2026-10-28)
Level: 2
Safeguard: Prepush merge-base rejects nonexistent revisions before selecting checks; retry resolves the remote-tracking commit with git rev-parse --verify
Intercepts: 1
Recurrences: 0
Notes: The documentation push failed before changing the remote. The replacement baseline comes directly from the last pushed tracking ref instead of typed SHA text. Repository types cannot constrain external shell-tool arguments, so the existing Git object validation is the enforceable boundary.
---
