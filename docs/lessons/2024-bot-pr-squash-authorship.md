---
Category: Squashing a bot-opened PR attributed the main commit to the bot opener despite valid branch authorship
Source: Issues #2024, #2028 and #2088; PRs #1828, #1906 and #2027 (2026-10-28)
Level: 2
Safeguard: The unchanged commit-author workflow rejects bot authors; merge preparation reads the PR opener and every author and uses the existing identity-aware merge helper instead of an unconditional squash command; scripts/commit-author-policy.test.mjs enforces the same routing in AGENTS.md
Intercepts: 2
Recurrences: 1
Notes: Issue #2088 repeated the bot squash authorship failure on dedf30ea. The new AGENTS.md policy case fails against the unconditional re-arm instruction and passes after identity-aware routing; this does not establish which instruction caused the merge. The main author gate rejected both 51cab1f0 and 4bbfe50e. Branch commit authors alone did not predict GitHub squash authorship. The external helper refuses bot PRs without one Cairnwright-authored commit. The reviewed change is carried into a single-commit PR opened by the verified current user without rewriting existing branches or main history.
---

Issue #2101 adds a recovery fixture to the trusted main push test step. It executes the operational commit recipe with inherited bot identity, asserts local fixture identity without global configuration, preserves trailers and historical commit bytes, and checks the actual workflow shell. This is repository coverage, not evidence that the external merge helper enforced the route or that main recovered. Those claims require the resulting main metadata and a subsequent green Actions run.

Issue #2127 adds a product API safeguard before squash: bot or unknown opener identity in `xiechimon/cairn` returns HTTP 409 without a merge PUT or task mutations. Nine unsafe cases returned HTTP 202 before the fix. External merges remain outside this boundary; the existing commit-author workflow remains unchanged.
