# Secret reachability

The server, daemon and token broker run as the existing owner. Build lanes run as `cairn-runner`, a separate locked-password system identity with its own private home. The runner belongs only to its primary group and `cairn-broker`; the setup replaces supplementary memberships, including sudo, docker and wheel. This does not revoke separately configured sudoers rules, ACLs, capabilities, existing sessions or inherited credentials. Inspect these on the host before dispatching lanes. Root remains outside this boundary.

The broker keeps the App PEM in the owner process and accepts newline-delimited JSON over a Unix socket. It mints only an installation token for `xiechimon/cairn`, restricted to repository `cairn` and contents, pull requests and issues write permissions. Every caller allowed onto the socket can obtain that token; it is intentionally a repository write capability. No arbitrary GitHub API proxy exists.

## One manual sudo step

As the owner, inspect the script, then run once:

```sh
bash scripts/ops/secret-reach/setup-runner-linux.sh --dry-run
sudo bash scripts/ops/secret-reach/setup-runner-linux.sh
```

The command preserves the owner home at 700, changes the server directory to 750, database family to owner-owned 640, and moves the stale key into a unique 700 quarantine directory. It never deletes the stale key. Rerunning does not move an already quarantined key. Stop if existing identity configuration or paths differ from the documented model. Direct sudoers grants are a host audit requirement.

Start a fresh owner session to obtain the new shared group. Create a socket parent directory outside the private home, owned by the owner and group `cairn-broker`, mode 750. Do not put the socket in a runner-writable directory. Set `CAIRN_GITHUB_APP_ID`, `CAIRN_GITHUB_INSTALLATION_ID`, `CAIRN_GITHUB_APP_KEY`, `CAIRN_BROKER_SOCKET` and numeric `CAIRN_BROKER_GID`, then run `node scripts/ops/secret-reach/broker.mjs` as the owner. The broker refuses existing socket paths; after a crash, the owner must verify no broker is alive before removing a stale socket. Keep tokens out of logs and shell tracing.

Request shape:

```json
{"type":"mint","repository":"xiechimon/cairn","permissions":{"contents":"write","pull_requests":"write","issues":"write"}}
```

A response contains `token` and `expires_at`; errors contain only `error`. Input is limited to 8192 bytes and connections time out after 15 seconds. HTTP requests time out after 10 seconds.

## Negative controls for the dispatcher

Run `node --test scripts/ops/secret-reach/*.test.mjs` on Linux, including the socket test that this sandbox cannot bind. Inspect `id cairn-runner`, sudoers, groups, ACLs and file ownership. Repeat setup and confirm state and quarantine contents remain stable. Confirm the active owner process can still read its keys and database.

Stage the canary script in a runner-readable directory outside the private owner home. Run the canary first as the owner against a harmless marker file (expect exit 1), then as `cairn-runner` against the App PEM, current and stale key paths, server environment, owner token, database family and server/daemon PIDs (expect exit 0 with all available channels BLOCKED). Supply the actual host paths locally; never commit environment contents or tokens. Example:

```sh
sudo -u cairn-runner bash scripts/ops/secret-reach/canary.sh --paths /path/to/key /path/to/server.db --pid 1234
```

Each line reports status, channel, path and, for successful reads, byte count. Missing executables produce SKIPPED and cannot support isolation claims. Linux process memory is probed at offset zero; a failed read there does not prove mapped memory cannot be read with ptrace or another offset. Audit ptrace policy separately. The canary tests only these channels, not all possible exfiltration mechanisms.

Exercise the real broker from the runner account. Validate the returned token's repository and permissions through GitHub without printing the token. Other repositories and extra permissions must be refused. Record red and green runtime evidence, never credentials.

For Mac goal sessions, pass `--settings scripts/ops/secret-reach/claude-sandbox-settings.json` to Claude Code. It turns the Bash sandbox on, refuses unsandboxed retries, and denies reads of the Mac secret paths at the OS level, so `cat`, Python, Node, `dd`, `cp`, a symlink and `git diff --no-index` all fail with `Operation not permitted`, also under `--permission-mode bypassPermissions` (Claude Code 2.1.312, measured, `docs/verify/2189/mac/`). `httpProxyPort` and `allowLocalBinding` let `git` and `gh` reach the local proxy on 127.0.0.1:7890, and `enableWeakerNetworkIsolation` lets `gh` verify TLS; without them `gh api` fails with OSStatus -26276 and `git ls-remote` cannot reach the proxy. Do not add `git` or `gh` to `sandbox.excludedCommands`: excluded commands run without filesystem restrictions, and `git diff --no-index` reads any file.
