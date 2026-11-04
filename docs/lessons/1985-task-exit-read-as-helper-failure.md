---
Category: The task's own exit code 125 was read as an enforcement-availability signal
Source: Issue #1985 (2026-10-27)
Level: 2
Safeguard: The native supervisor reports enforcement only through the audit protocol, COMPLETE after the supervised exec and ENFORCEMENT_UNAVAILABLE otherwise, and a Vitest case keeps a task exiting 125 enforced
Intercepts: 1
Recurrences: 0
Notes: Verified on the raw audit artifact: exit 125 with a working runtime manifest ends in COMPLETE and stays enforced, while a broken manifest or a simulated Landlock ABI 2 kernel ends in ENFORCEMENT_UNAVAILABLE and fails closed
---
