# #1831 evidence: prompt-set switch and comparison report

## What landed

- `integration/eval/chief-dispatch/prompt-set.mts` — the cut prompt set (`CUT_CONVENTIONS`, 41% of
  the current `## 工作约定` rules' length) plus `applyPromptSet` / `rewriteClaimResponseBody`.
  Production prompts in `apps/server/src/services/chief.ts` are untouched.
- `integration/eval/chief-dispatch/run-eval.mts --prompt-set current|cut` (default `current`),
  threaded through `bootStack` (chief-dispatch) and `runLearnCase` (learn). The switch rewrites
  `step.chief.systemPrompt` in the machine-claim response inside the eval stack, so both arms share
  the identical dynamic inventory (charter, roster, memories); a missing `## 工作约定` marker
  throws instead of silently running the cut arm with the current prompt. Result rows record
  `meta.prompt_set`.
- `integration/eval/chief-dispatch/compare-prompt-sets.mts` — per-arm pass rate with a 95%
  Wilson interval, receipt rate, in/out/cache-read tokens and cost per task with a 95% CI
  half-width, the cut − current difference, and a per-case table; warns when a row's recorded
  `prompt_set` contradicts its variant directory.
- Both new modules are in `CHIEF_DISPATCH_HARNESS_PATHS` (editing them now requires harness
  re-approval).

## Verified

| claim | artifact |
| --- | --- |
| cut arm keeps the inventory, swaps only the standing rules; 41% length; throws on a restructured prompt | `integration/test/prompt-set-ablation.test.ts` (17 unit cases, red-first) |
| the claimed chief session actually receives the cut rules (and the current rules in the control arm) — real server + daemon + pi session + stub relay | same test file, "real stack" describe; cut arm: kept markers present, `ADR 0026` / `confirm 关口自动确认` / `技能路由提示节` absent; current arm: all present |
| the runner flag works end-to-end: `run-eval.mts --prompt-set cut` → claim rewrite → session content → row `meta.prompt_set` | `docs/verify/1831/stub-arm-driver.mts` + `docs/verify/1831/stub-arm-run.log` (runs case d01 against a stub relay; scratch variant v9 removed afterwards) |
| the comparison report reads real `results.jsonl` and renders intervals and tokens per task | `docs/verify/1831/compare-cli-smoke.md` (CLI smoke: both arms point at the same 2026-09-29 baseline, so all differences are 0) |
| gates | `pnpm lint` green; `pnpm typecheck` green; `prepush-vitest` 342 files / 4600 tests green; single-use-helper, comment-discipline, english-only gates all 0 |

## The live two-arm run is blocked

Relay-186 (`http://112.80.47.186:8783/v1`, the endpoint the bench's `CAIRN_EVAL_RELAY_URL` points
at) is down at the time of this lane: the TCP port accepts connections but HTTP requests get
`UND_ERR_SOCKET` directly and `502 Bad Gateway` through the proxy — a tunnel whose upstream is
dead. Both arms were ready to run (harness sha re-approved in this lane's `_state.json`).

When the relay is back, run (same models, same reps, ~$5 for 64 cases x 1 rep per arm):

```sh
pnpm --filter @cairn/integration exec tsx eval/chief-dispatch/run-eval.mts \
  --flow .claude/hillclimb/chief-dispatch --variant baseline --model glm-5.3 --reps 1 --prompt-set current
pnpm --filter @cairn/integration exec tsx eval/chief-dispatch/run-eval.mts \
  --flow .claude/hillclimb/chief-dispatch --variant v1 --model glm-5.3 --reps 1 --prompt-set cut
pnpm --filter @cairn/integration exec tsx eval/chief-dispatch/compare-prompt-sets.mts \
  .claude/hillclimb/chief-dispatch --current baseline --cut v1
```

Note the existing `baseline/results.jsonl` is the 2026-09-29 run (pre hardening-era harness); a
fresh current arm is preferred over reusing it, so both arms share the harness and the day.

## Open question for the user

- The relay upstream is down (see above), so the live pass-rate/tokens comparison could not be
  executed in this lane. Options: (a) point `CAIRN_EVAL_RELAY_URL` at a reachable endpoint that
  serves `glm-5.3` / `qwen3.8-max` / `kimi-k3`, (b) restore relay-186 and run the commands above,
  or (c) treat the switch + report tooling as this ticket's deliverable and run the arms in a
  follow-up. The wokey provider in the production server does not serve the bench's roster model
  ids, so it is not a drop-in substitute.
