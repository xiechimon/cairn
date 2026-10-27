---
Category: Searched only issues before opening a ticket, not the specs: #1617 duplicated spec 28 P6 `园丁` (gardener patrol), and #1618 did not match the P5a intake entry
Source: #1617/#1618 (2026-10-24)
Level: 3
Safeguard: Before interpreting a ticket or dispatching work, read its body, comments, linked PRs and relevant specs; Memory: before opening a ticket related to the bootstrap loop, grep `docs/spec/28-*.md` and ADR 0021 first; both tickets were commented and re-pointed to the P6 gardener section and the P5a entry
Intercepts: 0
Recurrences: 1
Notes: Recurred during #1656 orchestration: #1847 was called a mismatched number after reading its body without the comments; reading the comments corrected the interpretation. This context check is a dispatch rule because a source search cannot determine whether all relevant context was read. `scripts/dispatch-dedupe.mjs` only checks branches, PRs, and processes, not spec text; keyword spec search has too many false positives to make into a gate for now
---
