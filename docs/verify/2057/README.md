# #2057 Unix socket identity boundary

## Context

Assigned branch only. GitHub overlap lookup, issue comments and open/recently merged PRs are unverified: network access is unavailable by dispatch constraint. Proceed on the assigned branch using the supplied October 30 decision; no claim of no overlaps. No commit, push, PR, full build or full e2e is authorized.

## Failure modes recorded before implementation

| Failure mode | Test or limit |
| --- | --- |
| Forged identity over IPv4/IPv6 loopback or forwarded TCP | token-auth peer matrix and real TCP request |
| Missing transport information mistaken for socket | token-auth missing-peer test |
| Allowed socket login denied; unknown or absent login admitted | real socket authentication matrix |
| Bearer fallback broken on TCP or socket | real listener matrix; existing bearer/SSE/exemption tests |
| Enrollment confirmation retains loopback bypass | enrollment regression; real socket enrollment |
| Relative socket path | socket listener rejection test |
| Existing file, directory or symlink removed | socket listener rejection tests |
| Parent writable by group or others | socket listener rejection tests |
| Missing parent | socket listener rejection test |
| Stale owner socket cannot restart | killed child socket fixture |
| Active socket overwritten | occupied socket rejection test |
| Foreign owner socket removed | unverified: no second UID available in sandbox |
| Socket exposed through permissive process umask | real socket mode/UID assertion |
| Bind/chmod failure leaves usable unsafe listener | fail-closed implementation; OS fault injection unverified |
| Warning absent or repeated with allowlist and no socket | warning unit tests |
| Browser fixture silently relies on TCP identity | browser regression updated; execution status recorded below |
| TCP daemon/scripts lose credentials | existing machine credential tests; consumer grep; real daemon unverified |
| Tailscale root proxy or host migration fails | unverified on omarchy; host procedure in deployment guide |
| Same-UID process or root forges socket identity | stated boundary: owner/root can access socket; not isolated from same UID |
| Concurrent hostile filesystem replacement | parent must be protected; hostile owner/root and ancestor replacement not isolated |

## Evidence limits

Base commit: `052baac65008892873e4706527aeaa7c6fc7892a`; tests target the uncommitted working diff, not a delivered commit. Local logs are review material only until the dispatcher commits them and adds SHA-pinned raw links to the PR. No delivered/CI verification is claimed.

Intended integration surface: real HTTP listeners with the production Hono app and scratch SQLite; unit app requests use synthetic bindings. Provider mode: not exercised; no LLM, external provider, daemon, Tailscale or browser claim follows from HTTP tests. Automated checks are separate from code/security review, neither evidence gates nor passing tests establish review sufficiency. No fixture screenshot is offered as live-app evidence.

Artifacts: `red.log`, `green.log`, and check logs below. Results and host-only limits will be updated after execution.

## Acceptance claims and local evidence

Every row below targets base `052baac65008892873e4706527aeaa7c6fc7892a` plus this uncommitted diff. Provider mode is **not exercised** throughout. These are local measurements, not delivered verification.

| Claim | Command | Surface | Artifact | Result and limits |
| --- | --- | --- | --- | --- |
| TCP loopback headers are rejected by the API and enrollment auth predicates; bearer and existing exemptions remain usable | `pnpm exec vitest run apps/server/test/token-auth.test.ts apps/server/test/enroll-confirm-auth.test.ts apps/server/test/startup-log.test.ts` | Production Hono app, scratch DB, synthetic peer bindings | [red.log](red.log), [green.log](green.log) | Measured: 7 expected auth/config failures before implementation; 54 tests pass afterward. This does not establish actual TCP/Unix listener behavior. |
| Dedicated listener admits only allowed socket identities; bearer works over TCP; socket mode is 0600; occupied and stale sockets are handled | `pnpm exec vitest run apps/server/test/token-auth.test.ts apps/server/test/tailscale-socket.test.ts apps/server/test/enroll-confirm-auth.test.ts` | Real HTTP listener attempted, production app and scratch DB | [socket-blocked.log](socket-blocked.log) | Unverified: sandbox rejects Unix listen with EPERM. Seven filesystem rejection cases pass, but three listener cases fail. The original red run could not collect the new suite because its module did not exist; it is not a behavioral red for each socket case. |
| Host probe preflight rejects unsafe files and missing credentials | `node --test scripts/ops/verify-tailscale-socket.test.mjs` | Scratch filesystem fixture, no HTTP listener | [host-probe-red.log](host-probe-red.log), [host-probe-green.log](host-probe-green.log) | Measured: missing module red, then 2 tests pass. Successful HTTP probe execution remains unverified. |
| Code passes static lint and types | `pnpm lint`; `pnpm typecheck` | Static source | [lint.log](lint.log), [typecheck.log](typecheck.log) | Measured: both exit 0; lint reports one existing informational flatMap finding in an untouched file. |
| Web and integration specs collect | `pnpm spec:parse` | Collection only; no browser or provider execution | [spec-parse.log](spec-parse.log) | Measured: 1391 web tests in 198 files collected; 65 integration test files parse; exit 0. |
| Related regressions pass | `pnpm exec vitest run --changed` | Mixed unit/integration fixtures selected by Vitest | [changed.log](changed.log) | Interrupted with exit 130 after repeated fixture failures/timeouts; output is partial, no aggregate pass count. TCP/Unix listen failures are confirmed EPERM; performance failures are not diagnosed. No blanket green claim. |
| No current TCP client intentionally injects a Tailscale identity header | `rg -n -i 'tailscale-user-login\|loopback.*tailscale\|tailscale.*loopback\|tailscale serve --bg http' apps scripts docs` with archived evidence excluded | Source inventory | [identity-consumers.txt](identity-consumers.txt) | Measured: auth predicate, deployment guide, tests and new host probe are the remaining consumers. Daemon machine-client sends bearer credentials. The isolation guide was updated too. The feature-map row retains the historical #1762 issue title; this change supersedes its loopback-only behavior. Historical evidence such as `docs/verify/2053/README.md` describes the old behavior and is intentionally retained. Real daemon execution is unverified. |

