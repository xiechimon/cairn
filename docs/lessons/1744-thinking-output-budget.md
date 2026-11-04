---
Category: Compaction recovery lowered max_tokens below an enabled Anthropic thinking budget
Source: PR #1933 review (2026-10-28)
Level: 1
Safeguard: All output rewrites pass through withOutput, which enforces the enabled thinking budget plus one token; input fitting reserves the same output floor
Intercepts: 2
Recurrences: 0
Notes: The pre-fix request-level controls failed for both reported-input and generic ceiling errors, while disabled thinking passed. All 22 compaction controls pass after preserving the 4096-token thinking budget and shrinking input when output cannot fit.
---
