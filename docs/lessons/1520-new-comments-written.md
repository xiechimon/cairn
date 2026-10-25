---
Category: New comments being written (pi demonstrably adds comments)
Source: #1520
Level: 2
Safeguard: PR #1539: `scripts/comment-discipline-gate.mjs` (advisory CI check) plus the dispatch prompt note in `docs/agent-dispatch-prompts.md`
Intercepts: 2
Recurrences: 0
Notes: The separate `.husky/banned.txt` banned-word check blocks specific words; #1481 (2026-10-24) wrote two doc comments on neutralizeIssueAttachmentTokens, and re-running the gate with the original text put back reported 2 lines while removing them reported 0; #1404 S5a edited a pre-existing header note in `verify.ts`, the gate caught it, and restoring the original text left 0 new lines; #1521 negative control: a one-line explanatory comment on a props field made the gate report `agent-model-select.tsx:92` red, and removing it turned green; that run happened at wrap-up instead of before starting work
---
