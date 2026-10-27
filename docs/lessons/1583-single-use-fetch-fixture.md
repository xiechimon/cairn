---
Category: A scheduling regression introduced a single-use fetch helper.
Source: PR #2036 round 2 (2026-10-27)
Level: 2
Safeguard: The single-use-helper gate rejects the named helper; the fetch fixture is inlined at the collector call.
Intercepts: 1
Recurrences: 0
Notes: The actual helper produced one violation before inlining and zero afterwards.
---
