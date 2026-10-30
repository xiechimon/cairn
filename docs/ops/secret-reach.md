# Secret reachability

The server, daemon and token broker run as the existing owner. Build lanes run as `cairn-runner`, a separate locked-password system identity with its own private home. The runner belongs only to its primary group and `cairn-broker`; the setup replaces supplementary memberships, including sudo, docker and wheel. This does not revoke separately configured sudoers rules, ACLs, capabilities, existing sessions or inherited credentials. Inspect these on the host before dispatching lanes. Root remains outside this boundary.

The broker keeps the App PEM in the owner process and accepts newline-delimited JSON over a Unix socket. It mints only an installation token for `xiechimon/cairn`, restricted to repository `cairn` and contents, pull requests and issues write permissions. Every caller allowed onto the socket can obtain that token; it is intentionally a repository write capability. No arbitrary GitHub API proxy exists.

## One manual sudo step

As the owner, inspect the script, then run once:

```sh
bash scripts/ops/secret-reach/setup-runner-linux.sh --dry-run
sudo bash scripts/ops/secret-reach/setup-runner-linux.sh
```

The command preserves the owner home at 700, changes the server directory to 750, database family to owner-and-primary-group-owned 640, and moves the stale key into a unique 700 quarantine directory. It never deletes the stale key. Rerunning does not move an already quarantined key. Stop if existing identity configuration or paths differ from the documented model. Direct sudoers grants are a host audit requirement.

The script validates paths and ancestors before account or file mutation and refuses symlinks or non-regular database members. It installs no firewall rules or systemd firewall unit.

The API path is closed by the separate #2057 product change, not by this branch: trust the identity header only on an owner-only Unix socket; TCP always needs the token. Run the runner-side canary after both changes are deployed. Historical measurements found access with a forged header directly, through the Tailscale serve URL, and through the owner-run sing-box proxy at loopback port 7890 (HTTP 200 in review round 3). Firewall destination rules cannot establish the authentication boundary across owner-run forwarders.

Start a fresh owner session to obtain the new shared group. Create a socket parent directory outside the private home, owned by the owner and group `cairn-broker`, mode 750. Do not put the socket in a runner-writable directory. Set `CAIRN_GITHUB_APP_ID`, `CAIRN_GITHUB_INSTALLATION_ID`, `CAIRN_GITHUB_APP_KEY`, `CAIRN_BROKER_SOCKET` and positive, nonzero numeric `CAIRN_BROKER_GID`, then run `node scripts/ops/secret-reach/broker.mjs` as the owner. Use an absolute socket path. SIGTERM and SIGINT close and unlink the socket. The broker refuses existing socket paths; after a crash, the owner must verify no broker is alive before removing a stale socket. Keep tokens out of logs and shell tracing.

Request shape:

```json
{"type":"mint","repository":"xiechimon/cairn","permissions":{"contents":"write","pull_requests":"write","issues":"write"}}
```

A response contains `token` and `expires_at`; errors contain only `error`. Input is limited to 8192 bytes and connections time out after 15 seconds. HTTP requests time out after 10 seconds.

## Negative controls for the dispatcher

Run `node --test scripts/ops/secret-reach/*.test.mjs` on Linux, including the socket test that this sandbox cannot bind. Inspect `id cairn-runner`, sudoers, groups, ACLs and file ownership. Repeat setup and confirm state and quarantine contents remain stable. Confirm the active owner process can still read its keys and database.

As the owner, check every supplied secret and DB path exists with `test -e` before switching users. A runner cannot distinguish a missing descendant behind an inaccessible directory from a real denied path. Each supplied path is an assertion of existence; MISSING is an error and fails the run. After quarantine, use the actual quarantine destination instead of the removed old path.

Stage the canary script and `process-memory.mjs` together in a runner-readable directory outside the private owner home. Run the canary first as the owner against a harmless marker file (expect exit 1), then as `cairn-runner` against the App PEM, current and stale key paths, server environment, owner token, database family and server/daemon PIDs (expect exit 0 with all available channels BLOCKED). Supply the actual host paths locally; never commit environment contents or tokens. Example:

```sh
sudo -u cairn-runner bash scripts/ops/secret-reach/canary.sh --paths /path/to/key /path/to/server.db --pid 1234 --server-url http://127.0.0.1:8787 --server-url https://machine.example.ts.net --tailscale-users login-one,login-two
```

