---
Category: A repository audit offered a "move `docs/verify` to an evidence branch" option, priced as a gate and ADR change, and ian picked it; a later grep showed the product merge gate (`EVIDENCE_PREFIX`), the verify-step prompt and the feature-map generator all read `docs/verify`, so the option was a product change
Source: repo structure audit (2026-10-25)
Level: 3
Safeguard: AGENTS.md "Code Quality": before offering or estimating a move or rename of a path, grep every consumer of that path (code, prompts, CI, skills) and price the option from that list
Intercepts: 0
Recurrences: 0
Notes: A machine check cannot judge whether an estimate read the consumers
---
