---
Category: Historical migration fixtures seeded through the latest ORM schema requested columns not present in their old database
Source: Issue #1974 (2026-10-27)
Level: 1
Safeguard: Historical migration fixtures use main's insertLegacyUserAndTeam with explicit original user and team SQL columns instead of importing the production seed and its evolving schema
Intercepts: 1
Recurrences: 0
Notes: Preserving current main's first-PR team columns exposed the old fixture coupling; the existing upgrade tests failed before the fixture change and passed afterward without weakening migration assertions; the final fixtures and helper are reused from main PR #2026
---
