---
Category: Split spec extraction discarded protected root names, directory mentions and unsafe path characters before classification
Source: PR #1654 repair (2026-10-28)
Level: 2
Safeguard: The checker preserves quoted paths and whole tokens, treats whitespace between adjacent path-shaped tokens as unclear, then reuses the protected-category matcher; todo-split-checker.test.ts pins root files, directory-only mentions, Unicode protection and unclear paths
Intercepts: 0
Recurrences: 0
Notes: The original checker passed eight protected or unclear cases; whitespace inside a quoted path exposed two more failures before preserving quoted tokens. Independent review found the same ambiguity without quotes; split-review-regressions.test.ts makes that exact spec fail before the fix and preserves separate ordinary references joined by prose. Ordinary unprotected paths and a valid plan still pass.
---
