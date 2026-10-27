---
Category: A `sed -i` one-liner used for a regex edit in a test file corrupted the line (unbalanced parentheses), and the very next vitest run died in the transform step before any test executed
Source: #1692 (2026-10-25)
Level: 3
Safeguard: Code edits go through exact-match structured replacement (the edit tool), which cannot unbalance delimiters silently; `sed` is reserved for mechanical prose substitution with a grep read-back, never for source lines
Intercepts: 1
Recurrences: 0
Notes: Caught in the same minute by the transform error naming the file and position; no machine gate above level 3 is proportionate for a single self-inflicted syntax slip
---

