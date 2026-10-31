# Orb transport verification (#2275)

## Status and plan

This flow supersedes the earlier per-step bind and guest-execution transport. The daemon now dispatches one step through an authenticated Unix socket to a worker started by the image. The host publishes build and seed contents before starting a machine, then waits for its root-created runtime directory before listening. Local socket, Git delivery, watchdog and compiled-worker checks are repeatable offline. Native nspawn acceptance remains a separate check after the image and installer PR is installed.

The alignment is implemented and its 210 related tests pass under Node 24.14.0. Native acceptance is the next verification step once the separate image and installer are installed; no owner action is needed for this local delivery.

The implementation sequence was: list failure modes, reproduce them with failing tests, replace guest execution with lifecycle commands, migrate the guest fakes, and run the repository gates. The existing host journal, backend seam and dependency set remain the verification boundaries. No dependency installation, lockfile change, push or PR is part of this delivery.

## Alignment failure modes and acceptance

- The daemon creates or repairs a runtime mount source before the root start hook, allowing its inode to be swapped. Acceptance: preparation leaves the path absent, machine start sees no socket or token, and dispatch waits for the hook's directory.
- A missing runtime directory waits forever, or a symlink, regular file, foreign owner or mode other than 0700 receives a secret. Acceptance: bounded waiting (30 seconds by default, configurable), lstat validation, a specific failure reason and machine shutdown, including reuse of a running machine.
- Cancellation while waiting leaves a machine running. Acceptance: abort interrupts the wait and shutdown completes before the start operation rejects.
- Missing, non-directory or foreign-owned installer publication roots are silently created or repaired. Acceptance: both roots are required before publication; valid roots retain their modes and immutable publishing behavior.
- A previous fake worker consumes the next step listener during late cleanup. Acceptance: cleanup is bound to its original token, and a delayed previous worker cannot disconnect a new listener.
- The image's dependencies drift from the bound daemon build. Acceptance: document the exact package, version source, install flags and entry command, plus any limit on detecting drift without guest execution.

Measured from the current provider and dispatch source: the filesystem and lifecycle boundaries are injectable and covered by offline socket tests. The alignment needs no new dependencies, external services or owner action. Native nspawn acceptance still depends on the separate installed image and Linux host.

## Host flow

1. `ensure` clones `cairn-orb-base` into a bounded `cairn-orb-*` name once per Thread; it does not start the machine.
2. `prepare` requires `/var/lib/cairn-orb/{dist,seed}` to already be real directories owned by the daemon user. It never creates or changes their modes. It copies the daemon dist to a temporary release below `/var/lib/cairn-orb/dist`, then atomically publishes a relative `current` symlink. Identical contents reuse an immutable version; hashing streams file contents rather than buffering entire Git packfiles. The stable `cli.mjs` symlink points to `current/cli.mjs`.
3. A Project seed is a bare, single-branch, tag-free snapshot made with `--no-local`. Host configuration, hooks, untracked files and unrelated branch objects are excluded. It is prepared in a temporary directory and published atomically at `/var/lib/cairn-orb/seed/<projectId>/repo` through relative symlinks. Failed preparation keeps the last complete publication. Published versions remain available to readers until operator maintenance removes obsolete versions while machines are stopped.
4. The host calls `machinectl start`, or confirms an already-running machine with `machinectl list`. A root `ExecStartPre` hook creates `/run/cairn-orb/<machine>` on every container start, owned by the daemon UID with mode 0700. The daemon never creates that directory. It waits up to 30 seconds by default (`runtimeDirectoryTimeoutMs` is configurable), using `lstat` to reject symlinks, non-directories, foreign ownership and modes other than 0700. These metadata checks validate the startup contract; ownership under this directory is guest-controlled and does not establish trust. A missing directory times out; failed validation or cancellation powers the machine off before dispatch fails. Only after validation does the host create and listen on `relay.sock` and exclusively create a fresh `relay.sock.token`, both mode 0600. Existing paths, including stale sockets and dangling symlinks, are refused. Local Project steps also get an empty 0700 `outbox` through an exclusive, non-recursive mkdir; any existing entry is refused and retained.
5. The image's worker connects, authenticates, receives its bound step, and reports heartbeat/tool/checkpoint/done traffic. The host waits for worker finish or disconnect, rather than a guest process launched by the host. Coordinator steps continue to run on the host.
6. The host closes the relay, awaits in-flight delivery/completion, removes the socket, token and step outbox, and releases capacity. It retains the per-machine directory because the running container binds its inode. A later step revalidates the directory and creates a fresh listener and secret at the same paths. The root lifecycle hook removes the directory on machine stop. An accepted `done` releases the host run without waiting for service exit; the compiled worker process is separately required to exit 0.

