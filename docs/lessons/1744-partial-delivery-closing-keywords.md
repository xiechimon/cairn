---
Category: Historical commit messages would close an unfinished parent issue despite a partial-delivery PR body
Source: PR #1933 merge preparation and final audit (2026-10-28)
Level: 2
Safeguard: The merge-message verifier checks the live autoMergeRequest payload against the audited message, as well as checking closing keywords; final merge audits compare actual messages and parent state
Intercepts: 2
Recurrences: 1
Notes: The configured message was overwritten after auto-merge was disabled and re-enabled with null squash fields. The default aggregate closed the unfinished parent, which was reopened after the final audit. The captured live-payload negative control fails on the old verifier and passes after the fix. Preventing every external writer requires the owner-controlled dispatcher to preserve merge contracts or clean branch history; changing that shared execution path is outside the current instruction to leave other agents untouched. That stronger constraint remains outstanding under #1744; the local verifier alone cannot prevent a later external overwrite.
---
