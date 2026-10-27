---
Category: Searched only issues before opening a ticket, not the specs: #1617 duplicated spec 28 P6 `园丁` (gardener patrol), and #1618 did not match the P5a intake entry
Source: #1617/#1618 (2026-10-24)
Level: 5
Safeguard: Memory: before opening a ticket related to the bootstrap loop, grep `docs/spec/28-*.md` and ADR 0021 first; both tickets were commented and re-pointed to the P6 gardener section and the P5a entry
Intercepts: 0
Recurrences: 0
Notes: `scripts/dispatch-dedupe.mjs` only checks branches, PRs, and processes, not spec text; keyword spec search has too many false positives to make into a gate for now
---

