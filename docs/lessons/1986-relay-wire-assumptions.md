---
Category: Relay assertions assumed string content and the wrong role request index
Source: Issue #1986 (2026-10-27)
Level: 2
Safeguard: Session integration assertions inspect real backend message blocks and select the response request for the tested role
Intercepts: 1
Recurrences: 1
Notes: The wrong-index form is covered: the handoff arm asserts the executor request, whose index shifts with the planner turn count, and a probe on this branch measured three requests with the executor at index 2. The earlier claim that a correction caught the index error and a trailing-newline mismatch is dropped, because neither correction appears in this branch's diff and the entry recorded history the diff cannot support
---
