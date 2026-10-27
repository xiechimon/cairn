---
Category: Newly written comments (pi demonstrably adds comments)
Source: #1520
Level: 2
Safeguard: PR #1539: `scripts/comment-discipline-gate.mjs` (CI advisory check) plus the dispatch prompt note in `docs/agent-dispatch-prompts.md`
Intercepts: 1
Recurrences: 0
Notes: The separate `.husky/banned.txt` banned-word check blocks specific words; #1481 (2026-10-24) wrote two doc comments for neutralizeIssueAttachmentTokens, and re-running the gate with the original text put back reported 2 lines while removing them reported 0; #1404 S5a edited a pre-existing header note in `verify.ts`, the gate caught it, and restoring the original text left 0 new lines
---

