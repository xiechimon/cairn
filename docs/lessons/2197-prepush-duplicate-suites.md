---
Category: A file-count cap left local prepush duplicating suites owned by CI
Source: #2197 (2026-10-30)
Level: 2
Safeguard: scripts/prepush.test.mjs rejects local Vitest-wrapper, web-unit-suite and affected-e2e steps while pinning the unchanged CI plan; since 2026-10-30
Intercepts: 0
Recurrences: 0
Notes: The owner rejected the earlier 60-file cap because it still duplicated CI. tests-red.log records three failures against that plan before implementation; tests-green.log records the corrected plan. Heavy-slot regressions assert occupied-slot bypass, port independence and e2e-shard queueing; port-binding cases require a host that permits local listeners.
---
