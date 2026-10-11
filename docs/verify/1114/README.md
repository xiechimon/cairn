# Verify 1114 — board-dnd flash-tracer sampling race (test-only fix)

Ticket: https://github.com/xiechimon/pacman/issues/1114

The failing test `apps/web/e2e/board-dnd.spec.ts:844` ("committed drop never
flashes the card back to the source column") armed a 600ms rAF tracer BEFORE
`page.mouse.up()` but asserted on ALL frames including pre-commit ones. Under
load the first rAFs fire between arming and the drop commit; those pre-commit
`todo` frames are the drag state (the source card stays pinned in its home
slot for the whole gesture), not a flash-back — the exact t-0262 flake
(`docs/verify/1012/flake-attribution/run2-contended/probe-run.log`).

Fix is test-only (ticket's verdict: sampling-timing problem, not app
behavior):

1. deterministic race injection — before `page.mouse.up()`, two synthetic
   pre-commit `todo` frames are pushed into the trace;
2. anchored assertion — only frames AFTER the first `done` landing count
   (mirror of `board-dnd-live.spec.ts`'s `firstPending`);
3. bounded `expect.poll` on a `__flashDone` flag replaces the blind 700ms
   sleep.

All runs on mea, `E2E_PORT=8417` (private port), single spec file only —
full suite belongs to CI.

## Files

- `before-red.txt` — command: `E2E_PORT=8417 pnpm exec playwright test
  e2e/board-dnd.spec.ts -g "committed drop never flashes"`. The test with the
  race injection but the OLD assertion (filter all frames). Red with the
  t-0262 signature: `frames with the card back in 待开始: [{"t":1,...},{"t":2,...}]`.
  Proves the injected frames reproduce the flake deterministically.
- `after-green.txt` — same command after applying the anchored assertion +
  bounded wait. Green. Proves pre-commit drag-state frames no longer fail
  the test.
- `repeat-runs.txt` — command: `E2E_PORT=8417 pnpm exec playwright test
  e2e/board-dnd.spec.ts --repeat-each=6` (whole spec file, 25 tests x 6 =
  150). 150 passed (33.1s). Proves ticket acceptance "负载下连跑多轮稳定".
- `counterexample-red.txt` — one probe run with the injection swapped to a
  POST-landing synthetic flash (`{t:700,done},{t:701,todo}`); the anchored
  assertion goes red on `{"t":701,"col":"todo"}`. Proves ticket acceptance
  "拖拽真坏了仍能抓到" — the anchor is weaker only for pre-landing frames,
  a real done→todo flash-back is still caught. The counterexample injection
  is NOT in the committed test; the committed injection is the pre-commit
  race reproducer.
