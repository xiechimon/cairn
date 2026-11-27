# Runner secret isolation (#2189)

Status: the `omarchy` host was torn down on 2026-11-18, and no current Mac host installs the Linux UID boundary (`setup-runner-user.sh`, `broker.mjs`). The Linux scripts and offline tests stay in-repo for Linux hosts; the Mac batch-session Seatbelt sandbox (`batch-sandbox.settings.json`) and `canary.mjs --profile mac` are active on macOS.

This implements the tools for the Linux UID boundary and Mac batch-session sandbox. Mac agent sandbox settings and their host runs for interactive sessions remain out of scope (#2189).

## Threat model and failure modes

Treat a runner and its child processes as arbitrary code. Unix permissions, rather than agent permission prompts, must prevent access to the App private key, server encryption key, server environment, daemon token, live data and stale data copies. The owner and root remain trusted. An already compromised owner process, root access, capabilities, explicit sudo grants, alternate hard links/backups outside the inventory, and existing leaked tokens are outside this boundary. Revoke previously exposed credentials separately.

The setup creates a locked-password system account with a private primary group and no supplementary groups. It refuses unsafe existing identities, shared groups, symlinks and special files before changing anything. Protected paths must already belong to ian; setup never changes their ownership. Permission tightening runs in a child with ian's UID/GID, opens with `O_NOFOLLOW`, verifies device/inode and ownership, and uses `fchmod` on the pinned descriptor. The remaining privileged system-path changes walk root-owned, non-writable ancestors from `/`, reject symlinks, verify device/inode after opening, and change metadata through descriptors. It makes `/home/ian`, `.cairn`, the Cairn configuration directory, the live server data tree and the stale server data tree private to ian; regular files in the data trees become `0600`, directories `0700`. `/mnt/fast/cairn` becomes `0711` (traversal without listing), and `/mnt/fast/cairn/workspaces` becomes `0700`, denying runner access to Project checkouts and their `.env` files. The server and daemon retain owner access because they run as ian. It changes metadata without replacing data files or invoking service management, killing processes or restarting the server/daemon. Existing open files and ian's access remain available. Concurrent creation of new files is protected by their private parent directory. The owner should still check application health after setup.

Linux's cross-UID ptrace access checks deny reads of ian's `/proc/<pid>/environ`, `/proc/<pid>/mem` and process file descriptors to an unprivileged runner. Setup additionally persists `kernel.yama.ptrace_scope >= 1`, preserving stricter live and stored values. This restricts same-UID attachment too, so unrelated debugger attachments may need root; normal server/daemon execution does not use ptrace. It deliberately avoids remounting `/proc` with `hidepid`, which could change process discovery for existing services. Setup refuses hosts without Yama rather than claiming protection it could not configure. The host canary must establish the actual effect.

Failure cases covered offline: omitted probe channels, subprocess output disclosure, missing tools, shell-sensitive paths, unreadable files, broad token requests, wrong installation owner, malformed/overprivileged upstream tokens, unsafe sockets, privileged account reuse, symlinks/inode swaps, foreign-owned paths, workspace access, unexpected probe errors, token mint storms, dry-run mutation, non-idempotent setup and weakened ptrace configuration. Offline fakes do not prove the host's permissions or GitHub's authorization decisions.

## Canary

Run with Node 22.19+ and `python3`, `git`, `sh`, `dd`, `wc` on PATH:

```sh
node scripts/ops/secret-reach/canary.mjs --pid "$SERVER_PID"
node scripts/ops/secret-reach/canary.mjs --profile mac
SECRET_REACH_PATHS='["/absolute/key","/absolute/database-copy"]' node scripts/ops/secret-reach/canary.mjs --pid "$SERVER_PID"
node scripts/ops/secret-reach/canary.mjs --pid "$SERVER_PID" --path /absolute/key --path /absolute/database-copy
```

`SECRET_REACH_PROFILE` and `SECRET_REACH_SERVER_PID` supply the corresponding flags. Repeated `--path` replaces both the defaults and `SECRET_REACH_PATHS`. The default Linux (`omarchy`) profile inventory is:

- `/home/ian/.cairn/cairnwright.private-key.pem`
- `/mnt/fast/cairn/server/secretbox.key`
- `/home/ian/.cairn/server.hdd-old/secretbox.key`
- `/home/ian/.config/cairn/server.env`
- `/home/ian/.cairn/token`
- `/mnt/fast/cairn/server/server.db`
- `/home/ian/.cairn/server.hdd-old/server.db`

The Mac profile substitutes the current home and `~/.cairn/server` for the live server directory. Inventory other copies with `--path`; the canary cannot discover files behind inaccessible directories. Linux process checks require an explicit, current server PID. Mac has no Linux `/proc` interface, so its profile omits those two Linux-only channels.

For every configured file it emits one JSON line for each channel: `direct`, `symlink`, `python`, `node`, `sh`, `subprocess-file`, `git-config`, `git-credential`. The two additional process lines are `proc-environ` and `proc-mem`. Every line contains only `channel`, `path`, `readable` (`yes`/`no`/`error`) and `bytes`. Ordinary file probes read at most 4096 bytes. The memory probe chooses a readable address from the process maps rather than offset zero. Bytes measure bytes actually obtained, not total file size.

Subprocesses emit counts only. For the subprocess-file round trip the child writes only a decimal count to a private temporary file, which the parent reads and deletes. Secret bytes are never persisted in that intermediate file. The shell channel opens the target with its own `sh` redirection and copies it with `dd`; a counting child receives its bytes through an anonymous pipe and checks the copy exit status, and only classifies a failed `sh` open as blocked or error. Unexpected filesystem or copy failures produce `readable: "error"` and exit `2`, rather than a successful zero-byte result. Git output stays inside the counting child; diagnostics are discarded. The config channel tries the target as a Git config; the credential channel includes it as a config and invokes configured credential helpers for `secret-reach.invalid`, with terminal prompting disabled. A non-config secret can produce zero Git output even in the owner control; the ordinary read channels must still detect it. Only run with trusted helper executables: a helper is arbitrary code and can have its own external side effects. No canary can constrain a malicious helper's independent writes.

Exit `1` means at least one channel read bytes. Exit `0` means all attempted channels obtained zero bytes. Exit `2` means incomplete configuration/tooling/probe execution and must never count as green, even if some lines say `no`. A vanished or hidden process directory produces `2`; hosts already using `hidepid` need a separately verified process probe rather than interpreting that result as green. Missing/empty file targets also yield zero, so an owner negative control and a checked inventory are mandatory before interpreting green.

## Owner setup on Linux (reference; retired omarchy host)

Before running either sudo command, verify this checkout matches the exact commit that received review. Run `git rev-parse HEAD` and compare its output with the reviewed commit ID; run `git status --porcelain` and require empty output. Stop if either check differs. Keep the checkout unchanged through setup. The script runs only the root-owned system Node at `/usr/bin/node`; a per-user Node from mise or fnm is not used. Install it first if missing (on Arch: `sudo pacman -S --needed nodejs`). Then:

```sh
sudo sh scripts/ops/secret-reach/setup-runner-user.sh --dry-run
sudo sh scripts/ops/secret-reach/setup-runner-user.sh
```

The second command is the one-time privileged setup. Every change is printed as metadata; `--dry-run` prints the proposed changes without executing them. Reruns skip satisfied changes. It also installs a root-owned canary at `/usr/local/lib/cairn-secret-reach/canary.mjs`, usable after `/home/ian` becomes private. Run actual runners from their own checkout outside `/home/ian`, with a fresh environment and private home. Do not pass ian's tokens, credentials, environment files, capabilities, sudo access or privileged sockets into them. Existing runners still running as ian are not isolated by this setup; migrate their launch configuration before claiming acceptance. Keep the server and daemon running as ian.

The protected locations default to `/mnt/fast/cairn`, `/mnt/fast/cairn/server`, `/mnt/fast/cairn/workspaces` and `/home/ian/.cairn/server.hdd-old`. For a different layout, supply `SECRET_REACH_SETUP_LOCATIONS` as a JSON object with `parent`, `server`, `workspaces` and/or `stale` absolute paths in the privileged command's environment, using the same configuration for dry-run and apply. The owner home, parent, server and workspaces directories are required; the stale copy is optional. Workspaces need only a private root directory; checkouts below it keep their existing executable and file modes.

Setup creates `/run/cairn-token-broker` owned by `ian:cairn-runner`, mode `2710`, and installs `/etc/tmpfiles.d/cairn-token-broker.conf` so systemd recreates that directory at boot. The setgid bit makes new sockets inherit the private runner group without adding ian to that group. No server/daemon unit is edited here.

## Broker protocol

Start as ian, from this checkout, with the App ID and its xiechimon installation ID (these IDs are not keys):

```sh
export CAIRN_BROKER_APP_ID=YOUR_APP_ID
export CAIRN_BROKER_INSTALLATION_ID=YOUR_INSTALLATION_ID
export CAIRN_BROKER_RUNNER_GID="$(id -g cairn-runner)"
node scripts/ops/secret-reach/broker.mjs
```

The broker reads `/home/ian/.cairn/cairnwright.private-key.pem` in its own process. It refuses root execution and unsafe socket directory metadata. It creates `/run/cairn-token-broker/broker.sock` as `0660` after verifying inherited group ownership; only ian and the private runner group can connect. The parent directory is not writable by the runner. An existing socket path is refused rather than replaced. Graceful shutdown removes the socket; after a crash the owner must confirm the old process is gone before removing its stale socket.

Send one newline-terminated JSON request per connection (maximum 4096 bytes):

```json
{"operation":"token","repository":"xiechimon/cairn","permissions":{"contents":"write","pull_requests":"write","issues":"write"}}
```

No other keys, repository or permission set is accepted. The broker verifies the installation account is `xiechimon` and sends exactly this POST body to `/app/installations/INSTALLATION_ID/access_tokens`:

```json
{"repositories":["cairn"],"permissions":{"contents":"write","pull_requests":"write","issues":"write"}}
```

Responses contain `token` and `expires_at`, or only `{"error":"request refused"}`. The broker rejects upstream permission sets wider or narrower than the fixed contract; GitHub's implicit `metadata:read` is allowed. It never logs requests, JWTs, tokens, API response bodies or key contents. Concurrent requests share one mint, and repeated requests reuse its token until five minutes before expiry. New mint attempts, including failed attempts, are limited to one per 60 seconds; requests inside that interval without a reusable token are refused. Clients must keep tokens in memory, avoid command-line arguments/tracing, and renew before expiry. These permissions do not include administration, actions, secrets or workflows. The residual `contents:write` access still allows ordinary repository writes and some merge operations: branch protection and the existing merge gate must enforce merge policy, and the App must not be a bypass actor. This broker is not a merge authorization service.

## Post-setup acceptance (owner only; not executed by tests)

Save metadata-only logs under `docs/verify/2189/`. First record the current server PID using the actual service manager, confirm it belongs to ian, and confirm each intended secret exists and is nonempty as ian. Do not dump environment files or process environments. Record server/daemon health before and after setup without their credentials.

```sh
mkdir -p docs/verify/2189
node /usr/local/lib/cairn-secret-reach/canary.mjs --pid "$SERVER_PID" > docs/verify/2189/ian.jsonl
printf 'owner exit=%s\n' "$?"
sudo -u cairn-runner -H env -i HOME=/var/lib/cairn-runner PATH=/usr/bin:/bin /usr/bin/node /usr/local/lib/cairn-secret-reach/canary.mjs --pid "$SERVER_PID" > docs/verify/2189/runner.jsonl
printf 'runner exit=%s\n' "$?"
```

Expected: owner exit `1`, with every existing secret red on ordinary file channels; runner exit `0`, every channel `no`, every byte count zero. Yama can block an unrelated owner memory attachment too; that is not evidence of runner isolation, and must be recorded separately. Any `2`, omitted PID, missing inventory item or unavailable tool invalidates the run. Also check `id cairn-runner` and the owner's `sudo -l -U cairn-runner` output to ensure no host-specific privilege grant defeats the dedicated UID. Do not publish unrelated host policy details in the public repository.

With the broker running, execute the following as the runner from a readable checkout. Choose an existing private repository owned by xiechimon which the App could otherwise access, and verify its existence separately as the owner. A public repository's readable metadata is not a valid isolation test. The deliberately invalid protection body cannot modify protection even if permission checks regress. Only the expected authorization refusals pass; `422` is a failure to establish this acceptance check.

```sh
export CAIRN_SCOPE_PROBE_REPOSITORY=xiechimon/PRIVATE_SCOPE_FIXTURE
node --input-type=module <<'NODE'
import assert from 'node:assert/strict';
import { connect } from 'node:net';
const other = process.env.CAIRN_SCOPE_PROBE_REPOSITORY;
assert.match(other, /^xiechimon\/[A-Za-z0-9_.-]+$/);
assert.notEqual(other, 'xiechimon/cairn');
const response = await new Promise((resolve, reject) => {
  const socket = connect('/run/cairn-token-broker/broker.sock');
  let text = '';
  socket.on('connect', () => socket.write(JSON.stringify({ operation: 'token', repository: 'xiechimon/cairn', permissions: { contents: 'write', pull_requests: 'write', issues: 'write' } }) + '\n'));
  socket.on('data', chunk => { text += chunk; });
  socket.on('error', reject);
  socket.on('end', () => resolve(JSON.parse(text)));
});
assert.equal(typeof response.token, 'string');
const headers = { authorization: `Bearer ${response.token}`, accept: 'application/vnd.github+json', 'content-type': 'application/json', 'x-github-api-version': '2022-11-28' };
const protection = await fetch('https://api.github.com/repos/xiechimon/cairn/branches/main/protection', { method: 'PUT', headers, body: '{}', redirect: 'error' });
console.log(`branch-protection status=${protection.status}`);
assert.equal(protection.status, 403);
const outside = await fetch(`https://api.github.com/repos/${other}`, { headers, redirect: 'error' });
console.log(`other-repository status=${outside.status}`);
assert.ok([403, 404].includes(outside.status));
NODE
```

Keep only the two status lines and their exit status as evidence; never log the token response. Real token authorization and host UID checks remain unverified until these commands run.

## Mac batch-session sandbox (#2344)

`scripts/ops/secret-reach/batch-sandbox.settings.json` is a standalone Claude Code settings file for **batch** `claude -p` runs on the owner's Mac. Launch batch sessions with:

```sh
CAIRN_HEAVY_SLOTS_DIR="$HOME/.cache/cairn-heavy-slots" \
  claude -p '<prompt>' --settings scripts/ops/secret-reach/batch-sandbox.settings.json
```

It enables the Seatbelt sandbox with `failIfUnavailable: true` and `allowUnsandboxedCommands: false` (the `dangerouslyDisableSandbox` retry is refused), denies reads of the cairn secret roots (`~/.cairn`, `~/.config`, `~/Library/Application Support/@cairn`, `~/.local/share/cairn`), the standard credential stores, package-manager token files, shell and REPL histories and `~/Library/pnpm/rc` (the npm token), and re-opens only the runner workspaces, `~/.cairn/{workspaces,plans,tools}` and `~/.config/git` through narrower `allowRead` entries. `permissions.deny` `Read(...)` rules cover the same secrets for the file tools, which run outside the sandbox — a `Read` deny also blocks Write on the same path — and `Edit(...)` rules deny the file tools writes an unsandboxed process would later trust (`**/.claude/**`, `**/CLAUDE*.md`, `**/AGENTS*.md`, `**/.git`, `~/.cache/lane-tmp`). `scripts/ops/secret-reach/batch-sandbox.test.mjs` pins the required shape.

The repository's `.claude/settings.json` deliberately carries no `sandbox` block: project settings apply to every interactive session, and the sandbox would block everyday development (git over the local proxy port, `gh` credentials, Keychain reads).

Inside the sandbox a batch session cannot push or use `gh` (its credentials are denied and the proxy port is unreachable); PR creation, `push` and `push-queue` are the outer launcher script's job, outside the sandbox. It can still run tests, with two caveats:

- The sandbox profile writes `TMPDIR=/tmp/claude` and allows writes only under the launch cwd, `/tmp/claude`, `~/.cache`, the package caches and `~/.cairn/plans`. The shared heavy-slot directory (`getconf DARWIN_USER_TEMP_DIR` on macOS) is *not* writable, so the launcher must point `CAIRN_HEAVY_SLOTS_DIR` at a writable dir — `~/.cache/cairn-heavy-slots` is already covered by `allowWrite`. `scripts/heavy-slots.mjs` keeps its liveness probe socket inside that directory, so no further path needs opening.
- A private slot directory is a private lease: the batch session's heavy work no longer counts against the shared lane slots. That directory's capacity still comes from the machine's cores (`max(1, floor(cores/4))`), so a 4-core runner keeps the bypass at one heavy job.

Lane sessions (daemon `claude-code` runtime) are out of scope here; their isolation is tracked separately.

Host acceptance on the owner Mac, from a cairn checkout — every channel must report `no` with 0 bytes (exit 0):

```sh
claude -p 'run `node scripts/ops/secret-reach/canary.mjs --profile mac \
    --path ~/.config/cairn/slack-app.env --path ~/.config/cairn/composio.env \
    --path ~/.config/cairn/telegram.env \
    --path "$HOME/Library/Application Support/@cairn/desktop/otel.env"` and paste its output' \
  --settings scripts/ops/secret-reach/batch-sandbox.settings.json
```

The red control is the same canary run as the owner without a sandbox (exit 1, every ordinary channel `yes`) — there is no in-band way to disable the sandbox: `--settings '{"sandbox":{"enabled":false}}'` does not override `sandbox.enabled` from a `--settings` file, so do not use it as a control. The default `--profile mac` inventory alone proves nothing: every default path is absent on this Mac, so an all-`no` run is expected without any sandbox. Use the four real files above. Evidence and residuals: `docs/verify/2344/`.

## Offline regression command

```sh
node --test scripts/ops/secret-reach/canary.test.mjs scripts/ops/secret-reach/broker.test.mjs scripts/ops/secret-reach/setup-runner-user.test.mjs scripts/ops/secret-reach/batch-sandbox.test.mjs
```

Tests use built-ins, temporary fixture files, a generated RSA key, a loopback fake GitHub API, a real temporary Unix socket, an in-memory setup host, real owner-UID permission children, and a fake clock for mint reuse/rate limits. They never read the real App key, run sudo or call GitHub. CI runs the same command next to the other ops fixtures.
