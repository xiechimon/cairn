---
Category: Reordering split child creation dropped output from the in-memory children used to render the parent plan
Source: PR #1654 repair (2026-10-28)
Level: 2
Safeguard: The child projection retains output; persona-split-verify.test.ts checks both the stored info kind and the information-delivery label in the real parent plan
Intercepts: 0
Recurrences: 0
Notes: The original feature stored output correctly but failed the plan-label assertion. Preserving the projection fixes the label without changing information-card execution semantics.
---
