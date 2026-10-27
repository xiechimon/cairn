---
Category: An unclassified scheduling capability bypassed the feature prior-art contract
Source: PR #2030 review of PR #1839 (2026-10-28)
Level: 2
Safeguard: Unclassified new plans require prior art; a small fix requires explicit classification, while saved checklist reads remain compatible
Intercepts: 1
Recurrences: 0
Notes: The original scheduling example failed the new regression before implementation and passes after the fix. A free-form plan has no type-level guarantee that its contents describe a feature, so the runtime contract uses the conservative default.
---
