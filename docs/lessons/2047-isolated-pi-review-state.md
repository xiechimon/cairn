---
Category: A source review used shared pi configuration while its integrity check detected a configuration change
Source: PR #2073 independent review (2026-10-28)
Level: 1
Safeguard: Review drivers set PI_CODING_AGENT_DIR to a private task directory, use a task-local route cache and only read-only model tools, and compare the global models, auth and settings file hashes before and after the invocation
Intercepts: 0
Recurrences: 0
Notes: The writer of the earlier detected change was not established. The isolated smoke completed one file read and the successful source review completed 45 read-only tool calls with unchanged global hashes. The actual driver and receipt are archived under docs/verify/2047. No global configuration was restored or rewritten as part of this safeguard; the receipt proves the observed invocation window.
---
