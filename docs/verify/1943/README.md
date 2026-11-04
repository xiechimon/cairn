# #1943 prompt-set switching with provenance-safe resume

Eval-only `--prompt-set current|cut` for the chief-dispatch harness, with
row-level provenance that rejects incompatible resume before any model
request or results-file write.

## Artifacts

| File | Role |
|---|---|
| `red.log` | Initial suite on main: `--prompt-set` unknown |
| `red-block-fix.log` | Block-review regressions red before the provenance/identity fix |
| `green-integration.log` | Acceptance vitest set: 3 files / 37 passed |
| `green-block-fix.log` | Full `prompt-set-resume.test.ts` green after the block fix (12 passed) |
| `green-shared.log` | `harness-eval.test.ts` including the harness-path entry |
| `typecheck.log` | `pnpm typecheck` green |
| `lint.log` | `pnpm lint` green |
| `production-diff.stat` | Empty production prompt surfaces |

## Runner evidence

`integration/test/prompt-set-resume.test.ts` drives `run-eval.mts` as a
subprocess against a local recording relay. Covered cases:

- legacy rows without provenance exit 2 with byte-identical `results.jsonl`
- mismatched model / `harness_sha` exit 2 before further relay traffic
- current → cut into the same variant exits 2 naming a fresh `--variant`
- mixed-arm rows exit 2
- `--approve-harness` on a new harness does not reuse old rows
- compatible resume with `--reps 3` over two completed reps runs exactly rep 2
- cut system prompts are shorter than current; identity matches the CAIRN-RUNTIME slice of recorded relay prompts
- learn cases with `--arm no-memory` receive the selected cut set
- changing `--arm`, `--context-window`, or flow cases/roster rejects before relay requests
