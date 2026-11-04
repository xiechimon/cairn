---
Category: Extending the branch-note suffix stopped historical stored notes from being stripped
Source: #1834 (2026-10-26)
Level: 2
Safeguard: `packages/shared/test/github-overlap-prompt.test.ts` checks both current and historical branch notes
Intercepts: 1
Recurrences: 0
Notes: Negative control: the historical note stayed in task text under the new suffix; recognizing both suffixes restores the original task text
---
