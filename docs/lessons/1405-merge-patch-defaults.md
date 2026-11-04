---
Category: A sparse merge configuration patch silently reset omitted limits and human policy to defaults
Source: #1405 (2026-10-30)
Level: 1
Safeguard: Patch fields unwrap defaulted config schemas before becoming optional, so omitted fields cannot synthesize defaults
Intercepts: 0
Recurrences: 0
Notes: Negative controls: patching policy injected cap 10 and patching checks reset a human policy with zero cap. Both runtime regressions fail on the original partial schema and pass with explicitly optional non-defaulted fields.
---
