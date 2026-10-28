---
Category: Evidence conversion continued after the recording command failed to resolve the package-scoped tsx executable
Source: #1625 (2026-10-27)
Level: 2
Safeguard: The recording pipeline uses script -e and shell set -e, invokes tsx through its owning daemon package, and validates the expected landing outcomes before writing evidence artifacts
Intercepts: 1
Recurrences: 0
Notes: The root-level tsx invocation exits nonzero; the fail-fast recording pipeline rejects it before conversion. The corrected recording contains two merged outcomes and one held outcome from real Git repositories
---
