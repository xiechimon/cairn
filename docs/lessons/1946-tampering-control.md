---
Category: Escaped tool output was incorrectly interpreted as an invalid shell tampering script
Source: Issue #1946 (2026-10-27)
Level: 2
Safeguard: Execute the replacement grader and compare its emitted reward bytes before drawing a conclusion from rendered output
Intercepts: 1
Recurrences: 0
Notes: A local executable reproduction confirmed both inherited and simplified scripts emit valid passing rewards; the final agent also executes its replacement grader before independent verification
---
