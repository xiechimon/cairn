# GitHub autonomy brake

An open issue carrying `autonomy-paused` pauses GitHub autonomy. Closing the issue resumes the GitHub brake. Product team pause settings remain independent: a product pause must also be cleared in the product. The product publishes a marker to every GitHub repository in that team and retains its local pause if publishing fails.

Use Node, Git, and authenticated `gh`, with `GITHUB_REPOSITORY=owner/repository`:

```sh
node scripts/autonomy-brake.mjs status
node scripts/autonomy-brake.mjs pause --reason 'Main CI failed: SHA and run URL'
node scripts/autonomy-brake.mjs sweep
node scripts/autonomy-brake.mjs verify-recovery 123
```

`status` prints JSON. `pause` creates the label if absent and reuses an existing open marker. `sweep` paginates all open PRs, disarms every armed auto-merge, prints each result, and exits nonzero after trying the remaining PRs if any disarm fails. Closing a marker never re-arms previously disarmed PRs.

The GitHub Actions workflow runs independently of omarchy. A failed `ci` workflow on main publishes the failing SHA and run URL, then sweeps. Scheduled and manual runs sweep only while paused. The required `pr-evidence` job checks the brake before its body checks. A brake lookup error fails closed and uses the existing failure disarm step.

A labelled `cairn-recovery` PR targeting main can pass the brake only with one commit naming full reverted SHAs in `This reverts commit <sha>` lines. The verifier finds the latest successful GitHub Actions `check` along main's first-parent history, requires every reverted SHA after it, and reconstructs the revert in a temporary clone at the PR base SHA, newest revert first. Git tree identity includes file bytes, paths, modes, and symlinks. Merge commits are reverted against their first parent. Missing checks, GitHub errors, conflicts, extra files, or changed bytes reject the exception. Body, decision, and other required checks still apply.

The server caches marker reads for 60 seconds in `GateReadCache`, by repository. Failed reads block readiness without caching the failure. After main goes red following a recorded autonomous merge, CI polling publishes a recovery branch `cairn-recovery/<sha8>` and opens a labelled revert PR. It does not merge or arm that PR. The merge executor and batching policy remain B0-2 work (#2186).

## Local verification and evidence limits

```sh
node --test scripts/autonomy-brake.test.mjs scripts/autonomy-brake-workflow.test.mjs
pnpm exec vitest run apps/server/test/github-autonomy-brake.test.ts apps/server/test/github-recovery.test.ts apps/server/test/team-autonomy-pause.test.ts apps/server/test/merge-gate-product.test.ts
pnpm lint
pnpm typecheck
pnpm exec vitest run --changed
pnpm spec:parse
node scripts/pr-evidence-workflow-gate.mjs
```

The CLI uses fake `gh` responses on PATH and real Git scratch repositories. Workflow tests execute the YAML shell bodies with stub commands. Server tests use an in-memory database, the real Hono route and readiness logic, and a stub GitHub HTTP boundary. Recovery branch tests push to a scratch local repository and inspect its commit and file contents. These support local mechanism claims only; they do not establish live GitHub permissions, workflow scheduling, provider behavior, or deployed server behavior. No UI or model provider is exercised. Automated checks do not replace independent review.

| Supported local claim | Command | Surface and provider | Runtime artifact | Result and limit |
| --- | --- | --- | --- | --- |
| Marker status, creation, idempotence; partial sweep failure; exact recovery tree and tamper rejection | `node --test scripts/autonomy-brake.test.mjs` | Scratch Git; fake `gh` | `/tmp/1405-red.log`, `/tmp/1405-latest-red.log`, `/tmp/1405-node-green.log` | Passing locally; GitHub transport and permissions unverified |
| Paused PR red and disarmed; valid recovery passes brake; success and unpaused schedule do not write | `node --test scripts/autonomy-brake-workflow.test.mjs` | YAML shell execution; stub CLI commands | `/tmp/1405-workflow-red.log`, `/tmp/1405-node-green.log` | Passing locally; Actions scheduling and required-check enforcement unverified |
| Product pause publishes marker; marker blocks readiness; cache expires at 60 seconds | Focused Vitest command above | Hono and database in process; stub GitHub HTTP | `/tmp/1405-server-red.log`, `/tmp/1405-readiness-red.log`, `/tmp/1405-server-final.log` | Passing locally; deployed server and live GitHub unverified |
| Recovery window, single revert branch, preserved unrelated bytes, PR creation and label retry without merge | Focused Vitest command above | Scratch Git plus polling fixture; stub GitHub HTTP | `/tmp/1405-recovery-red.log`, `/tmp/1405-retry-red.log`, `/tmp/1405-window-red.log`, `/tmp/1405-server-final.log` | Passing locally; authenticated remote push and live PR creation unverified |

All rows apply to the uncommitted implementation based on `a979b5742`; their local test surface is not a deployed build. Model providers and UI are not exercised in any row. These are automated checks, with no independent review claim.

The unrestricted `pnpm exec vitest run --changed` also selected integration tests. It was interrupted after two `chief-eval-reap` cases failed because the sandbox cannot enumerate processes with `pgrep`; its log is `/tmp/1405-changed.log`. This run is incomplete, not green. The first light-project changed run recorded 2,619 passes, one skip, and two five-second timeouts in `credentials` and `reset-todo` (`/tmp/1405-changed-light.log`). A final light-project changed run with `--maxWorkers=2` is recorded separately in `/tmp/1405-changed-light-final.log`; it passed 169 files and 2,621 tests, with one file/test skipped.

Red-first logs and green runtime logs are local under `/tmp/1405-*.log`. The tested base is `a979b5742`; the sandbox rejects staging because the worktree Git index lives outside its writable roots, so no implementation commit could be created. This solo run deliberately adds no `docs/verify` artifacts, so it makes no delivered verification claim.

## Still required on GitHub and the host

After deployment, verify Actions can create the label and marker and disarm an armed test PR with the workflow token. Exercise a failed main `ci` run while omarchy is offline, observe the marker and sweep, and confirm scheduled execution continues without the host. Test an exact recovery PR and a tampered recovery PR against the live required check. Confirm successful main CI and an unpaused scheduled run perform no writes.

On omarchy, deploy the server code, use the product pause against a test repository, observe the marker issue, and confirm server readiness returns `autonomy-paused` within the cache interval. Exercise main failure after a recorded autonomous merge and confirm the recovery branch, single revert commit, label, and PR appear without a merge or auto-merge request. Test a failed PR-label write followed by a polling retry. Confirm closing the GitHub marker clears the GitHub pause; clear a separately set product team pause in the product. GitHub and omarchy are unavailable to this sandbox, so all of these checks remain unverified.
