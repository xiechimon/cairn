---
Category: Runner setup replaced supplementary groups but retained a privileged primary group
Source: Ticket 2189 (2026-10-30)
Level: 2
Safeguard: Scratch setup regression starts with docker as primary group and requires the dedicated runner group after setup
Intercepts: 0
Recurrences: 0
Notes: The original script fails the regression with docker retained; the fixed script selects cairn-runner and passes. Real Linux identity and ownership checks remain dispatcher acceptance requirements.
---
