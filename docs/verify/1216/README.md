# #1216 board-face UI reliability, three defects — verification and evidence index

The permanent regression face for the three defects = `integration/test/board-trio-e2e.test.ts` (real web production build + real server + fake machine wire, zero daemon zero LLM: the chief orchestration round is claimed by the test and then relayed `run_builds` directly, so the dispatch timing is deterministic). This directory holds the paired before/after evidence and the production forensics.

## Rerun recipe

```sh
# after (this branch):
cd integration && pnpm exec vitest run test/board-trio-e2e.test.ts   # 3/3 PASS

# before (a throwaway worktree at baseline 3f571ea6, stack started the same way):
git worktree add --detach /tmp/pacman-1216-base 3f571ea6
cp integration/test/board-trio-e2e.test.ts /tmp/pacman-1216-base/integration/test/
# the baseline shared has no orchestrateThreadTitle export: replace that import with a local
# `const orchestrateThreadTitle = (seqNum) => \`开始任务 #${seqNum}\`;`
cd /tmp/pacman-1216-base && corepack pnpm install --frozen-lockfile
cd integration && pnpm exec vitest run test/board-trio-e2e.test.ts   # 3/3 FAIL (red on the defect assertions)
```

Screenshot pairs (same library state: failed card #26 with one in-flight orchestration round; the two stacks share one copy-DB server 8793, the web runs separately on baseline 5276 / fix 5275):

```sh
node <worktree>/.claude/verify-run/probe-1216-evidence.mjs   # read-only page collection, no mutation clicks
```

## Reading table

| scenario | baseline (before) | fixed (after) |
|---|---|---|
| failed detail, round in flight | `before-detail-blind.png`: the primary button lights up `重跑`, zero visibility of the in-flight round | `after-detail-inflight.png`: the primary button is disabled, `编排中` |
| board failed card, round in flight | `before-board-blind.png`: `重试` lit up | `after-board-inflight.png`: disabled, `编排中` |
| detail id does not exist | `before-blank-shell.png`: blank shell (root is only 1994 bytes, no explanation, no exit) | `after-notfound.png`: not-found panel + back to the board |
| detail query fails (network-layer rejection) | same blank shell | `after-error-state.png`: error panel + retry (self-heals once allowed through) |
| DOM facts | `evidence-1216.json` before-* rows (head/card disabled=false, unavailable=null) | the same file's after-* rows (disabled=true, data-state complete) |

## The integration test's three cases mapped to the defects

1. ① save and start: one click lands exactly one orchestration thread; while the round is in flight the card button is disabled to `编排中` (red before: the card showed the lit-up `开始`, repeated clicks spawned duplicate threads); after the chief dispatches, the phase goes todo→queued→planning and the card enters the in-progress column — the machine-side ground truth of "one click straight into planning".
2. ② failed re-run: a dialog re-run must land a new orchestration thread + the primary button flips to `编排中`; after the chief dispatches, buildHistory has 2 entries and the phase leaves failed (red before: zero visible feedback after the re-run).
3. ③ a failed detail is deletable (more → delete → confirm → server 404 → the card disappears from the board); a missing id yields the not-found panel, a failed query yields the error panel + retry self-heal (red before: a permanently blank shell).

## Regression faces

- `m5-web-e2e.test.ts` (main timing spine: existing button behavior for review/confirm/building) 3/3 PASS.
- `apps/web` full e2e at 916: 915 PASS + 1 flake (provider-oauth networkidle timeout, solo rerun 7/7 PASS, zero overlap with this ticket's change surface).
- Unit tests: web 480 / server 970 / shared 339 all PASS; lint, typecheck, spec:parse all green.

## Production forensics

`prod-forensics.txt`: read-only queries against the 2026-10-11 board pilot library — duplicate orchestration threads on the same card (#30 seven / #32 four / #24 two 13s apart) = the quantified fingerprint of "clicked and nothing happened" repeated clicking; #26's re-run click produced zero threads = the same-root evidence that the entry is unreachable while the detail is white-screened.
