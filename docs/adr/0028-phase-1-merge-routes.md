# ADR 0028 · Phase-1 merge routes: protected paths stay with ian until the in-product review lands

> Status: **Decided** (2026-10-29, ian, roadmap D4). Amends ADR 0026 R2, and R4 for ADRs, for phase 1. ADR 0026's body is unchanged, per the convention that ADRs are amended by new ADRs, not edited.

## Problem Statement

Three sources disagreed: ADR 0026 R2 says a protected path needs an independent review, not a person; `.claude/workflows/pr-gate.js` returns `mergedBy: 'user'` for every protected-path PR; `AGENTS.md` routes class ⑤ to a human.

For example, a protected-path PR outside class ⑤ could satisfy R2's independent review requirement while pr-gate still routes it to ian. This ADR records ian's 2026-10-29 decision (roadmap D4) on the current merge state.

## Decision

On this repository the route of a PR follows from the verdict of `.claude/workflows/pr-gate.js`:

- Route A: pr-gate returns go with `mergedBy: 'auto-merge'` (only auto-mergeable paths, within 800 lines and 40 files, no deleted test files, no binaries outside `docs/verify/`). The PR merges itself.
- Route C: pr-gate returns `mergedBy: 'user'`, and the PR touches class ⑤, an ADR or the lockfile, or is over 800 lines or 40 files and cannot be split. ian merges it for all of phase 1.
- Route B: pr-gate returns `mergedBy: 'user'` for any other reason, such as another protected path or a path outside the auto-merge set. ian merges it until the in-product independent review lands (roadmap E1.1b-4) and a later ADR moves it to ADR 0026 R2.

A PR that matches both B and C takes route C. A verdict with go false merges by no route: the author fixes the findings and pr-gate runs again. Agents never merge or arm auto-merge on a route B or C PR.

Reason: the review gate for protected paths runs outside the product today, on the omarchy timer, and its hand-off contract is not written; ADR 0026 R2 stays the target state.

Also true and unchanged: the merge policy default is autonomous (ADR 0026 R1); local-form projects merge themselves (ADR 0023, #2050).

## Consequences

- Measured 2026-10-29: the omarchy review-gate timer reviews every non-draft PR that touches a protected path and, on a passing review, arms auto-merge with `~/.cairn/tools/merge-pr.sh <n> --auto`. Until that timer skips route B and C PRs, such a PR merges without ian once its checks are green. This ADR holds only after the timer changes; meanwhile a route B or C PR that must wait for ian stays a draft.
- No change to `.claude/workflows/pr-gate.js` or `packages/shared/src/records/merge-gate.ts`: pr-gate already routes every protected-path PR to the user, and merge-gate.ts keeps the protected globs. The in-product readiness check (`apps/server/src/services/merge-gate/readiness.ts`) already implements the ADR 0026 R2 target state; where it runs on this repository, it must not merge route B or C PRs in phase 1.
- Route B moves to ADR 0026 R2 only through a later ADR that lands together with the pr-gate change; until then pr-gate keeps returning `mergedBy: 'user'` for it.
- ADR 0026 R4 says ADRs merge through R2 without a click; in phase 1 they take route C.

## Alternatives considered

- **Apply R2 to class ⑤ now.** Rejected because the review gate runs outside the product.
- **Edit ADR 0026 in place.** Rejected by the ADR convention: amend decisions with a new ADR.
