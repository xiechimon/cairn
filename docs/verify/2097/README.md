# 2097 — weekly review packs by default

Wires pack export/label into `scripts/ops/eval-weekly.sh`, with an up-front same-day review-directory check and sampler trace hit/miss logging. Pack window math is portable UTC via Node (no GNU `date -d`). Export/label intermediates are removed before write and cleared again if labeling fails so same-day retries are not stuck on `OutputExists`.

## Artifacts

| File | Role |
| --- | --- |
| `sampler-red.log` | Sampler CLI fails before `available`/`traces` fields exist |
| `weekly-ops-red.log` | Ops script tests fail before early-exit / labeler / export wiring |
| `review-fix-red.log` | Portable-date and pack-retry tests fail before the fix |
| `green.log` / `review-fix-green.log` | Sampler + ops script tests pass |
| `bash-n.log` | `bash -n scripts/ops/eval-weekly.sh` |
| `same-day-rerun.log` | Existing `reviews/<day>/` exits 0 before flows |
| `labeler-unset.log` | Missing labeler env exits 1 with a named message |
| `fixture-packs-traces.log` | Fixture review with `packs=35` and `traces hit=2` |
| `portable-date.log` | `--week-window` on real date and a macOS-like `date -d` stub |
| `pack-retry.log` | Export-success / label-failure / retry clears stuck artifacts |
| `eval-weekly.diff` | Script diff showing early review check and pack export/label |
| `gates.log` | lint / typecheck / english-only / comment / helper gates |

## Commands

```sh
node --test scripts/eval-sample-failures.test.mjs scripts/eval-weekly-ops.test.mjs
bash scripts/ops/eval-weekly.sh --week-window 2026-10-28
bash -n scripts/ops/eval-weekly.sh
pnpm lint
pnpm typecheck
```
