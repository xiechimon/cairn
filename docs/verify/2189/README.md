# Ticket 2189 evidence

Review round 1 fixes are uncommitted, as requested. Historical dispatcher evidence is already on the branch. No push, PR, build, full e2e, remote action, live UI, daemon or LLM run occurred in this round. GitHub overlap lookup is unavailable by task constraint; no absence claim is made. No third-party package API was added.

## Review round 1 failure modes (before implementation)

| Failure mode | Regression or explicit limit |
| --- | --- |
| Forged loopback identity bypasses authentication | HTTP canary fixture: anonymous and every supplied login, 2xx fails; firewall command fixture for nft/iptables; real host enforcement pending |
| Missing required file passes as blocked | Missing fixture must emit MISSING and fail; owner preflight required before user switch because EACCES and ENOENT cannot always be distinguished by runner |
| Impossible offset-zero memory read counted as blocked | Mapped-memory helper fixture selects readable nonzero mapping; unavailable maps reports SKIPPED |
| Mac secret directory additions remain readable | Settings regression asserts whole-directory denies and unchanged network keys; real revised Claude run pending |
| Token probe bypasses broker or authorized writes appear safe | Socket client fixture; HTTP request fixtures assert current-SHA no-op PATCH and absent PR merge with 2xx rejected |
| Missing/relative socket or empty/nonnumeric GID opens unsafe listener | Startup validation regression before listen; signal cleanup socket runtime test (sandbox bind may skip) |
| Setup partially mutates before discovering unsafe path or retains DB group | Scratch setup preflight regression and explicit primary group chown assertions |
| Firewall absent, duplicates, or not persisted/removable | Both firewall backend command fixtures, repeat install and remove; real kernel, boot persistence and owner traffic pending |
| Secret reach tests omitted from CI/local plan | CI and prepush plan regression; exact new CI run line executed locally |
| Evidence overstates revised settings or historical probes | Documentation correction; historic runtime evidence scoped to original file |
| Unrelated ledger baselines changed | Compare non-ticket keys with origin/main |

All new results below apply to HEAD 05dbbf982328f077565f8f5c540eefc880b5c214 plus the uncommitted review-round diff, not a delivery commit. GitHub/omarchy overlap checks are unavailable by explicit task constraint.

## Review round 1 acceptance record

All commands test base commit `05dbbf982328f077565f8f5c540eefc880b5c214` plus the uncommitted diff identified by `review-tested-source.sha256`. These local artifacts are not published delivery evidence. The dispatcher must commit them and use commit-SHA-pinned raw links in any later PR. Automated results below are separate from independent review; no new independent or security review is claimed. No screenshot or fixture result establishes live application or real provider behavior.

| Supported claim | Command | Surface / provider mode | Artifact | Result and limit |
| --- | --- | --- | --- | --- |
| Review regressions fail on the old implementation | `node --test scripts/ops/secret-reach/*.test.mjs` and focused Node reruns | Scratch fixtures / stubs | red.log | Nonzero runs; original evidence retained and new failures appended |
| Required missing paths fail; readable markers are detected without contents; HTTP anonymous/forged identities detect 2xx | `node --test scripts/ops/secret-reach/*.test.mjs` | Shell on scratch files, curl executable stub / no provider | green.log | Pass; real host HTTP and cross-user access pending |
| Memory address selection excludes zero and unreadable mappings | Same Node command | Maps string fixture / no provider | green.log | Pass; real Linux mapped-memory read pending; inaccessible maps are SKIPPED |
| Listener config rejects unsafe socket paths and group values before listen | Same Node command | In-process / no provider | green.log | Pass; CLI rejects empty/nonnumeric GID; signal cleanup and real socket lifecycle pending |
| Token writes use current-main SHA with force false and nonexistent PR merge; generic validation failures do not prove protection | Same Node command | GitHub fetch stub / stub provider | green.log | Pass; real broker token and branch protection response pending |
| Setup validates paths before account changes, changes DB owner and group, generates both firewall backends and repeats safely | Same Node command | Scratch shell, identity/chown/firewall/systemd stubs / no provider | green.log | Pass; generated files and actual scratch modes inspected; no kernel enforcement or boot acceptance |
| Mac directory denies and network configuration are pinned | Same Node command | Settings JSON / no provider | green.log | Pass as configuration check only; real revised settings run pending |
| CI ops job and local prepush plan include secret tests | Same Node command | Source/plan regression / no provider | green.log | Pass; exact new CI run line is the Node command above, run locally; GitHub CI pending |
| Socket framing, mode and client token exchange | Same Node command | Unix socket / stub provider | green.log | Socket-dependent tests SKIPPED because sandbox denies binding; no acceptance |
| Required repository checks | `pnpm lint`, `pnpm typecheck`, `pnpm exec vitest run --changed`, `pnpm spec:parse` | Static / collection / no provider | lint.log, typecheck.log, vitest.log, spec-parse.log | Exit 0 for all four; changed Vitest selected no tests and does not replace Node suite |

Additional checks: `node --test scripts/prepush.test.mjs` passes 46/46 (`prepush-plan.log`); its initial filesystem-discovery regression is preserved in `prepush-plan-red.log`. The final secret suite reports 27 tests: 23 pass, 4 socket-dependent skips, 0 failures. Shell syntax (`bash -n scripts/ops/secret-reach/canary.sh scripts/ops/secret-reach/setup-runner-linux.sh`) passes. The English gate reports zero Chinese lines (`language.log`).

`node scripts/lessons-ledger-gate.mjs` remains nonzero (`ledger.log`): restoring the unrelated baseline keys exposes a stale `docs-only-predicate-too-narrow` baseline and mismatched counters in tickets 1689 and 1703. Those other-ticket entries are untouched as requested. The only baseline differences against origin/main belong to ticket 2189. No global ledger rewrite ran.

