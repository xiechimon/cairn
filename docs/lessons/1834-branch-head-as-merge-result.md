---
Category: A stale PR head was treated as the proposed merge result and upstream additions were falsely reported as removed
Source: PR #1848 repair of #1834 (2026-10-28)
Level: 2
Safeguard: The gate compares main with the real Git merge-tree result and refuses unresolved conflicts; real Git controls cover independent edits and unresolved conflicts
Intercepts: 0
Recurrences: 0
Notes: The independent-edit and conflict controls fail against original source a2a689b2 and pass after the repair. Existing removal controls now create actual resolved merges rather than assuming a conflicting stale tree is the merge result.
---
