---
Category: Report generation omitted completed variants containing only failed attempts
Source: PR #2042 independent review (2026-10-28)
Level: 1
Safeguard: Variant retention and observed case identity use both result and error records
Intercepts: 2
Recurrences: 0
Notes: Two HTML-level controls failed before the fix, an all-error baseline and an all-error candidate beside a successful baseline. Both now render coverage and suspect tasks with withheld headlines. Existing lint also rejected the test regex and string concatenation before their correction.
---
