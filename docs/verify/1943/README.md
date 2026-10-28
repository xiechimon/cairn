# #1943 prompt-set switching with provenance-safe resume

Eval-only `--prompt-set current|cut` for the chief-dispatch harness, with
row-level provenance that rejects incompatible resume before any model
request or results-file write.

## Artifacts

| File | Role |
|---|---|
| `red.log` | `prompt-set-resume.test.ts` on main before the change: `--prompt-set` unknown, 5 failed / 4 passed |
| `green-integration.log` | Acceptance vitest set after the change: 3 files / 34 passed |
| `green-shared.log` | `harness-eval.test.ts` including the new harness-path entry |
| `typecheck.log` | `pnpm typecheck` green |
| `lint.log` | `pnpm lint` green (info-only flatMap suggestion elsewhere) |
| `production-diff.stat` | Empty: `apps/server/src`, `apps/daemon/src`, `packages/shared/src/protocol` untouched |

## Runner evidence

`integration/test/prompt-set-resume.test.ts` drives `run-eval.mts` as a
subprocess against a local recording relay (`CAIRN_EVAL_RELAY_URL` /
`CAIRN_EVAL_RELAY_KEY=test`). Covered cases:

- legacy rows without provenance exit 2 with byte-identical `results.jsonl`
- mismatched model / `harness_sha` exit 2 before further relay traffic
- current → cut into the same variant exits 2 naming a fresh `--variant`
- mixed-arm rows exit 2
- `--approve-harness` on a new harness does not reuse old rows
- compatible resume with `--reps 3` over two completed reps runs exactly rep 2
- cut system prompts are shorter than current; current equals production bytes via `applyPromptSet`
- learn cases with `--arm no-memory` receive the selected cut set
