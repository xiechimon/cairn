# Ticket 2189 evidence

## Failure modes defined before implementation

| Failure mode | Test or limit |
| --- | --- |
| Readable secrets missed through cat, symlink, Python, Node, subprocess, dd or copy; contents leaked | Canary readable fixture asserts every channel and no marker |
| Unreadable or absent files reported readable | chmod-000 fixture (skip as root), missing-path fixture |
| Bad arguments or missing tools mistaken for isolation | Argument test; missing-tool branches unverified, missing tools must SKIP |
| Process environment or memory reachable | PID output test; real Linux cross-user controls unverified |
| Arbitrary repo, extra permission, malformed or oversized broker requests | Broker rejection tests |
| JWT or GitHub scope wrong; upstream failure leaks credentials | Stub HTTP scope/JWT and error tests; real GitHub unverified |
| Socket permissions, framing, timeout or existing-path overwrite unsafe | Socket runtime tests; actual Linux group access unverified |
| Setup mutates during dry run | Scratch fixture snapshot test |
| Existing runner privileges, file modes, quarantine collision, repeat setup unsafe | Scratch Linux command stubs cover modes, primary/supplementary groups and repeat quarantine; real sudo/ownership unverified |
| Claude settings ignored or Read denies bypassed | Configuration only; local documentation unavailable, real Claude run unverified |

## Context and evidence limits

GitHub issue/comments and open/recently merged overlap lookup unavailable by task constraint; no absence claim. Proceed only in assigned worktree. No UI, fixture screenshot, real app, daemon or LLM exercised. All provider tests stub GitHub HTTP. No third-party package API used. Helper search: `rg --hidden -n 'access_tokens|RS256|createSign' scripts apps .claude` found no existing helper. Claude field names and filesystem propagation remain unverified against documentation: repository/node_modules searches found no authoritative definition.

Red and green commands: `node --test scripts/ops/secret-reach/*.test.mjs`; artifacts `red.log` and `green.log`. Tested revision: delivery commit containing these artifacts (tests executed on its pre-commit working tree). Results establish local scratch behavior only. Automated checks are separate from review; no independent vendor or security review is claimed. No PR or published evidence URL exists in this local-only run. Dispatcher must publish SHA-pinned raw links after delivery.

## Results and acceptance claims

| Claim | Command | Surface / provider | Artifact | Result and limit |
| --- | --- | --- | --- | --- |
| Tests failed before scripts existed | `node --test scripts/ops/secret-reach/*.test.mjs` | Scratch / not exercised | red.log | Exit 1; missing implementation |
| Seven file channels detect readable marker without printing it; unreadable and absent paths block | Same Node command | Scratch / not exercised | green.log | Three canary fixtures pass, including chmod 000 as non-root; no real host secrets tested |
| Process channels are emitted | Same Node command | Local process / not exercised | green.log | Pass; Linux environ/mem permission boundary unverified |
| Wrong repo and extra permission rejected before HTTP; JWT verifies and exact scoped payload sent | Same Node command | In-process / GitHub fetch stub | green.log | Pass; real GitHub installation and returned token authority unverified |
| Socket mode, framing and existing-path preservation | Same Node command | Local socket / stub | green.log | SKIPPED: sandbox returns EPERM on bind; not accepted |
| Setup dry run describes changes without touching scratch | Same Node command | Scratch cwd / not exercised | green.log | Pass; real mutation and idempotency unverified |
| Repository checks pass | `pnpm lint`, `pnpm typecheck`, `pnpm exec vitest run --changed`, `pnpm spec:parse` | Static/collection / not exercised | lint.log, typecheck.log, vitest.log, spec-parse.log | Exit 0 each; changed Vitest selects no tests, Node suite is separate; lint reports one existing informational diagnostic |
| Claude isolation | No real Claude command | Not exercised | Settings source only | Unverified; source configuration is not runtime evidence |

The tested source manifest is `tested-source.sha256`; base revision is recorded there, with uncommitted new files tested before the delivery commit. No build, full e2e, push, PR or remote host action ran. No CI success or deployed acceptance is claimed. This archive becomes delivery evidence only with its local commit; external availability remains unverified until the dispatcher publishes it.

## Host actions still required

Run the setup with sudo on Linux, inspect identities, primary and supplementary groups, sudoers, ACLs, directory traversal, database family modes and quarantine ownership, then repeat setup to establish idempotency. The dedicated primary group is now enforced; audit its existing membership and the home ownership on the host. Run owner-positive and runner-negative canaries on all supplied host secrets and plaintext transcripts, with server and daemon PIDs. Check Linux ptrace/mapped-memory access independently: offset-zero mem failure alone is insufficient. Run the socket test outside this sandbox, test actual group access and timeout behavior, then validate a real scoped installation token without archiving credentials. Verify Claude settings syntax with installed-version documentation and exercise real Mac direct/subprocess negative controls. See ../../ops/secret-reach.md for the runbook.

