# Rejected split proposal lifecycle

Tested source is the checkpoint containing this archive, based on `b7acac58901bd383789544bec524307b7062cd97`. This author evidence records a bounded repair of ADR 0024 Decision 1. It is not an independent review approval.

## Requirement and correction

The previous author response treated validation ordering as harmless because bad references were not persisted. That conclusion was incomplete: missing agents, cycles and invalid dependency indexes returned errors before preserving the required parent confirm plan and reason. The real chief-tool negative controls reproduce this requirement gap in auto and shadow mode. The HTTP relay E2E was red with a 404 for a missing agent.

Auto and shadow now preserve the original semantic proposal and checker reasons in the existing parent build and plan, leave the parent at confirm, and create no child or dependency references. The stable `split-proposal-rejected:v1` marker distinguishes this state from ordinary confirmation. The plan directs the chief to resubmit corrected agent IDs and dependency indexes with `split_todo`.

HTTP and chief confirmation, ordinary build starts, and generic step actions reject this marked build with 409. Correction requires the current linked chief plan, confirm phase, no child cards and no execution steps across the parent's build history. A corrected resubmission creates a new build and plan while retaining the rejected records unchanged. Ordinary confirm cards remain ineligible for resplitting. Human policy preserves the original validation errors.

Finite fractional dependency numbers reach the semantic checker in auto and shadow. Nonnumeric or nonarray dependencies, blank fields and fewer than two children retain hard 400 behavior without a rejected draft. No malformed dependency is silently dropped or persisted as an executable reference.

## Negative controls and results

- `rejected-proposal-red.log`: the original production chief-tool cases fail before the lifecycle repair.
- `fractional-red.log`: auto and shadow fractional indexes fail before the parser boundary repair; the human control preserves integer-array rejection.
- `format-boundary-red.log`: hard-format controls caught an overbroad intermediate catch. Basic validation now remains outside semantic fallback.
- `focused-green.log`: all 41 new lifecycle, confirmation, history, format and human controls pass.
- `serial-targeted-green.log`: the exact relevant 27-file server/shared suite passes all 345 tests with `--maxWorkers=1`, under `TMPDIR=/private/tmp CAIRN_HEAVY_SLOTS=1 node scripts/heavy-slots.mjs run -- pnpm exec vitest run <files> --maxWorkers=1`. The wrapper acquired slot 1/1 and exited successfully.
- `parallel-timeouts.log`: the earlier same-code parallel run records 343 passes and two existing tests exceeding their 5000 ms timeout. The serial repeat preserves assertions and timeouts. Resource contention is an inference, not an established root cause; the failed run is retained.
- `e2e-red.log` and `e2e-green.log`: the isolated live-server browser suite passes all three cases after the repair, including rejected proposal, HTTP refusal, chief correction and old-plan retention. The port was checked free before using `E2E_PORT=8498`; the scratch stack disposed normally.
- `lint.log`, `typecheck.log`, `spec.log`: required repository checks pass. Lint retains the existing informational flat-map diagnostic in `feishu-config.test.ts`.

## Scope and limits

The E2E uses a real isolated server/database, HTTP machine enrollment/tool relay, claim operations and browser transcript. Machine outputs are test-driven; it does not establish real-provider inference or daemon execution. Server tests exercise actual chief tools, HTTP confirmation and database rows.

No new table, UI, ADR, default policy or live-project setting is introduced. The team pause remains a split-approval stop; this repair does not add global wave or merge pause behavior. No normal business-rule precondition was found that establishes the separate speculative zero-dispatch finding. Environmental storage exhaustion and inherited dispatch recovery are outside this bounded change, and no broader reliability claim is made.

No full prepush was run manually for this checkpoint. Normal commit hooks, a fresh independent review of the immutable head and digest, the normal push hook, remote checks and merge-time migration numbering remain separate delivery steps. This lane does not push or merge.
