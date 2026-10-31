# Orb transport verification (#2275)

## Status and plan

This flow supersedes the earlier per-step bind and guest-execution transport. The daemon now dispatches one step through an authenticated Unix socket to a worker started by the image. The host prepares fixed bind contents before starting a machine. Local socket, Git delivery, watchdog and compiled-worker checks are repeatable offline. Native nspawn acceptance remains a separate check after the image and installer PR is installed.

The implementation sequence was: list failure modes, reproduce them with failing tests, replace guest execution with lifecycle commands, migrate the guest fakes, and run the repository gates. The existing host journal, backend seam and dependency set remain the verification boundaries. No dependency installation, lockfile change, push or PR is part of this delivery.

## Host flow

1. `ensure` clones `cairn-orb-base` into a bounded `cairn-orb-*` name once per Thread; it does not start the machine.
2. `prepare` creates `/run/cairn-orb/<machine>` owned by the daemon user with mode 0700. It copies the daemon dist to a temporary release below `/var/lib/cairn-orb/dist`, then atomically publishes a relative `current` symlink. Identical contents reuse an immutable version; hashing streams file contents rather than buffering entire Git packfiles. The stable `cli.mjs` symlink points to `current/cli.mjs`.
3. A Project seed is a bare, single-branch, tag-free snapshot made with `--no-local`. Host configuration, hooks, untracked files and unrelated branch objects are excluded. It is prepared in a temporary directory and published atomically at `/var/lib/cairn-orb/seed/<projectId>/repo` through relative symlinks. Failed preparation keeps the last complete publication. Published versions remain available to readers until operator maintenance removes obsolete versions while machines are stopped.
4. The host creates `relay.sock` and a fresh `relay.sock.token` in the per-machine directory, both mode 0600. Local Project steps also get an empty 0700 `outbox` there. The relay listens before `machinectl start`; an already-running machine is confirmed with `machinectl list` and reused.
5. The image's worker connects, authenticates, receives its bound step, and reports heartbeat/tool/checkpoint/done traffic. The host waits for worker finish or disconnect, rather than a guest process launched by the host. Coordinator steps continue to run on the host.
6. The host closes the relay, awaits in-flight delivery/completion, removes the socket, token and step outbox, and releases capacity. It retains the per-machine directory because the running container binds its inode. A later step creates a fresh listener and secret at the same paths. An accepted `done` releases the host run without waiting for service exit; the compiled worker process is separately required to exit 0.

`NspawnOrbProvider` accepts `runtimeRoot`, `distRoot`, `seedRoot`, `distSource`, `stateFile` and `shutdownTimeoutMs` overrides for isolated tests. Production roots are the paths above. The provider executes only `machinectl clone`, `start`, `poweroff`, `terminate`, `remove` and `list`. `terminate` is reserved for a poweroff deadline. It never invokes guest execution, runtime binds, a privileged helper or a polkit change.

## Exact image and installer contract

The separate image/installer PR must provide these fixed mounts at machine start, without replacing their host directory inodes:

| Host source | Guest destination | Access |
| --- | --- | --- |
| `/run/cairn-orb/%i` | `/run/cairn` | Read/write; only that machine's directory |
| `/var/lib/cairn-orb/dist` | `/opt/cairn/daemon` | Read-only |
| `/var/lib/cairn-orb/seed` | `/seed` | Read-only |

`%i` must expand to the full machine name, including `cairn-orb-`. The installer owns `/run/cairn-orb` and `/var/lib/cairn-orb/{dist,seed}` as the daemon user and recreates the runtime root with tmpfiles after reboot. Dist and seed directories must be traversable/readable by `agent` through their read-only mounts. The runtime bind must map the host daemon UID to the guest `agent` UID, including ownership of newly created files, so that 0700 directories and 0600 sockets/token files remain accessible. An idmapped bind is suitable; widening the modes or granting the dedicated host runner user access is not.

The image ships and enables `cairn-orb-worker.service` with `User=agent`, `Restart=always`, a nonzero restart delay, `After=local-fs.target`, and `Environment=CAIRN_ORB=1`. Its exact command is:

```text
node /opt/cairn/daemon/cli.mjs orb-step --socket /run/cairn/relay.sock
```

The actual daemon build output is `dist/cli.mjs`, not `dist/cli.js`. The image must provide a compatible Node runtime and the daemon's external runtime packages in a Node-resolvable ancestor such as `/opt/cairn/node_modules`; the daemon bind covers `/opt/cairn/daemon`. Worker state defaults to `/home/agent/.cairn`, workspaces to `/work`, seeds to `/seed/<projectId>/repo`, and bundle output to `/run/cairn/outbox`. State and workspaces must be writable by `agent` and persist across worker process restarts. The image must supply Git, backend executables and the egress relay required by those backends. `CAIRN_ORB_PROXY_URL` on the host is carried in relay initialization as HTTP/HTTPS proxy settings for both worker HTTP traffic and agent commands.

`orb-step` waits for both socket and token to appear before dialing. Each invocation handles exactly one connection and one step, closes its connection, and returns normally (exit 0) after a reported success, failure or stop. The service restarts it for the next connection. A stale socket, rejected authentication or pre-step connection failure can exit nonzero; systemd retries with its restart delay. A connected worker never reconnects to reclaim or replay a step. If its host connection disappears it stops the active backend; the host owns recovery. The host does not depend on the worker service exit code.

The image also owns `cairn-orb-check.service`: host probes must use a request/result file or socket under the same per-machine `/run/cairn` bind. The host checker must never enter guest namespaces. Its probe details belong to the image/installer PR.

## Relay authentication and isolation