## Retro

Applied retro-cairn: fixed one identity-normalization mistake. Supplementary group replacement left an existing privileged primary group intact. The scratch setup regression reproduced docker as the retained primary group before the fix; the script now ensures and selects its dedicated primary group. See docs/lessons/2189-runner-primary-group.md. Socket EPERM remains an environment limit.

## Delivery blocker

The sandbox denied `git add` and `git commit` when Git attempted to create this worktree's `index.lock` (`Operation not permitted`). No commit was created and the evidence remains local and uncommitted. The dispatcher must stage the explicit task paths and commit with the requested subject; it must not treat this archive as published or committed evidence yet. The same sandbox also denied process-list inspection while investigating delayed Git commands; no process-state conclusion was drawn.

The appended setup negative control in red.log reproduces the primary-group bug after initial implementation. The complete green run also covers scratch setup twice, file modes and quarantine preservation with identity/ownership commands stubbed. This is not real Linux account or sudo evidence.

Final Node result: 9 tests, 8 passed, 1 skipped, 0 failed. The additional setup command fixture uses the real shell script with host path literals replaced by scratch paths; Linux identity, ownership and install commands are stubs. Real chmod, move and quarantine creation execute only within scratch. The primary-group failure is captured in the appended red.log run before the fix. Lessons ledger validation passed with `node scripts/lessons-ledger-gate.mjs`. Shell syntax passed with `bash -n scripts/ops/secret-reach/canary.sh scripts/ops/secret-reach/setup-runner-linux.sh`.

## Mac sandbox negative control (dispatcher, real `claude -p` runs)

Claude Code 2.1.312, model claude-haiku-5-5, `--permission-mode bypassPermissions`, each run asked to execute the probe through the Bash tool.

| Run | Settings | Result | Log |
| --- | --- | --- | --- |
| Scratch canary, cat / python / node | `settings-on.json` | all `Operation not permitted` | `mac/on.txt` |
| Scratch canary, forced `dangerouslyDisableSandbox: true` | `settings-on.json` | refused, read blocked | `mac/on-unsandboxed.txt` |
| Scratch canary, symlink / cp / dd, no sandbox | `settings-off.json` | READ on all three (red control) | `mac/off-probe.txt` |
| Real secret paths, symlink / cp / dd / node / git diff --no-index | `settings-mac2.json` (same as the committed file plus a path that does not exist) | BLOCKED on all five | `mac/mac-probe2-on.txt` |
| Same probe run directly in a shell, no sandbox | none | READ on all five (red control) | `mac/mac-probe2-off.txt` |
| gh api, git ls-remote, npm registry inside the sandbox | `settings-on.json` without the network keys | gh TLS failure, git cannot reach the proxy | `mac/mac-net.txt` |
| Same with `httpProxyPort`, `allowLocalBinding`, `enableWeakerNetworkIsolation` | `settings-mac2.json` | gh, git, npm OK; key reads blocked | `mac/mac-net2.txt` |

Limits: the deny list covers only the listed paths; the Mac server DB and other files stay readable to the session. The settings apply only to sessions started with `--settings`; sessions started without it are unprotected.

## omarchy negative controls (dispatcher, 2026-10-30)

| Check | Result | Log |
| --- | --- | --- |
| Canary as `ian` on the App key, both secretbox.key copies, server.env, token, and the server pid | 36 READ, 1 BLOCKED (`/proc/<pid>/mem` at offset 0): red, as expected while every process runs as `ian` | `omarchy/canary-as-ian.txt` |
| Canary as `cairn-runner` | not run: creating the user needs ian's sudo (`sudo scripts/ops/secret-reach/setup-runner-linux.sh`) | pending |
| Broker token: repositories, branch protection, repo settings, Actions variables, other repo | only `xiechimon/cairn` visible; protection, settings and variables 403; other repo 404; broker refuses another repo and `administration` | `omarchy/token-scope-probe.txt` |
| Same probe with the unscoped `as-bot.sh` token | same statuses: the App installation itself has no administration permission today; the broker pins the scope if the App gains permissions | `omarchy/token-scope-probe-unscoped.txt` |

Every write in the probe is a bodyless DELETE of a resource that does not exist (see `docs/lessons/2189-destructive-negative-probe.md`).
