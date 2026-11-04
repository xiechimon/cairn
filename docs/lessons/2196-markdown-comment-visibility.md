---
Category: Literal HTML comment openers inside code spans hid live PR tasks and section headings
Source: #2196 (2026-10-30)
Level: 2
Safeguard: Both PR gates use scripts/pr_body.py; regression cases cover literal openers, real comments, fenced examples, blockquoted tasks and original line numbers; since 2026-10-30
Intercepts: 0
Recurrences: 0
Notes: The supplied literal-opener bodies and blockquoted unchecked task failed their assertions before the shared scanner and passed afterward. The red output is appended to docs/verify/2196/gates-red.log. Free-form Markdown visibility requires runtime parsing and cannot be guaranteed by types alone.
---
