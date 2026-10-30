# Current approach after review round 3

The API path is closed by #2057, not by this branch. #2057 must trust the identity header only on an owner-only Unix socket; TCP always needs the token. Run the runner-side canary after both changes are deployed. Earlier firewall evidence below is historical and superseded.

Historical measurements motivating this decision: a forged identity header reached the direct API, the Tailscale serve URL exposed the same route, and round 3 reached the owner API through sing-box at loopback port 7890 with the forged header (HTTP 200). These are dispatcher/user-reported historical measurements, not rerun in this sandbox.

## Current failure modes (before implementation)

| Failure mode | Test or unverified limit |
| --- | --- |
| Setup still invokes or installs firewall/systemd files | Setup scratch fixture rejects firewall calls and generated files |
| Removing firewall also removes identity, modes or quarantine safety | Setup fixture checks groups, modes, unsafe ancestors, symlinks and stable quarantine reruns |
| Proxy bypass hides an owner-run forwarder | Curl argument fixture covers HTTP_PROXY and HTTPS_PROXY with NO_PROXY set |
| Anonymous or forged identity omitted for an endpoint or leg | Curl fixture checks each URL and identity on direct and proxy legs |
| Any 2xx incorrectly accepted | Status matrix includes 200, 204 and 299; denial and transport failure controls |
| Everything SKIPPED exits successfully | PID-only non-Linux fixture; missing-curl-only execution remains unverified |
| Removed test remains in prepush or CI misses new tests | Existing review plan test checks all test paths; CI wildcard remains current |
| Existing file/memory/broker behavior regresses | Existing Node suite; sandbox socket skips remain unverified |
| Real host API auth, proxy routing or cross-user access differs | Unverified: deploy both branches and run runner canary on host |

GitHub overlap lookup is unavailable under the explicit sandbox constraint. Continue assigned #2189 branch; #2057 is separate related product work. No absence-of-overlap claim.

---

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
| Memory address selection excludes zero and unreadable mappings | Same Node command | Maps string fixture / no provider | green.log | Pass; real Linux mapped-memory read pending; maps permission rejection is BLOCKED; other unavailable maps are SKIPPED |
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

Use `docs/ops/secret-reach.md`. Before switching users, verify every supplied path exists as the owner, including every database member; omit the old key path after quarantine and use its real destination. Run owner-positive then runner-negative file, mapped-memory and HTTP canaries with all allowed logins passed explicitly, never sourced from server.env. Runner-side canary remains pending. Inspect root and owner connectivity, both IP families, nft/iptables runtime rules, rerun stability, service boot persistence and removal. Verify identities, sudoers, ACLs and DB ownership. Start broker outside the private home; run socket/client tests and SIGTERM/SIGINT cleanup on Linux, then the token probe as runner. Record exact branch-protection response and absent-PR refusal. Rerun real Claude with the revised directory deny file while checking network access. Missing executables, missing maps and socket skips do not establish isolation.

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

## Review round 2 failure modes (recorded before implementation)

| Failure mode | Test or limit |
| --- | --- |
| Runner reaches its own Tailscale serve address on any TCP port | Setup fixture checks IPv4/IPv6 destination rules without port restriction; host kernel enforcement pending |
| Firewall rejects established teardown packets | Both generated backends must match NEW only |
| Missing rules or changed Tailscale addresses escape dispatch checks | Checker fixture removes each rule and changes address discovery; must fail naming missing rule |
| Empty arrays abort Bash 3.2 HTTP-only canary | Empty paths, anonymous headers and empty login fixtures run with /bin/bash |
| Multiple URLs overwrite or reject HTTPS | Curl fixture records every endpoint with anonymous and forged headers |
| Permission-denied maps incorrectly skipped | Injected EACCES/EPERM memory fixture must report BLOCKED |
| Root or negative broker GID accepted | Broker validation before socket bind |
| Documentation overclaims token probes or Mac credentials | Documentation regression; real GitHub and Mac session acceptance remain pending |
| Tailscale discovery unavailable or empty | Setup and checker must fail closed; host address changes require rerunning setup |

No GitHub overlap lookup is possible under this run's explicit network constraint. Continue the existing ticket branch; no overlap absence claim is made.


## Ticket wording correction for the dispatcher

Protection permission acceptance means GET `/repos/xiechimon/cairn/branches/main/protection` plus DELETE protection on the absent branch `cairn-scope-probe-absent`, not PUT protection on main. The current-main-SHA no-op PATCH and absent PR merge are separate probes. Update the ticket wording with this distinction when GitHub access is available; the ticket itself was not edited here.

## Review round 2 acceptance record

