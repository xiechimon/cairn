# Baseline owner gate (#2005)

Tests were written and run before the implementation. `red.log` is the missing-module failure of `scripts/baseline-owner-gate.test.mjs`. `green.log` is the same command after `scripts/baseline-owner-gate.mjs` landed (20 passing pure-function cases).

## Rule

A PR that touches `scripts/prepush-known-red.json`, `scripts/*-allowlist.json`, or `scripts/*-baseline.json` passes only when every `Closes #N` line in the PR body names an issue that carries the `main-red` label and is not a main-watch alert titled `main red: …`. Otherwise the new CI job fails with the protected file list.

`scripts/ci-job-structure-baseline.json` is outside that set: it pins job and step placement for `scripts/ci-job-structure-gate.mjs`, not a debt threshold. Every PR that adds a CI job must register the job there; protecting it would make this gate block its own feature PR and every later gate addition. Filename patterns still catch newly introduced `*-baseline.json` / `*-allowlist.json` files without a ledger entry (the failure mode of closed PR #2015's finite METRICS set).

Gardener / main-watch issues titled `main red: <check> on <sha>` also carry `main-red`. Accepting any `main-red` issue would let a lane close its own alert and edit the baselines the gate is meant to protect. Curated ownership therefore requires `main-red` and rejects the main-watch title shape.

## Overlap

Lookup at 2026-10-29T02:28:36Z (`scripts/github-overlap.mjs`, terms baseline-owner-gate / main-red ownership / known-red allowlist baseline; paths gate script, test, `ci.yml`, structure baseline, `prepush.mjs`):

1. Open issue #2005 — same ask; this PR implements it.
2. Closed PR #2015 — prior attempt; blocked by independent review after fixRoundsMax. This branch keeps the filename-pattern scope, adds curated main-red ownership, and documents the structure-pin exemption.
3. No open PR path overlap on the planned files. Open #2095 work (failure-review / eval-sample-failures) is out of path scope.

## Local verification

| Command | Log |
| --- | --- |
| `node --test scripts/baseline-owner-gate.test.mjs` (before impl) | `red.log` |
| `node --test scripts/baseline-owner-gate.test.mjs` (after) | `green.log` |
| pure-function acceptance scenarios | `acceptance-sim.log` |
| `pnpm lint` | `lint.log` |
| `pnpm typecheck` | `typecheck.log` |
| `pnpm spec:parse` | `spec-parse.log` |
| `node scripts/ci-job-structure-gate.mjs` | `ci-structure.log` |
| `node --test scripts/prepush.test.mjs` | `prepush-selftest.log` |
| `node scripts/english-only-gate.mjs` | `english-only.log` |
| `node scripts/baseline-ratchet-gate.mjs` | `ratchet.log` |

Repository administrators still need to add the `baseline-owner-gate` status to branch protection required checks; this worktree change does not edit repository settings.