Each line reports status, channel, path and, for successful reads, byte count. Missing executables produce SKIPPED and cannot support isolation claims. Linux memory reads use a nonzero readable address from `/proc/<pid>/maps`. EACCES or EPERM on maps or memory reports BLOCKED. Missing maps, no usable address, short reads and other mapping errors report SKIPPED. One mapping is not an exhaustive ptrace audit. The HTTP channel accepts repeated `--server-url` values, including HTTPS serve URLs. On Linux it re-reads `tailscale ip` and also probes each current self address over HTTPS port 443. Discovery failure reports SKIPPED and cannot support a self-address isolation claim. Curl disables certificate validation for these negative probes so a certificate mismatch on a numeric address cannot masquerade as firewall blocking; this is not TLS acceptance. Supply the actual serve hostname as well to exercise hostname routing. Every HTTP result includes its endpoint. The HTTP channel GETs `/api/teams` anonymously and with each comma-separated allowed login supplied via `--tailscale-users`; when no login is supplied it still sends the synthetic forged login `secret-reach-probe`, which cannot substitute for testing the configured allowed logins. Obtain the configured list outside this probe and never read server.env here. Each endpoint and identity is tested directly and through each configured `HTTP_PROXY`/`HTTPS_PROXY`, overriding `NO_PROXY` for the proxy leg. No token is sent. Any 2xx is READ and fails. A run where every channel is SKIPPED also fails. Transport failure is BLOCKED for that endpoint only, not proof of auth correctness. Verify owner-positive connectivity separately. The canary tests only these channels, not all possible exfiltration mechanisms.

Exercise the real broker from the runner account. Validate the returned token's repository and permissions through GitHub without printing the token. Other repositories and extra permissions must be refused. Record red and green runtime evidence, never credentials. The client requires no owner configuration or key access:

```sh
sudo -u cairn-runner node scripts/ops/secret-reach/token-scope-probe.mjs /absolute/broker.sock
```

The protection permission probes are `GET /repos/xiechimon/cairn/branches/main/protection` and DELETE protection on an absent branch, `cairn-scope-probe-absent`; no protection PUT on main runs. It requests the fixed token over the socket, reads the current main SHA and sends `PATCH /repos/xiechimon/cairn/git/refs/heads/main` with that SHA and `force: false`. A 2xx fails even though the permitted update is a no-op. A generic validation error is not branch protection evidence: the response must identify protected-branch or repository-rule rejection. If main advances concurrently, rerun after inspecting the response. It also attempts `PUT /repos/xiechimon/cairn/pulls/999999999/merge`; 404 is acceptable and any 2xx fails. Confirm the named absent branch, variable, webhook ID 999999999 and PR 999999999 do not exist before probing. All other writes delete only those absent resources; never substitute an existing resource. The main response message is printed with the token redacted. Real GitHub outcomes remain host acceptance work.

For Mac goal sessions, copy `scripts/ops/secret-reach/claude-sandbox-settings.json` outside the repository, make that copy read-only before a session uses it, and pass its absolute path through `--settings` to Claude Code. Keep the containing directory outside runner write access too. The Mac session's own `gh` token is the user's full token and is out of scope for this isolation boundary; working `gh` access does not establish broker-scoped credentials on Mac. It turns the Bash sandbox on, refuses unsandboxed retries, and denies both `~/.cairn/**` and `~/.tds/**`. The historical three-path settings denied the tested Mac secret paths at the OS level, so `cat`, Python, Node, `dd`, `cp`, a symlink and `git diff --no-index` all fail with `Operation not permitted`, also under `--permission-mode bypassPermissions` (Claude Code 2.1.312, measured, `docs/verify/2189/mac/`). The revised whole-directory settings require a new real Claude run. `httpProxyPort` and `allowLocalBinding` let `git` and `gh` reach the local proxy on 127.0.0.1:7890, and `enableWeakerNetworkIsolation` lets `gh` verify TLS; without them `gh api` fails with OSStatus -26276 and `git ls-remote` cannot reach the proxy. Do not add `git` or `gh` to `sandbox.excludedCommands`: excluded commands run without filesystem restrictions, and `git diff --no-index` reads any file.
