# ADR 0028 · Phase-1 merge routes: protected paths stay with ian until the in-product review lands

> Status: **Decided** (2026-10-29, ian, roadmap D4). Amends ADR 0026 R2 for phase 1. ADR 0026's body is unchanged, per the convention that ADRs are amended by new ADRs, not edited.

## Problem Statement

Three sources disagreed: ADR 0026 R2 says a protected path needs an independent review, not a person; `.claude/workflows/pr-gate.js` returns `mergedBy: 'user'` for every protected-path PR; `AGENTS.md` routes class ⑤ to a human.

For example, a protected-path PR outside class ⑤ could satisfy R2's independent review requirement while pr-gate still routes it to ian. This ADR records ian's 2026-10-29 decision (roadmap D4) on the current merge state.

## Decision

The three merge routes on this repository today, as `.claude/workflows/pr-gate.js` already behaves:

- Route A: a PR that touches only auto-mergeable paths and stays within 800 lines and 40 files merges itself once pr-gate says go (`gh pr merge --auto --match-head-commit`).
- Route B: a PR that touches a protected path outside class ⑤ is merged by ian until the in-product independent review lands (roadmap E1.1b-4); after that, ADR 0026 R2 applies and it merges without a person.
- Route C: a PR that touches class ⑤, an ADR, the lockfile, or cannot be split small is merged by ian for all of phase 1.

Reason: the review gate for protected paths runs outside the product today, on the omarchy timer, and its hand-off contract is not written; ADR 0026 R2 stays the target state.

Also true and unchanged: the merge policy default is autonomous (ADR 0026 R1); local-form projects merge themselves (ADR 0023, #2050).

## Consequences

- No change to `.claude/workflows/pr-gate.js` or `packages/shared/src/records/merge-gate.ts`, which already match; `node scripts/pr-gate-selfcheck.mjs` stays green.
- Route B moves to ADR 0026 R2 once E1.1b-4 lands, by a later ADR or by this ADR's condition.
- Agents must not enable auto-merge on route B or C PRs.

## Alternatives considered

- **Apply R2 to class ⑤ now.** Rejected because the review gate runs outside the product.
- **Edit ADR 0026 in place.** Rejected by the ADR convention: amend decisions with a new ADR.
