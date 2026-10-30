---
Category: Code and fixtures assumed fields or defaults not guaranteed by their record types
Source: #1405 (2026-10-30)
Level: 1
Safeguard: The GitHub detail projection requires its nullable merge timestamp and repository typecheck rejects undeclared detail fields
Intercepts: 0
Recurrences: 0
Notes: The original timestamp access failed with TS2551; a nullable fixture configuration spread also failed with TS2322 and was corrected by supplying the configuration defaults. The provider timestamp is projected at the boundary and the reconcile regression asserts its persisted value. No cast bypasses the typed boundary. Review round 1 also updates both captured open and merged PR object expectations; missing timestamps are always represented as null.
---
