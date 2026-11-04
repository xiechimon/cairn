---
Category: A gate's blocked attempts and recurrences were counted by hand, so the ledger could not tell a safeguard that never fires from one that fires every week
Source: #1534 (2026-10-28)
Level: 2
Safeguard: `docs/lessons/events.jsonl` holds the intercept and recurrence events, `scripts/lessons-ledger-gate.mjs` reduces them into `Intercepts` / `Recurrences` and rejects a hand-written counter; since 2026-10-28
Intercepts: 0
Recurrences: 0
Notes: Review round 2 reproduced missing opt-in logging, lifetime deduplication and missing merged-counter recurrence detection; regression tests in `scripts/prepush.test.mjs`, `scripts/lessons-ledger-gate.test.mjs` and `scripts/lessons-weekly.test.mjs` cover the external-log collection lifecycle, UTC weekly identities and replay-safe escalation. `docs/lessons/README.md` documents the event identity and the projection; the counters of the 172 entries written before 2026-10-28 stay a frozen baseline and the projection counts events after each entry's `; since YYYY-MM-DD` date only, so older hand-kept numbers never need rewriting
---
