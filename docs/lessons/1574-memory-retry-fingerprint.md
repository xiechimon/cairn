---
Category: The memory retry fingerprint's validity was decoupled from its candidates: the fingerprint contained the title, or the body was checked before candidate judgment, or the fingerprint lived forever after candidates were deleted — so retitling could bypass it, and the same body still 409'd after deleting candidates
Source: #1574 (2026-10-24)
Level: 2
Safeguard: `memory-dedupe.test.ts` covers still-matching after retitling, no longer matching, savable with the fingerprint cleared after candidate deletion, and re-candidates on a new similar entry; `m4b-memory.test.ts` covers REST deletion; the fingerprint contains only Agent, team, project, and body, records the returned candidate ids, and holds only while some of them are still alive, with all three deletion entries going through `deleteMemoryEntry` for cleanup
Intercepts: 3
Recurrences: 0
Notes: Real negative control: the first version still returned candidates after retitling; with the narrowed fingerprint a new entry is created even with overlapping titles gone; review pointed out the 409-after-candidates-deleted case, the new test went red first and turned green once the fingerprint recorded candidate ids
---