`NspawnOrbProvider` accepts `runtimeRoot`, `distRoot`, `seedRoot`, `distSource`, `stateFile`, `runtimeDirectoryTimeoutMs` and `shutdownTimeoutMs` overrides for isolated tests. Production roots are the paths above. The provider executes only `machinectl clone`, `start`, `poweroff`, `terminate`, `remove` and `list`. `terminate` is reserved for a poweroff deadline. It never invokes guest execution, runtime binds, a privileged helper or a polkit change.

## Exact image and installer contract

The separate image/installer PR must provide these fixed mounts at machine start, without replacing their host directory inodes:

| Host source | Guest destination | Access |
| --- | --- | --- |
| `/run/cairn-orb/%i` | `/run/cairn` | Read/write; only that machine's directory |
| `/var/lib/cairn-orb/dist` | `/opt/cairn/daemon` | Read-only |
| `/var/lib/cairn-orb/seed` | `/seed` | Read-only |

`%i` must expand to the full machine name, including `cairn-orb-`. The installer creates `/run/cairn-orb` as root-owned mode 0755 and recreates that parent after reboot. Root lifecycle hooks create the per-machine directory at each start and remove it on stop; the daemon user cannot replace its mount-source inode in the root-owned parent. The installer also creates `/var/lib/cairn-orb/{dist,seed}` as daemon-owned directories inside a root-owned parent; the daemon requires them to exist. Dist and seed directories must be traversable/readable by `agent` through their read-only mounts. The runtime bind must map the host daemon UID to the guest `agent` UID, including ownership of newly created files, so that 0700 directories and 0600 sockets/token files remain accessible. An idmapped bind is suitable; widening the modes or granting the dedicated host runner user access is not.

The image ships and enables `cairn-orb-worker.service` with `User=agent`, `Restart=always`, a nonzero restart delay, `After=local-fs.target`, and `Environment=CAIRN_ORB=1`. Its exact command is:

```text
/usr/bin/node /opt/cairn/daemon/cli.mjs orb-step --socket /run/cairn/relay.sock
```

The daemon build output is `dist/cli.mjs`. The image provides a compatible Node runtime at `/usr/bin/node` and installs the published daemon package `@xiechimon/cairn-cli` at the host daemon's exact version. The host version is read from the running daemon's own `package.json` `version` field (`apps/daemon/src/version.ts` exports this as `DAEMON_VERSION` using `../package.json`), never from a global npm lookup or the latest registry version. Pass that value into image preparation as `HOST_DAEMON_VERSION`:

```sh
npm install --prefix /opt/cairn --omit=dev --ignore-scripts "@xiechimon/cairn-cli@${HOST_DAEMON_VERSION}"
```

This installs runtime dependencies into `/opt/cairn/node_modules`. Imports from the build bound at `/opt/cairn/daemon` resolve upward into that directory. The package inside the image records its installed version at `/opt/cairn/node_modules/@xiechimon/cairn-cli/package.json`.

Measured from the current provider interface: lifecycle operations expose machine names and running state, with no host-readable image package-version record. The guest's package manifest cannot be read through the fixed host binds, so dispatch cannot currently detect or refuse an image/host version mismatch without guest execution. Drift remains a risk after a host daemon upgrade. Image preparation and native acceptance must compare that recorded package version with the host daemon's own version and reject a mismatch before enabling dispatch. If the image installer later exposes an authoritative host-readable version record, add a pre-dispatch mismatch refusal test against that record; do not introduce guest execution to inspect it.

Worker state defaults to `/home/agent/.cairn`, workspaces to `/work`, seeds to `/seed/<projectId>/repo`, and bundle output to `/run/cairn/outbox`. State and workspaces must be writable by `agent` and persist across worker process restarts. The image must supply Git, backend executables and the egress relay required by those backends. `CAIRN_ORB_PROXY_URL` on the host is carried in relay initialization as HTTP/HTTPS proxy settings for both worker HTTP traffic and agent commands.

`orb-step` waits for both socket and token to appear before dialing. Each invocation handles exactly one connection and one step, closes its connection, and returns normally (exit 0) after a reported success, failure or stop. The service restarts it for the next connection. A stale socket, rejected authentication or pre-step connection failure can exit nonzero; systemd retries with its restart delay. A connected worker never reconnects to reclaim or replay a step. If its host connection disappears it stops the active backend; the host owns recovery. The host does not depend on the worker service exit code.

The image also owns `cairn-orb-check.service`: host probes must use a request/result file or socket under the same per-machine `/run/cairn` bind. The host checker must never enter guest namespaces. Its probe details belong to the image/installer PR.

## Relay authentication and isolation

The host generates 32 random bytes per step and writes their 64 lowercase hexadecimal characters, without a newline, to `/run/cairn-orb/<machine>/relay.sock.token`. The intended guest reads `/run/cairn/relay.sock.token`. Every wire frame is newline-delimited JSON prefixed by `cairn-orb-rpc:`. The mandatory first frame is:

```text
cairn-orb-rpc:{"type":"auth","token":"<64 lowercase hexadecimal characters>"}
```

The host compares the token in constant time, sends `{"type":"authenticated"}` with the same prefix, and only then sends `init` or accepts calls. Missing, malformed, stale or foreign secrets close the connection before any claim or credential is disclosed or upstream method is called. Unauthenticated connections have a 1 KiB frame budget and a five-second deadline; they do not reserve the single worker slot or refresh the heartbeat watchdog. Exactly one authenticated connection is permitted for each step listener's lifetime.

Isolation requires both the filesystem contract and authentication. Everything under `/run/cairn-orb/<machine>` is guest-controlled: the idmapped guest `agent` maps to the daemon UID, so ownership is not a trust signal. A compromised guest can chmod its own runtime directory and let other host users reach the socket. The fresh per-step token is the authentication boundary against those users; directory permissions alone cannot provide that boundary. The token starts at mode 0600 and remains scoped to one step, but the intended guest can disclose it or change its permissions, so authentication cannot protect that step from its own compromised guest. Other containers only see their own runtime bind and secret. The root-owned host runtime parent must never be mounted into a guest. A foreign connection with another machine's valid-format secret is rejected even if it obtains a socket descriptor. Root and the daemon user remain trusted. The machine credential stays on the host; credentials returned by step RPC retain their existing server-side scope.

The existing method allowlist, step binding, upload URL binding, checkpoint bounds, rate-limit controls, 16 MiB frame/output limits and one-completion guard remain enforced after authentication.

## Failure and cancellation behavior

An authenticated worker disconnecting without an accepted or attempted `done` causes one host `done(failed)` with `Orb worker disconnected without done`. There is no fabricated guest exit code. A checkpoint alone cannot establish completion. An attempted but rejected completion remains journaled and is replayed with its artifacts. An accepted or in-flight completion is awaited without a duplicate host failure. Unreachable host reporting remains journaled for restart recovery.

The host's 120-second watchdog starts before machine start. Validated relay API activity refreshes it before upstream forwarding, including heartbeats and finish-up uploads. Silence, including a worker that never connects, closes the relay and reports `orb heartbeat timeout`. Stop first sends the existing stop frame; after five seconds without completion the host closes the relay and reports `Orb worker did not finish after stop`. Both paths power off the machine, poll `machinectl list`, and use `machinectl terminate` after the shutdown deadline. Capacity is not released before shutdown settles. Cancellation during a pending start also powers the machine off once start returns.

Local Project delivery retains the bundle outbox protocol: the worker writes a bundle into `/run/cairn/outbox` and sends only its bounded filename. Host runtime-file reads use `lstat`, `O_NOFOLLOW`, descriptor identity checks, a single-link regular-file requirement and bounded reads; FIFOs are refused without blocking. On Linux, reads resolve relative to an opened directory through `/proc/self/fd`, pinning the directory against guest replacement. The macOS test path checks parent identity before reading; it does not establish Linux namespace or concurrent-replacement behavior. The host copies bundle bytes into a private temporary directory before verifying Git validity and the single claimed Thread ref. The host awaits delivery before removing the outbox. GitHub Project delivery continues to use the existing push path.

## Proof

The alignment regressions first failed 13 cases against HEAD `3f192d7e7`, covering startup ordering, runtime validation/waiting and installer roots; three further cases rejected invalid timeout configuration before implementation. A deterministic fake-worker cleanup regression also failed before token binding fixed cross-step listener reuse. The initial transport regressions failed three cases against the old implementation: eager start, missing authentication, and foreign authentication. Additional regressions reproduced incomplete-build publication, duplicate release storage and cancellation during machine start before their fixes. The proxy regression failed before explicitly applying relayed proxy configuration to the worker HTTP dispatcher. Further failing regressions cover accepted completion without service exit, an externally powered-off cached machine, and two pending starts exceeding the configured machine cap. The lifecycle counts pending starts as capacity reservations.

Alignment acceptance is covered by these named tests in `apps/daemon/test/orb-transport.test.ts` and `orb-runner.test.ts`:

