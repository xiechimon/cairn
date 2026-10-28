# Protected harness evaluation worker

The worker is explicitly invoked. It does not change merge readiness, classifications, automatic dispatch, or the automatic merge path set. Both new scripts are covered by the existing protected tooling glob.

## Invocation

Run from the trusted tooling checkout on omarchy, with its dependencies already installed:

```sh
flock /tmp/cairn-heavy.lock node scripts/harness-eval-worker.mjs \
  --repo xiechimon/cairn --pr PR --ticket TICKET \
  --expected-head HEAD_SHA --patch-digest pd2:DIGEST
```

The operator must supply `CAIRN_EVAL_RELAY_URL` and `CAIRN_EVAL_RELAY_KEY`. Credential fallback is disabled. Do not put credentials in command arguments. Capture stdout and stderr to an operator-owned log. Before spending, the worker checks the explicit relay's model catalog for `glm-5.3` without following redirects. Its credential-free route record names the pi backend, `relay-186`, `openai-completions`, the model, and the owner's budget waiver. Catalog reachability verifies the configured route, not the relay's financial account ownership.

The owner explicitly removed the daily cap for pi-run evaluations in [the issue decision](https://github.com/xiechimon/cairn/issues/1975#issuecomment-6444373212). No company-quota claim is made. The relay check cannot establish company billing ownership, and does not attempt to infer it from an API key.

The CLI requires the #1973 hardened writer acceptance test to be present in the trusted installation. It rejects forks and closed PRs, recomputes the gate's canonical patch digest from the GitHub comparison, and checks the expected PR head before checkout. The isolated clone disables Git hooks. A separate temporary flow keeps evaluation logs, state, and traces out of the publication checkout. Each run uses a fresh baseline with three repetitions and no case filter. Harness approval updates only that temporary flow's state. Registry dependencies, including the root pnpm store, are copied into a separate temporary directory with relative links preserved; workspace package links resolve to sources in the evaluated checkout; checkout links point to those disposable copies, never to the trusted installation. The checkout links are verified and removed before publication validation.

After a successful evaluator exit, the worker validates the shared result schema and requested digest. It rejects additional commits, dirty tracked paths, ignored and untracked files, other tickets' evidence, renames, deletions, and symbolic result paths. It stages only the requested result, then verifies the complete staged and committed diff. The remote head is checked again immediately before a plain fast-forward push. Push failure is an error; no force option or forced refspec exists. Temporary clones and flow directories are removed on ordinary success and failure.

## Review round 1

`round1-red.log` records the four failing tests written before the fixes below; they were unfixable-on-paper against the previous code, so each reproduces a blocking review finding.

- Workspace links survive dependency copies. A full `node_modules` copy replaced `@cairn/shared` with a real directory inside the disposable copy, so the evaluated code stopped resolving workspace packages through the checkout. `linkDependencies` now copies only the manifests pnpm reports for dependencies, and `linkWorkspaceDependencies` rewrites every workspace link to the evaluated source; `restoreWorkspaceLinks` puts the checkout back after the integrity check. Test: `workspace package links keep their evaluated source after dependency copies`.
- Restored links are verified, not assumed. Test: `workspace links removed by a full dependency copy are restored before evaluation`.
- Evaluation no longer inherits the operator environment. The child previously ran with `{ ...process.env }`, so a stored credential helper or `gh` login was reachable from the evaluated code. `isolatedEvalEnv` publishes a fixed allowlist and points `HOME`, `XDG_CONFIG_HOME`, `GH_CONFIG_DIR`, and `GIT_CONFIG_GLOBAL` at empty scratch paths. Test: `isolated evaluation cannot read stored credentials or reach publication remotes`.
- A preloaded module cannot reach the credential store through `NODE_OPTIONS`. Test: `a preloaded module cannot be used to reach the publication credential store`.

## Review round 2

The latest review gate on PR #2067 reported two blocking findings, addressed in order:

1. `scripts/harness-eval-worker.mjs:114`: workspace links resolved to trusted package copies. The strengthened fixture changes the evaluated package source and checks the imported value. Links now target the requested checkout. The actual evaluator startup test also modifies the checkout's shared entry point and observes that exact marker through the real evaluator's import graph, then restores the entry point and successfully runs `--help` inside the sandbox. Copying the root pnpm store fixes the loader's relative dependency resolution. No model call or server is started by this startup check.
2. `scripts/harness-eval-worker.mjs:429`: environment filtering did not prevent absolute filesystem reads. Evaluation now runs in a required Bubblewrap mount and PID namespace with dropped capabilities, a fresh session, private `/tmp`, and only runtime system directories, the Node binary, the disposable checkout and scratch directory mounted. The checkout's `.git` is read-only, preventing evaluation from planting publication-time Git configuration. Publication remains outside that namespace. Missing or unavailable Bubblewrap fails closed. The regression probe attempts an absolute credential read, a parent process environment read, and Git configuration modification, then proves that permitted result writes still work. The old environment-only test is now named and asserted as environment filtering, rather than filesystem isolation.

Failure modes covered: stale workspace sources, missing root pnpm dependencies, absolute credential reads, parent process access, publication-time Git configuration injection, inherited preload hooks, and dependency/result tampering. Existing publication, branch movement, schema, digest and push rejection tests remain in the suite.

Round 2 evidence: `round2-f1-red.log`, `round2-f1-green.log`, `round2-f2-red.log`, `round2-f2-green.log`, `round2-startup-red.log`, `round2-git-boundary-red.log`, and `round2-green.log`. Tests use synthetic credentials only. The filesystem probe went red on the previous direct Node execution and green with the required namespace boundary.

The open-PR and last-30-merged-PR file checks found only this lane's PR #2067 touching the worker files. No recently merged PR's additions are removed.

## Evidence and outstanding acceptance

- `tests-red.log`: tests written before the implementation; module missing.
- `existing-result-red.log`: an existing result update caught whitespace loss in porcelain status parsing.
- `route-red.log`: route verification tests written before its implementation.
- `tests-green.log`: 27 passing Node tests using real temporary bare repositories, clones, and workspace fixtures for publication, rejection, movement, push failure, workspace link integrity, and evaluation isolation. Route tests use injected HTTP responses and never contact a billed service.
- `typecheck.log`: workspace typecheck passed under the shared heavy lock.
- `lint.log`, `spec-parse.log`, `prepush-vitest.log`, and `protected-gate.log`: repository checks completed successfully. The Vitest changed-file selector found no tests because these additions are untracked under the task sandbox instructions; the explicit Node suite above exercises the new worker.
- `preflight.log`: production prerequisite rejection before evaluation. This preflight used syntactically valid placeholder digests to exercise the prerequisite check, not a real evaluation request.

`gates.log` records the language, single-use-helper, and comment-discipline gates reporting zero on the staged diff.

No real full evaluation or GitHub result commit is claimed. Issue #1973 is still open and its hardened writer test is absent from this worktree; the production CLI stops before network access or model spending. The task also prohibits pushing. A real manual run and its resulting GitHub commit URL remain outstanding after the prerequisite lands and publication is authorized. No evaluation server was started during this task.

Round 2 validation: 29 Node worker tests pass (`round2-green.log`); workspace typecheck and spec parse pass (`round2-typecheck.log`, `round2-spec-parse.log`). The heavy-lock prepush Vitest command exits 0 but selects no test files (`round2-prepush-vitest.log`); it is not the worker coverage claim. Lint and the lessons ledger pass. The language, single-use-helper and comment gates each report zero. GitHub reports PR #2067 as `MERGEABLE`, so no conflict rebase is needed. No servers were started.