The backup test is in the separate `ops-backup-test` CI job, but was not in `scripts/prepush.mjs` at this base. The secret suite was added to that job as its own exact run line and to the required local/CI plan alongside the other Node checks. The unchanged backup step was not rerun; it requires network/rrsync/Linux tooling unavailable here.

## Host acceptance still pending

Use `docs/ops/secret-reach.md`. Before switching users, verify every supplied path exists as the owner, including every database member; omit the old key path after quarantine and use its real destination. Run owner-positive then runner-negative file, mapped-memory and HTTP canaries with all allowed logins passed explicitly, never sourced from server.env. Runner-side canary remains pending. Inspect root and owner connectivity, both IP families, nft/iptables runtime rules, rerun stability, service boot persistence and removal. Verify identities, sudoers, ACLs and DB ownership. Start broker outside the private home; run socket/client tests and SIGTERM/SIGINT cleanup on Linux, then the token probe as runner. Record exact branch-protection response and absent-PR refusal. Rerun real Claude with the revised directory deny file while checking network access. Missing executables, inaccessible maps and socket skips do not establish isolation.

## Retro

Applied retro-cairn. The review exposed false-negative probe evidence and missing boundary checks; regressions now cover the corrected classes. During this round the scratch fixture used macOS's symlinked temporary root, which the new ancestor validator correctly rejected; the fixture now canonicalizes its own root and still tests deliberate unsafe symlinks. Lint also caught an import-order error, corrected through Biome. See `docs/lessons/2189-scratch-path-canonicalization.md` and `docs/lessons/2189-plan-filesystem-dependency.md`. The prepush plan now uses explicit test paths after its own isolated CLI tests caught a directory-discovery crash. A further test-first check caught regular-file ancestors bypassing preflight; ancestor-directory validation and `docs/lessons/2189-preflight-ancestor-type.md` now cover that case. The existing destructive-probe lesson was updated for harmless no-op/absent-resource writes.

## Mac sandbox negative control (dispatcher, real `claude -p` runs)

Claude Code 2.1.312, model claude-haiku-5-5, `--permission-mode bypassPermissions`, each run asked to execute the probe through the Bash tool.

| Run | Settings | Result | Log |
| --- | --- | --- | --- |
| Scratch canary, cat / python / node | `settings-on.json` | all `Operation not permitted` | `mac/on.txt` |
| Scratch canary, forced `dangerouslyDisableSandbox: true` | `settings-on.json` | refused, read blocked | `mac/on-unsandboxed.txt` |
| Scratch canary, symlink / cp / dd, no sandbox | `settings-off.json` | READ on all three (red control) | `mac/off-probe.txt` |
| Real secret paths, symlink / cp / dd / node / git diff --no-index | `settings-mac2.json` (the previous three-path deny list plus `~/.cairn/token`; narrower than the revised whole-directory file) | BLOCKED on all five | `mac/mac-probe2-on.txt` |
| Same probe run directly in a shell, no sandbox | none | READ on all five (red control) | `mac/mac-probe2-off.txt` |
| gh api, git ls-remote, npm registry inside the sandbox | `settings-on.json` without the network keys | gh TLS failure, git cannot reach the proxy | `mac/mac-net.txt` |
| Same with `httpProxyPort`, `allowLocalBinding`, `enableWeakerNetworkIsolation` | `settings-mac2.json` | gh, git, npm OK; key reads blocked | `mac/mac-net2.txt` |

Measured scope: the archived run proves denial only for the tested paths under the historical settings. The revised file denies the entire `~/.cairn/**` and `~/.tds/**` trees; its real Claude rerun remains pending. The settings apply only to sessions started with `--settings`; sessions started without it are unprotected.

## omarchy negative controls (dispatcher, 2026-10-30)

| Check | Result | Log |
| --- | --- | --- |
| Canary as `ian` on the App key, both secretbox.key copies, server.env, token, and the server pid | 36 READ, 1 BLOCKED (`/proc/<pid>/mem` at offset 0): red, as expected while every process runs as `ian` | `omarchy/canary-as-ian.txt` |
| Canary as `cairn-runner` | not run: creating the user needs ian's sudo (`sudo scripts/ops/secret-reach/setup-runner-linux.sh`) | pending |
| Broker token: repositories, branch protection, repo settings, Actions variables, other repo | only `xiechimon/cairn` visible; protection, settings and variables 403; other repo 404; broker refuses another repo and `administration` | `omarchy/token-scope-probe.txt` |
| Same probe with the unscoped `as-bot.sh` token | same statuses: the App installation itself has no administration permission today; the broker pins the scope if the App gains permissions | `omarchy/token-scope-probe-unscoped.txt` |

The historical token scope run predates the socket client, current-main no-op PATCH and absent-PR merge probes. It does not accept those revised mechanisms. The offset-zero memory result is an invalid negative control and supports no memory-isolation claim.

## Mac rerun with the committed settings file (dispatcher, after review round 1)

`claude -p --permission-mode bypassPermissions --settings scripts/ops/secret-reach/claude-sandbox-settings.json` (the committed file, denying `~/.cairn/**` and `~/.tds/**`):

- `probe2.sh` on the App key and secretbox.key: symlink, cp, dd, node, git diff --no-index all BLOCKED (`mac/mac-committed.txt`).
- `probe3.sh` on machine.json, github-oauth.env, credentials.enc, config.json: the sandbox denies even `stat`, so all four show as MISSING inside the session; the same script outside the sandbox reads all four (`mac/probe3-off.txt`).
- `gh api user` and `git ls-remote origin` still work inside the session.
