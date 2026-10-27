---
Category: Squashing a bot-opened PR attributed the main commit to the bot opener despite valid branch authorship
Source: Issues #2024 and #2028; PRs #1828 and #1906 (2026-10-28)
Level: 2
Safeguard: The unchanged commit-author workflow rejects bot authors; merge preparation reads the PR opener and every author and uses the existing identity-aware merge helper instead of an unconditional squash command
Intercepts: 2
Recurrences: 1
Notes: The main author gate rejected both 51cab1f0 and 4bbfe50e. Branch commit authors alone did not predict GitHub squash authorship. The external helper refuses bot PRs without one Cairnwright-authored commit. The reviewed change is carried into a single-commit PR opened by the verified current user without rewriting existing branches or main history.
---