The host generates 32 random bytes per step and writes their 64 lowercase hexadecimal characters, without a newline, to `/run/cairn-orb/<machine>/relay.sock.token`. The intended guest reads `/run/cairn/relay.sock.token`. Every wire frame is newline-delimited JSON prefixed by `cairn-orb-rpc:`. The mandatory first frame is:

```text
cairn-orb-rpc:{"type":"auth","token":"<64 lowercase hexadecimal characters>"}
```

The host compares the token in constant time, sends `{"type":"authenticated"}` with the same prefix, and only then sends `init` or accepts calls. Missing, malformed, stale or foreign secrets close the connection before any claim or credential is disclosed or upstream method is called. Unauthenticated connections have a 1 KiB frame budget and a five-second deadline; they do not reserve the single worker slot or refresh the heartbeat watchdog. Exactly one authenticated connection is permitted for each step listener's lifetime.

Isolation requires both the filesystem contract and authentication. Other host users cannot traverse the 0700 machine directory or open the 0600 socket/token. Other containers only see their own runtime bind and secret. The private host runtime parent must never be mounted into a guest. A foreign connection with another machine's valid-format secret is rejected even if it obtains a socket descriptor. Root, the daemon user and code running as the intended guest `agent` remain trusted for that step; this does not isolate credentials from same-UID agent code. The machine credential stays on the host; credentials returned by step RPC retain their existing server-side scope.

The existing method allowlist, step binding, upload URL binding, checkpoint bounds, rate-limit controls, 16 MiB frame/output limits and one-completion guard remain enforced after authentication.

## Failure and cancellation behavior

An authenticated worker disconnecting without an accepted or attempted `done` causes one host `done(failed)` with `Orb worker disconnected without done`. There is no fabricated guest exit code. A checkpoint alone cannot establish completion. An attempted but rejected completion remains journaled and is replayed with its artifacts. An accepted or in-flight completion is awaited without a duplicate host failure. Unreachable host reporting remains journaled for restart recovery.

The host's 120-second watchdog starts before machine start. Validated relay API activity refreshes it before upstream forwarding, including heartbeats and finish-up uploads. Silence, including a worker that never connects, closes the relay and reports `orb heartbeat timeout`. Stop first sends the existing stop frame; after five seconds without completion the host closes the relay and reports `Orb worker did not finish after stop`. Both paths power off the machine, poll `machinectl list`, and use `machinectl terminate` after the shutdown deadline. Capacity is not released before shutdown settles. Cancellation during a pending start also powers the machine off once start returns.

Local Project delivery retains the bundle outbox protocol: the worker writes a bundle into `/run/cairn/outbox` and sends only its bounded filename. The host verifies its file type, link count, size, Git validity and single claimed Thread ref before delivery. The host awaits delivery before removing the outbox. GitHub Project delivery continues to use the existing push path.

## Proof

The initial transport regressions failed three cases against the old implementation: eager start, missing authentication, and foreign authentication. Additional regressions reproduced incomplete-build publication, duplicate release storage and cancellation during machine start before their fixes. The proxy regression failed before explicitly applying relayed proxy configuration to the worker HTTP dispatcher. Further failing regressions cover accepted completion without service exit, an externally powered-off cached machine, and two pending starts exceeding the configured machine cap. The lifecycle counts pending starts as capacity reservations.

Runtime evidence uses real Unix sockets, real local Git repositories, deterministic fake upstream APIs/backends and a fake lifecycle runner that rejects `systemd-run -M`, `--machine`, and `machinectl bind/shell/login`. The compiled-worker process probe runs pi against a local stub LLM, executes a shell tool and setup/resume hooks, and completes two steps. It validates daemon/worker protocol behavior without launching nspawn.

Measured local checks use Node 24.14.0 on the branch based on `origin/main`; no native container is launched.

| Command | Result |
| --- | --- |
| `pnpm lint` | PASS; 1,422 files, one pre-existing informational suggestion |
| `pnpm typecheck` | PASS; five workspace packages |
| `pnpm spec:parse` | PASS; 1,421 web tests in 207 files and 67 integration test files parse |
| `pnpm exec vitest run apps/daemon/test/orb-{transport,provider,relay,step,runner,delivery,watchdog,worker-process,seed,workspace}.test.ts apps/daemon/test/proxy.test.ts --maxWorkers=1` | PASS; 191 tests in 11 files, including compiled-worker exit status 0 |
| `pnpm exec vitest run --changed --project @xiechimon/cairn-cli --maxWorkers=1` | PASS; 816 tests in 70 files |
| `pnpm --filter @cairn/web e2e:affected` | PASS; no web e2e surface selected |
| `pnpm prepush` | PASS; all 20 checks |

## Review

A fresh Claude Sonnet 5.5 security/behavior review was attempted using `/security-review` in a read-only CLI session. The CLI reported `unrecognized_model` for the required `claude-sonnet-5-5` and produced no review verdict. The session was stopped without changing models. Independent review remains incomplete and must precede a PR. No PR or push is requested. Native permissions and image installation are outside the local fake boundary.

## Risk

transport decided by ian 2026-10-31 (option 1)

Native nspawn UID mapping, actual host-user denial, image packages, service restart behavior, real machine poweroff/terminate and Linux Git ownership behavior remain unverified by the macOS tests. They require the separate image/installer PR and an installed host. The native acceptance must run as the unprivileged owner, complete two steps in one machine, deliver a local commit, reject the dedicated host runner user and a foreign container, and exercise worker death and watchdog shutdown. No host installation or polkit widening is included here. Published immutable versions require maintenance while machines are stopped; no eventual-progress claim is made during a continuing upstream outage.
