# Fix round 1 (PR #2031)

Gate verdict: BLOCK on `77ae93f7`. Three findings, each reproduced, fixed and re-checked.

## Finding 1 (blocking): the rule never bites

`scripts/prepush.mjs` was untouched, so nothing ran the policy locally or in CI prepush.

- Reproduce: `node scripts/recording-gate.mjs` did not exist (`Cannot find module`).
- Fix: `scripts/recording-gate.mjs` gates a branch diff against a base into `recording-missing` or `recording-too-large`; `scripts/prepush.mjs` runs it in the plan and lists `scripts/recording-gate.test.mjs` in `selfTests`; `.github/workflows/ci.yml` runs that test in the CI self-test step.
- Red then green: `node --test scripts/prepush.test.mjs`, new test `the recording gate runs in local prepush, in CI prepush and in the CI self-test step`.

## Finding 2: no negative control on real history

- Reproduce: `scripts/recording-gate.test.mjs` did not exist.
- Fix: 8 tests on real temporary git repositories, including the merged motion PR #1972 replayed red and then green once a WebM is added; the 6 MB case red; two ticket directories exit 2.
- Red then green: `node --test scripts/recording-gate.test.mjs` (8 passed).

## Finding 3 (watch): the `motion` trigger matched bare substrings

- Reproduce: `promotion`, `motionDiv` and `setMotionEnabled` all fired the gate, so ordinary copy edits demanded a recording.
- Fix: word-boundary lookarounds on every trigger in the single shared table.
- Red then green: `apps/server/test/merge-gate-readiness.test.ts`, `unrelated identifiers do not fire while a real handler does (#1783)`.

## Same-round corrections

The first attempt projected motion from an absent patch, which turned every truncated-diff PR red. `apps/server/test/merge-gate-readiness.test.ts` `the real compare sample keeps 21 web files green (#1783 negative control)` now pins that the real comparison sample stays green; an absent patch is left to the existing `opaque-file` blocker.

The trigger table moved from `packages/shared/src/recording-trigger.ts` into `packages/shared/src/records/recording-trigger.ts` to keep the gate worker's "imports only `zod`" invariant, and both exported lists are frozen to keep the "gate lists are immutable" invariant.

## Checks

- `pnpm exec vitest run packages/shared apps/server`: 217 files, 3,578 tests passed.
- `node --test scripts/recording-gate.test.mjs scripts/prepush.test.mjs`: 25 passed.
- `pnpm lint`: clean. `pnpm typecheck`: all projects done.
- `node scripts/single-use-helper-gate.mjs`, `node scripts/comment-discipline-gate.mjs`, `node scripts/english-only-gate.mjs`: 0.
