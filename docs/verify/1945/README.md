# Fresh chief-dispatch prompt ablation: blocked

## Observed status

Preflight on 2026-10-27 at revision `b80e55d85a4b320e05bfbf12084aa3fb8540d2ea`
failed before any edit or model request. See `preflight.json` for the credential-free
observations. Issues #1943 and #1944 were both OPEN when read with `gh issue view`.
The runner has no `--prompt-set` option, and neither `prompt-set.mts` nor
`compare-prompt-sets.mts` exists in this checkout. Their merged implementations are
required before an executable two-arm command or validated comparison can be published.

The current process also has no `CAIRN_EVAL_RELAY_URL` or
`CAIRN_EVAL_RELAY_KEY`. The missing URL alone prevents the harness from selecting a
relay: `relayBaseUrl()` requires that environment variable. Key absence in the
environment does not prove absence of the documented settings-file fallback.
No settings file was read, no endpoint was contacted, and relay network availability
is unmeasured. This is a configuration blocker, not a measured relay outage.

## Reproduce the prerequisite check

Run from the repository root; this prints only booleans and exits nonzero while
prerequisites are missing. It starts no server and sends no request.

```sh
node --input-type=module <<'JS'
import { existsSync, readFileSync } from 'node:fs';
const runner = readFileSync('integration/eval/chief-dispatch/run-eval.mts', 'utf8');
const checks = {
  prompt_set_switch: runner.includes('--prompt-set'),
  prompt_set_module: existsSync('integration/eval/chief-dispatch/prompt-set.mts'),
  comparison_cli: existsSync('integration/eval/chief-dispatch/compare-prompt-sets.mts'),
  relay_url_configured: Boolean(process.env.CAIRN_EVAL_RELAY_URL),
  relay_key_in_environment: Boolean(process.env.CAIRN_EVAL_RELAY_KEY),
  v19450_absent: !existsSync('.claude/hillclimb/chief-dispatch/v19450'),
  v19451_absent: !existsSync('.claude/hillclimb/chief-dispatch/v19451'),
};
console.log(JSON.stringify(checks, null, 2));
process.exit(Object.values(checks).every(Boolean) ? 0 : 1);
JS

gh issue view 1943 -R xiechimon/cairn
gh issue view 1944 -R xiechimon/cairn
gh issue view 1831 -R xiechimon/cairn --comments
```

The key boolean is a diagnostic, not a complete credential resolver. Both proposed
variant paths were absent at preflight. They were not created or run. Verify emptiness
again immediately before their first runs; this observation does not reserve the names.

## Experiment boundary and required continuation

Only the chief conventions section may differ between current and cut. This experiment
does not measure arbitrary AGENTS.md slimming or other agent workloads. Production
prompts remain unchanged.

After #1943 and #1944 merge, inspect their actual CLI contracts and approved harness
inputs. Publish and execute commands through
`pnpm --filter @cairn/integration exec tsx eval/chief-dispatch/run-eval.mts`
using two freshly verified empty `v<N>` directories, the same model, full case set,
repetition count, and effective harness settings. Never use the historical `baseline`
as the control arm. Do not approve an unreviewed harness or reuse rows missing provenance.
The comparison CLI must also be exercised through the integration package invocation.
Exact arm and comparison commands are withheld until those interfaces exist and can be
verified; no command in this evidence is represented as a working live experiment.

Preserve sanitized command logs, approved harness identity, prompt-set identity,
effective configuration, result/error JSONL inputs, case definitions and generated report.
Exclude credentials, private endpoints and raw transcripts containing private data.
Count truncated turns as failures and retain their usage. Disclose infrastructure errors,
missing measurements and per-case coverage. Report decision/receipt pass rates with 95%
intervals, input/output/cache-read tokens, cost per task and decimal monetary differences.
Explain interval methodology and missing or singleton samples. Reject incompatible
provenance before reporting a valid comparison.

## Acceptance status

- [ ] Both documented variant directories are empty immediately before their first runs, and commands work through the integration package invocation.
- [ ] Both live arms produce validated provenance with matching model, cases, repetitions and harness settings.
- [ ] Pass rates, intervals, token usage, cost, decimal differences and per-case coverage are published.
- [ ] Commands, provenance, result inputs and generated comparison are committed and reproducible.
- [ ] An observed trade-off and its uncertainty are stated within chief dispatch only.

No live results, stub results, pass rates, token totals or cost estimates are supplied.
All comparative measurements are unavailable; there is no observed trade-off to infer.
Live-run acceptance remains incomplete. The preflight failure is evidence of the blocker,
not evidence that either arm passed.

## Overlap review

Open PR #1864 also changes `.claude/hillclimb/chief-dispatch/metrics.md` and the
runner/reporting surfaces. This change only appends a status section to the metrics
file; it does not port that PR or remove its lines. The supplied recently merged PR
file lists were checked before editing; no lines from those changes are removed.
The pre-existing `pnpm-lock.yaml` modification is outside this task.

## Local validation

- The pre-edit prerequisite check exited 1 with the booleans in `preflight.json`.
- `node scripts/english-only-gate.mjs`: 0 lines with Chinese text.
- Explicit English-only checks of this README and `COMMIT_MSG.txt`: 0 lines.
- `node scripts/single-use-helper-gate.mjs`: 0 single-use helpers.
- `node scripts/comment-discipline-gate.mjs`: 0 new comment lines.
- `flock /tmp/cairn-heavy.lock node scripts/prepush-vitest.mjs`: exited 0;
  Vitest selected no tests for this documentation-only change.
- `git diff --check`: passed.

No production code, harness code or test code was changed. No server was started.
The failed preflight is intentionally still red; the dependencies were not implemented
inside this experiment-artifact ticket.