| Test | Acceptance |
| --- | --- |
| `publishes releases without creating the runtime directory and reuses a running machine` | No daemon-created runtime source; valid running-machine reuse |
| `machine start precedes the relay socket and token publication` | Lifecycle order through real step dispatch |
| `waits for the root start hook before accepting the runtime directory` | Delayed hook directory creation |
| `refuses a runtime directory with invalid %s and powers off its machine` | Symlink, file, foreign UID and mode refusal; UID comparison uses a mocked daemon UID with real lstat results |
| `a missing runtime directory times out cleanly and powers off the machine` | Configured deadline and shutdown |
| `the default runtime directory deadline is thirty seconds` | Default deadline with a controlled clock |
| `cancelling the runtime directory wait powers off the machine` | Abort and awaited shutdown |
| `revalidates the runtime directory of an already running machine` | Running-machine validation failure |
| `requires the installer %s root without creating or repairing it` | Missing, file, symlink and foreign-owned dist/seed roots; preserve valid root modes |
| `relay never creates a missing runtime directory` | Listener cannot create its mount source |
| `runtime directory %s failure reports the reason through the host step and powers off` | Missing/mode failure reaches host completion and powers off |
| `a previous fake worker cannot disconnect the next step listener` | Delayed fake cleanup cannot claim a later token |
| `rejects an unbounded or negative runtime directory timeout %s` | Invalid configuration cannot remove the deadline |

Runtime evidence uses real Unix sockets, real local Git repositories, deterministic fake upstream APIs/backends and a fake lifecycle runner that rejects `systemd-run -M`, `--machine`, and `machinectl bind/shell/login`. The compiled-worker process probe runs pi against a local stub LLM, executes a shell tool and setup/resume hooks, and completes two steps. It validates daemon/worker protocol behavior without launching nspawn.

Measured local checks use Node 24.14.0 on the branch based on `origin/main`; no native container is launched.

| Command | Result |
| --- | --- |
| `pnpm lint` | PASS; 1,422 files, one pre-existing informational suggestion |
| `pnpm typecheck` | PASS; five workspace packages |
| `pnpm spec:parse` | PASS; 1,421 web tests in 207 files and 67 integration test files parse |
| `pnpm exec vitest run apps/daemon/test/orb-{transport,provider,relay,step,runner,delivery,watchdog,worker-process,seed,workspace}.test.ts apps/daemon/test/proxy.test.ts --maxWorkers=1` | PASS; 210 tests in 11 files, including compiled-worker exit status 0 |
| `pnpm exec vitest run --changed --project @xiechimon/cairn-cli --maxWorkers=1` | PASS; 330 tests in 24 files |
| `pnpm --filter @cairn/web e2e:affected` | PASS; no web e2e surface selected |
| `pnpm prepush` | PASS; all 20 checks |

## Guest-controlled runtime hardening

The hardening tests first reproduced unsafe outbox replacement, reading through a replaced outbox, dangling socket symlink handling, token symlink handling and cleanup, unsafe token reads, FIFO blocking and stale-socket replacement against `9d6842fce`. Bundle symlink, FIFO and hardlink cases retain the existing refusal behavior and now check that the outside target's contents and metadata remain unchanged. A further failing test caught token mode 0000 under a restrictive process umask before descriptor-based permission setting restored mode 0600.

Measured on macOS with Node 24.14.0: the related Vitest command above passes 224 tests across 11 files, including the compiled-worker process probe. The daemon `--changed` command above passes 344 tests across 24 files. The added publication race test plants a token symlink after path preflight and confirms `O_EXCL` refuses it without overwriting the target or removing the planted link during cleanup. Tests also cover pre-existing outbox files/directories, dangling symlinks and restrictive umask restoration. `pnpm lint` passes across 1,423 files with one pre-existing informational suggestion; `pnpm typecheck` passes across five packages; `pnpm spec:parse` collects 1,421 web tests in 207 files and parses 67 integration files. The affected-e2e command selects no web tests.

Runtime evidence is recorded in `/tmp/b2-orb-hardening-{related,changed,lint,typecheck,spec,e2e}.log`. The filesystem, Git and Unix socket operations are real; lifecycle commands, upstream APIs and model responses remain fake. Linux `/proc/self/fd` pinning, nspawn idmapping and actual cross-user denial remain unverified locally: this host runs macOS and its Docker daemon is unavailable. Native acceptance still requires the installed Linux image and host contract.

## Review

The earlier transport pass attempted a fresh Claude Sonnet 5.5 security/behavior review using `/security-review` in a read-only CLI session. The CLI reported `unrecognized_model` for the required `claude-sonnet-5-5` and produced no review verdict. The session was stopped without changing models. Independent review remains incomplete and must precede a PR. No PR or push is requested. Native permissions and image installation are outside the local fake boundary.

## Risk

transport decided by ian 2026-10-31 (option 1)

Native nspawn UID mapping, actual host-user denial, image packages, service restart behavior, real machine poweroff/terminate and Linux Git ownership behavior remain unverified by the macOS tests. They require the separate image/installer PR and an installed host. The native acceptance must run as the unprivileged owner, complete two steps in one machine, deliver a local commit, reject the dedicated host runner user and a foreign container, and exercise worker death and watchdog shutdown. No host installation or polkit widening is included here. Published immutable versions require maintenance while machines are stopped; no eventual-progress claim is made during a continuing upstream outage.
