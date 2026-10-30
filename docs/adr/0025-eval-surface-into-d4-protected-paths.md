# ADR 0025 · The eval surface enters D4's protected categories: the ruler is never agent-editable

> Status: **Decided** (2026-10-25, per #1510, which records the decision taken with the 2026-10-22 evaluation plan; the plan names this ADR "0022", a number that ADR `0022-prune-merged-evidence-weekly.md` took on 2026-10-25, so the next free number is used here). Ticket #1510. Amends ADR 0021 D4; ADR 0021's body is unchanged, per the convention that ADRs are amended by new ADRs, not edited.

## Problem Statement

spec 29 (evaluation & data loop, `docs/spec/29-evaluation-and-data-loop.md`) makes the repository's own evaluation surface the ruler that decides whether harness changes — prompts, skills, tool descriptions, context assembly, routing — actually help. That surface is: the bench suites under `integration/eval/`, the hillclimb ledger under `.claude/hillclimb/`, and the trajectory exporter that produces the ground-truth packs every judge reads.

ADR 0021 D4 protected the merge gate's own source and agent-steering files, but not the ruler. An agent whose merge is judged by these tools could edit the judge, the bench cases, or the exporter to make itself pass: soften `judge.mts`'s paired-z gate, add favorable cases, or drop fields from the pack schema so failure attribution goes blind. The chief-dispatch harness regression gate (#1578) already binds harness-changing PRs to a measured result, but nothing stops the PR from changing the measurement itself — the harness-regression result is only trustworthy if the harness that computes it cannot be patched in the same PR.

Concrete trace: an autonomous PR touching `integration/eval/chief-dispatch/grade.mts` currently routes to a human only via "outside the auto-merge set", a generic default-deny reason. After this ADR it routes via `protected-path`, the same class as the gate's own source, with the eval ruler named explicitly in the ADR the gate list is checked against.

## Decision

ADR 0021 D4 gains a sixth protected category:

**⑥ The eval ruler — anything that defines, produces, or judges the ground truth:**

| Glob | What it protects |
|---|---|
| `integration/eval/**` | All bench suites (`chief-dispatch`, `memory-regression`), the adoption judge `adoption/judge.mts` with its read-once sealed-set ledger `adoption/sealed-ledger.mts` (#1605), Harbor task packs (#1517), and the page-generation comparison suite (#1532) |
| `.claude/hillclimb/**` | The hillclimb metrics and case ledgers (e.g. `chief-dispatch/cases.json`) that record what was tried and whether it worked |
| `apps/server/src/trajectory-export.ts` | The exporter that assembles trajectory packs from sqlite |
| `apps/server/src/trajectory-export-cli.ts` | Its CLI entry (`pnpm traj:export`) |
| `apps/server/src/trajectory-outcome.ts` | `derivePackOutcome`: the outcome fields (merged, reverted-within-7d, fixed-by-later-PR) written into every pack |
| `packages/shared/src/trajectory-pack.ts` | The pack schema itself — the ruler's markings, consumed by every judge |

Notes on scope:

- `.claude/hillclimb/**` is already inside category ① (`**/.claude/**`); it is listed here explicitly so a future edit to category ① cannot silently unprotect the eval ledger, and the glob is duplicated into the gate lists so the list reads item-for-item against this ADR.
- The adoption-judge source paths named by #1605 (`integration/eval/adoption/judge.mts`, `integration/eval/adoption/sealed-ledger.mts`) are covered by the `integration/eval/**` glob; no separate entries are needed.
- Developer-side observability plumbing is deliberately **out** of the category: `trajectory-push.ts`, `trajectory-curate.ts`, `trajectory-label-cli.ts`, `trajectory-reflect.ts`, `trajectory-attribution.ts`, `trajectory-otlp.ts`, and `trajectory-transcript.ts` move data to Langfuse or help humans label it (spec 29 §3); they do not define or judge ground truth, so they stay in the auto-merge set. If one of them ever becomes part of judging, it enters this category by a new ADR.
- Matching follows D4's existing rules: any directory depth where the glob says so, case-insensitive with Unicode folding, and a trailing `/**` also matches the directory entry itself.

## Consequences

- Both copies of the D4 list — `PROTECTED_PATH_GLOBS` in `packages/shared/src/records/merge-gate.ts` (the merge readiness gate) and `PROTECTED` in `.claude/workflows/pr-gate.js` (the bootstrap pr-gate) — carry the six new globs item-for-item in the same order; an existing unit test pins the two lists against each other.
- New unit tests cover every new path, case variants, and lookalikes that must stay in the auto-merge set (`apps/server/test/merge-gate-paths.test.ts`).
- PRs touching only the eval ruler can no longer auto-merge under `autonomous` policy; they always route to a human, same as gate-source PRs.
- Bench iteration slows down (every question/case edit needs a human merge). That is the intended cost: the ruler changes less often than the code it measures, and each change is one review away.
