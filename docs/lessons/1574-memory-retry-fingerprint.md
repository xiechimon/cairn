---
Category: The memory-retry fingerprint's validity was decoupled from its candidates: the fingerprint contained the title, or the body was checked before candidate judgment, or the fingerprint lived forever after all candidates were deleted, so renaming bypassed it and re-saving the same body after deleting candidates still returned 409
Source: #1574 (2026-10-24)
Level: 2
Safeguard: `memory-dedupe.test.ts` covers a rename still matching, no longer matching candidates, saving and clearing the fingerprint after candidate deletion, and getting fresh candidates for a new similar entry; `m4b-memory.test.ts` covers REST deletion; the fingerprint holds only Agent, team, project and body plus the returned candidate ids, and holds only while at least one of those entries is alive; all three deletion entry points clean up through `deleteMemoryEntry`
Intercepts: 3
Recurrences: 0
Notes: real negative control: the first version still returned candidates on a rename, and a new entry was created even with no overlapping title after narrowing the fingerprint; re-review found the fingerprint still 409-ing after all candidates were gone, the new test went red first, and recording candidate ids turned it green
---
