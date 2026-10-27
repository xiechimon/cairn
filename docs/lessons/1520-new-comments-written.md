---
Category: New comments being written (pi demonstrably adds comments) / Newly written comments (pi demonstrably adds comments)
Source: #1520
Level: 2
Safeguard: PR #1539: `scripts/comment-discipline-gate.mjs` (advisory CI check) plus the dispatch prompt `docs/agent-dispatch-prompts.md` / PR #1539: `scripts/comment-discipline-gate.mjs` (CI advisory check) plus the dispatch prompt note in `docs/agent-dispatch-prompts.md`
Intercepts: 3
Recurrences: 0
Notes: Also the `.husky/banned.txt` banned-word check intercepts specific words; #1481 (2026-10-24) wrote two doc comments on neutralizeIssueAttachmentTokens — restoring the original made the gate report 2 lines, removing them reported 0 / The separate `.husky/banned.txt` banned-word check blocks specific words; #1481 (2026-10-24) wrote two doc comments for neutralizeIssueAttachmentTokens, and re-running the gate with the original text put back reported 2 lines while removing them reported 0; #1404 S5a edited a pre-existing header note in `verify.ts`, the gate caught it, and restoring the original text left 0 new lines
---
