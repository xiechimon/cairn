---
Category: Custom source rewrite wrappers failed on a formatting-dependent anchor and escaped newline syntax
Source: PR #1879 context propagation repair (2026-10-28)
Level: 2
Safeguard: Source changes use the native context-matched patch operation instead of a custom multi-file Python rewrite
Intercepts: 2
Recurrences: 1
Notes: Both wrapper attempts stopped before editing files. The replacement patch checked the actual file contexts and applied the intended source delta. Repository types cannot constrain code embedded in an external shell command; removing that intermediate rewrite program avoids this error path.
---
