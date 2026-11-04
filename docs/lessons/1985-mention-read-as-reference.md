---
Category: A lexical mention of the decoy path flagged a correct implementation as reuse
Source: Issue #1985 (2026-10-27)
Level: 2
Safeguard: Reference detection strips comments and only flags module specifiers (import/export from, dynamic import, require, side-effect import) resolved against the changed file's directory; Vitest cases cover comment, block-comment, string and prose mentions plus a same-directory import
Intercepts: 1
Recurrences: 0
Notes: selfcheck-red.log records four false flags and one missed same-directory import against the pre-fix substring check
---
