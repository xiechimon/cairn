---
Category: A red suite continued reading implementation files while they were being edited
Source: Ticket 1408 review round 1 (2026-10-30)
Level: 1
Safeguard: The test harness copies shell, Python and backup sources into a private snapshot at module load, so later working-tree edits cannot alter an active suite; baseline overrides select HEAD controls; since 2026-10-30
Intercepts: 0
Recurrences: 1
Notes: Round 2 caught another full-suite overlap with implementation edits; that mixed run is excluded and replaced by immutable HEAD red controls. The source snapshot now applies automatically to every test run.
---