## Host acceptance still required

The following script is read-only and prints no token. Run it as the server user after setting the service environment, restarting the server, and checking that the socket exists. Supply the current token through the environment without recording its value:

```sh
node scripts/ops/verify-tailscale-socket.mjs "$CAIRN_TAILSCALE_SOCKET" http://127.0.0.1:8787 "$CAIRN_TAILSCALE_USERS"
```

Set `CAIRN_TOKEN` in that process environment and pass one allowlisted login as the last argument, not a comma-separated list. Save the JSON output as host evidence. The script checks socket type/UID/mode and actual API responses: forged TCP header 401, TCP bearer 200, allowed socket identity 200, unknown socket identity 401. Its adjacent `node --test` fixture verifies preflight only because this sandbox cannot bind listeners.

Then, with the token fallback available, run root `tailscale serve --bg unix:<absolute-socket-path>` in the documented migration order. Verify the HTTPS app from allowed and unknown tailnet identities, and check actual daemon enrollment/requests using its credentials. Those tests, foreign-UID access denial, Linux socket lifecycle, browser behavior, installed Tailscale 1.104 help, and production service deployment remain unverified here. The provided dispatch statement is the source for `unix:` target support; no online verification was attempted.

## Review and retro

Manual source review checked that only the Unix listener can insert requests into the private WeakSet; request headers and synthetic peer metadata cannot insert them. This is reasoning from source, not runtime proof of the Unix path. Parent mode checks and inode/UID revalidation guard stale-socket removal; same-UID/root access and hostile ancestor replacement remain outside this boundary.

The available skill catalog and project skills contain neither `code-review` nor `security-review`; those skill-based reviews and a fresh independent other-vendor review remain pending for the dispatcher before any PR. Automated gates are not substitutes. No PR is opened in this run.

Applied `.claude/skills/retro-cairn/SKILL.md`: one harness mistake was found and corrected. The stale-socket child could exit before stdout readiness, causing a timeout; readiness now races child exit. The safeguard is recorded in `docs/lessons/2057-socket-fixture-readiness.md`, with the original timeout in `socket-blocked.log` as the negative observation. No product defect found by the planned red tests is counted as a process mistake.

The final socket rerun is archived in [socket-final.log](socket-final.log): 7 filesystem tests pass, 3 listener cases remain blocked; the stale child now rejects immediately rather than timing out. [lint-final.log](lint-final.log) includes the host probe files and exits 0. `git diff --check`, the lessons ledger gate, comment discipline gate and English-only gate pass. No code/security-review skill is available, and no independent review was run.

## Changed files

- `apps/server/src/config.ts`: optional absolute socket configuration and missing-socket warning.
- `apps/server/src/index.ts`: additional socket listener and shutdown wiring.
- `apps/server/src/lib/token-auth.ts`: private request provenance and shared identity check for API/enrollment.
- `apps/server/src/lib/tailscale-socket.ts`: protected socket lifecycle, stale-owner checks and listener.
- `apps/server/test/token-auth.test.ts`: TCP denial and configuration regressions, written and run red first.
- `apps/server/test/enroll-confirm-auth.test.ts`: TCP enrollment bypass regression, written and run red first.
- `apps/server/test/tailscale-socket.test.ts`: real socket/TCP app requests and filesystem/lifecycle integration cases, written before implementation; runtime cases remain blocked locally.
- `apps/web/e2e/live-server.ts`: isolate child socket environment.
- `apps/web/e2e/token-gate.spec.ts`: forged TCP identity must show the token gate; browser execution unverified.
- `docs/deploy/tailscale-mobile.md`: Unix target, token fallback and migration order.
- `docs/security/agent-isolation.md`: replace stale loopback-proxy guidance.
- `scripts/ops/verify-tailscale-socket.mjs` and `.test.mjs`: host acceptance probe and scratch preflight tests.
- `docs/lessons/2057-socket-fixture-readiness.md`: readiness/early-exit safeguard.
- `docs/verify/2057/`: failure modes, evidence limits, consumer inventory and command logs.

No lockfile, commit, push, PR, other worktree, full build or full e2e change/run is included. Repository gates compare tracked diffs; because nothing is staged or committed, their treatment of new untracked files is limited. New TypeScript files are covered by typecheck and direct tests; the new host probe is covered by direct Biome and node test commands.

The required `pnpm exec vitest run --changed` was run and then interrupted with exit 130 after repeated fixture listener failures and timeouts. Its partial output includes push delivery, skill-write, attachment-GC, proposal-cycle performance, socket and reflect-curate failures; causes beyond the directly observed EPERM are unverified. The run began before the final request-provenance registry refactor; final focused tests, lint and typecheck were rerun afterward. No final-diff aggregate changed-test success is claimed.

[Source checksums](source-sha256.txt) identify the final uncommitted code and test files. [Environment](environment.txt) records the actual local runtime, which differs from the default Node version documented in machine instructions; Node 22/24 compatibility was not separately exercised. Installed adapter metadata and types identify `@hono/node-server` 2.1.1 and Hono 4.13.8. `npm ls` also flagged workspace/catalog compatibility metadata, so this run does not establish dependency-tree health.

Evidence log paths are sanitized: `<worktree>` replaces the current checkout, `<home>` replaces the local home and `<tmp>` replaces the system temporary directory. Output assertions, errors and results are preserved.
