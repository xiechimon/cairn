---
Category: A review fix copied rule text into a second document, and the next review round found contradictions the copy introduced
Source: #2166 (2026-10-29), E1.0a goal run
Level: 3
Safeguard: AGENTS.md "Cap review rounds" (fix the class, re-evaluate after three rounds) and "Current merge state", which keeps the route definitions only in ADR 0028 and links them; pending upgrade to a gate rule in #1909
Intercepts: 0
Recurrences: 0
Notes: The same kind as #2158 (before this entry existed), where two later blockers came from earlier fixes. Here the round-1 fix pasted the three merge routes into both AGENTS.md and ADR 0028 and widened the needs-decision paragraph beyond pr-cairn; round 2 then found drift between the copies, a command that did not run and a pr-cairn contradiction. The round-2 fix moved the routes to one source and pinned the shared needs-decision wording in scripts/agent-rules.test.mjs, which runs on every PR through selfTests.
---