Tested base: `70cc4dda0334c1e60491df24520c1cce74d62f4a` plus this uncommitted worktree diff; source identities are recorded in `round2-tested-source.sha256`. These are local-only artifacts, not delivered verification. No commit, push, PR, GitHub ticket edit, remote host access, build, full e2e, live app, daemon, LLM or real-provider run occurred. No third-party package API was introduced. Automated checks below are not an independent review or a security review.

| Supported local claim | Command | Surface and provider mode | Artifact | Result and limits |
| --- | --- | --- | --- | --- |
| Old behavior fails the new regressions | `node --test scripts/ops/secret-reach/*.test.mjs` and focused Node runs | Scratch files, generated shell commands, injected maps errors and curl stubs; no provider | red.log | Nonzero red runs retained, including intermediate fixture errors; trailing whitespace normalized only |
| Both backends emit self IPv4/IPv6 runner destination rejects without a port restriction and with NEW matching, alongside the loopback rule | `node --test scripts/ops/secret-reach/*.test.mjs` | Executed setup and generated apply script in scratch filesystem; nft, iptables, identity and systemd stubs | green.log | Emitted rule payloads recorded as diagnostics. No real kernel, established-connection or reboot claim |
| Dispatcher check rejects every missing expected rule/hook/jump and changed address discovery | Same full Node command | Generated checker execution against mocked rule listings/command responses | green.log | Missing-rule diagnostics recorded; standalone wrapper also tested with present, absent and failing installed validator. Actual nft listing serialization and firewall ordering remain host acceptance |
| Discovery failure or empty addresses abort setup before account mutation | Same full Node command | Scratch setup with failing/empty tailscale executable | green.log | Pass; actual host command availability unverified |
| HTTP canary accepts repeated HTTP/HTTPS URLs, probes anonymous and forged identities, and re-reads both self address families | Same full Node command; `node --test scripts/ops/secret-reach/round2.test.mjs` | Curl/tailscale executable stubs under real `/bin/bash` 3.2.57 | green.log | Full suite: 36 tests, 32 pass, 4 socket skips, zero failures. Focused final rerun: 8 pass. Synthetic default forged login is only a control; host acceptance must pass every configured allowed login and actual serve hostname |
| EACCES/EPERM maps refusal is BLOCKED; missing maps remain SKIPPED | Same Node commands | Executed memory helper with injected filesystem error at maps read | green.log | Pass; real cross-user maps/memory refusal unverified |
| API and CLI reject root/negative GIDs before socket binding/key access | Same full Node command | In-process validation and spawned broker CLI; no provider | green.log | Pass; socket lifecycle and token exchange remain skipped because sandbox refuses binding |
| Documentation names GET protection and DELETE on the absent branch, Mac full-token limit, and external read-only settings copy | Same Node commands | Documentation regression; no provider | green.log | Pass as documentation check only; ticket wording correction above awaits GitHub access |
| Repository lint | `pnpm lint` | Static; no provider | round2-lint.log | Exit 0; existing unrelated informational diagnostic retained |
| Repository typecheck | `pnpm typecheck` | TypeScript; no provider | round2-typecheck.log | Exit 0 |
| Changed Vitest | `pnpm exec vitest run --changed` | Test selection; no provider | round2-vitest.log | Exit 0 with no tests selected; does not replace the Node suite |
| Spec collection | `pnpm spec:parse` | Collection and integration tsc; no provider | round2-spec-parse.log | Exit 0, 1391 web cases collected and 65 integration test files parsed; no e2e execution |
| Prepush plan regression | `node --test scripts/prepush.test.mjs` | Isolated CLI fixtures; no provider | round2-prepush-plan.log | 46 pass, zero failures; new secret tests are explicitly listed in the plan |
| Shell syntax and repository gates | `bash -n scripts/ops/secret-reach/{canary,setup-runner-linux,check-rules}.sh`; English, comment and lessons ledger gates | Static; no provider | round2-shell.log, round2-english.log, round2-comments.log, round2-ledger.log | Exit 0; no global ledger rewrite |

The exact existing CI secret-test run line is the full Node command above and was executed locally. No workflow step was edited. No fixture or screenshot is presented as live-app evidence; no screenshot was needed for this shell task. No stub result is presented as a real-provider result. Before a later delivery, the dispatcher must commit the artifacts on this delivery branch and add SHA-pinned raw evidence links to its PR; that delivery condition is intentionally unverified here.

## Review round 2 host acceptance still pending

On omarchy, inspect and run setup, then run `sudo bash scripts/ops/secret-reach/check-rules.sh` before every batch. Verify current `tailscale ip` addresses match the installed rules; rerun setup after address changes. Inspect actual nft or both iptables rule sets and rule ordering. Run runner-negative HTTP canaries against loopback, the actual HTTPS serve hostname and both discovered self addresses, with every allowed login supplied, without a token. Establish owner/root positive access separately. Confirm all-port destination rejection, established teardown traffic, repeat setup, boot persistence and removal with actual kernel observations. Missing tools, discovery failures, TLS/transport errors and synthetic identities alone cannot establish that authentication or the intended firewall boundary works.

