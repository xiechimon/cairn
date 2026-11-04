---
Category: Bare image URLs followed by punctuation silently bypassed the evidence gate
Source: Issue #1982 pre-push review (2026-10-27)
Level: 2
Safeguard: Evidence gate regression tests assert not-embedded verdicts and exact HTTP targets for punctuation and adjacent markup
Intercepts: 1
Recurrences: 0
Notes: The regression produced five failing subcases before the fix and passes after bare URL normalization; explicit embeds retain their complete URLs.
---
