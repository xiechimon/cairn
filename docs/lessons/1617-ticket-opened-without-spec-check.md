---
Category: Before opening a ticket only issues were searched, the spec was never checked: #1617 duplicated spec 28 P6 "gardener" with the existing gardener patrol, and #1618 did not match the P5a intake entry
Source: #1617/#1618 (2026-10-24)
Level: 5
Safeguard: memory: before opening a ticket for bootstrap-loop work, grep `docs/spec/28-*.md` and ADR 0021 first; both tickets were commented and re-pointed at the P6 gardener section and the P5a intake entry
Intercepts: 0
Recurrences: 0
Notes: `scripts/dispatch-dedupe.mjs` checks branches, PRs and processes but does not read spec text; keyword spec search has too many false positives to make into a gate
---