Run the Linux socket, broker token and cross-user file/memory checks described above. Real GitHub protection, absent-resource responses and ticket edits remain unverified. On Mac, copy settings outside the repository, make the copy read-only and protect its parent before launching a new session; recheck the real sandbox. The session's own `gh` token remains the user's full token, outside this boundary. No claim of Mac token confinement is made.

## Review round 2 retro

Applied `.claude/skills/retro-cairn/SKILL.md`. Four reviewed error classes now have executable regressions: self-address firewall coverage/checking, empty-array canary execution, maps-refusal classification and root broker groups. This round also corrected fixture source escaping/argument injection and an assertion that confused expanded runtime rules with source variables; the actual failed runs are retained. Five ticket-specific ledger entries document these safeguards at level 2. No unrelated lesson entries or baseline counters were rewritten.

## Current approach acceptance record (supersedes firewall acceptance above)

Tested commit: `937d2726cbf3fb2fdf661e4d3ef3acfe59421b5c` plus the uncommitted current diff. Source hashes are in `current-source.sha256`. This is local-only evidence: no commit, push, PR or delivered verification is claimed. No live app, daemon or real provider ran. No external package API was introduced.

| Supported claim | Command | Surface / provider | Artifact | Result and limits |
| --- | --- | --- | --- | --- |
| New regressions reject the old approach | `node --test scripts/ops/secret-reach/*.test.mjs` | Scratch setup, curl and OS executable stubs / no provider | `red.log`, section CURRENT APPROACH AFTER ROUND 3 | Exit 1 before implementation: proxy, all-skipped and removed-dependency regressions fail |
| Setup preserves group isolation, modes, quarantine, preflight rejection and rerun safety without firewall calls or files | Same command | Real shell and scratch filesystem; identity/ownership commands stubbed / no provider | `green.log`, current section | Exit 0; no real user, chown or host security claim |
| Every URL gets anonymous and forged-header direct/proxy probes; 200/204/299 fail, 401 and transport failure classify as blocked | Same command | Real Bash, curl argv/status stub with HTTP_PROXY or HTTPS_PROXY and NO_PROXY=* / no provider | `green.log`, current section | 45 tests: 41 pass, 4 socket skips; actual curl wire traffic and sing-box forwarding unverified |
| All-skipped process-only execution fails | Same command | Non-Linux uname stub / no provider | `green.log`, current section | Pass; missing-curl-only execution not independently exercised |
| CI wildcard and updated explicit prepush list cover current tests | Same command; `node --test scripts/prepush.test.mjs` | Plan/source regression and isolated CLI fixtures / no provider | `green.log`, `current-prepush-plan.log` | 46 prepush tests pass; CI run line is unchanged and was run exactly locally; GitHub CI unverified |
| Required static and collection checks pass | `pnpm lint`; `pnpm typecheck`; `pnpm exec vitest run --changed`; `pnpm spec:parse` | Static/selection/collection / no provider | `current-lint.log`, `current-typecheck.log`, `current-vitest.log`, `current-spec-parse.log` | All exit 0; lint has one existing informational diagnostic; Vitest selects no tests; 1391 web cases collected, 65 integration files parsed; no e2e executed |
| Shell syntax and repository prose checks pass | `bash -n scripts/ops/secret-reach/canary.sh scripts/ops/secret-reach/setup-runner-linux.sh`; English, comment and lessons ledger gates | Static / no provider | `current-shell.log`, `current-english.log`, `current-comments.log`, `current-ledger.log` | Exit 0 |

Mechanism evidence is the executed scratch setup and curl argument/status diagnostics, not a claim that host authentication works. No screenshots are presented. Automated checks are not independent review or security review. A later delivery must commit these artifacts and use SHA-pinned raw links in its PR; that condition remains unverified by instruction.

After both this branch and #2057 are deployed, run the operations guide's owner-positive and runner-negative canaries on omarchy. Supply every configured allowed identity and actual loopback/serve URL; preserve HTTP_PROXY/HTTPS_PROXY in the runner invocation to exercise sing-box. Check both direct and proxy HTTP responses with no token. Transport errors do not prove authentication correctness. Inspect actual identities, sudoers, ACLs, file ownership, quarantine, Linux process access and broker socket/token behavior. Existing firewall deployment cleanup, if any previous setup was applied, is host work and is not performed by the revised setup. GitHub and omarchy are unavailable here.

Current retro: applied `.claude/skills/retro-cairn/SKILL.md`. One process error was corrected: tee initially replaced historical acceptance logs. Their base prefixes are restored byte-for-byte, current runs appended, and prefix comparison rejects the replacement-only form and accepts the restored form. See `docs/lessons/2189-evidence-log-overwrite.md`.
