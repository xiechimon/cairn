# Orb on a container runtime (D69 item 3)

Status: design, 2026-11-04. Decided by ian (D69 item 3): redo the Orb on a swappable container runtime with Amp's dispatch contract. This doc grounds the design in the current code, the runtimes' docs and the host. No code is changed here.

Evidence labels: **measured** = run or read in this session on omarchy or in the repo; **read** = taken from the cited page; **inferred** = follows from measured or read facts; **guess** = everything else, each one has a spike in section 7.

## 1. Summary and recommendation

**Recommendation: rootless Podman on omarchy (CLI adapter, crun, pasta), images from one Dockerfile, egress through a unix socket to the existing filtering relay with `--network none`. Docker and Apple `container` are further adapters behind the same `OrbRuntime` interface.**

Why Podman first:

- It needs no host privilege at run time. omarchy already has `newuidmap` (measured), subuid/subgid 100000:65536 (given), user-slice cgroup v2 with `cpu memory pids` delegated (measured), `Linger=yes` (measured), `user.max_user_namespaces=126787` (measured), kernel 7.2.5 on btrfs (measured). Only the packages are missing: podman 6.1.4, passt, crun, netavark are in `extra` (measured with `pacman -Si`).
- The Docker that is installed is rootful and `ian` is in the `docker` group (measured). That group is root-equivalent on the host, so putting agent containers there reintroduces the host dependency we are deleting. Rootless Docker needs a second daemon plus `dockerd-rootless-setuptool` (read: https://docs.docker.com/engine/security/rootless/) for no gain over Podman.
- Rootless containers keep "root inside" mapped to an unprivileged subuid. That is what makes passwordless `sudo` for `user` acceptable (section 4).
- The CLI is Docker-compatible, so the Amp Docker example maps one to one (read: https://ampcode.com/docs/orbs/self-hosted).

| Option | Fit | Source |
|---|---|---|
| Rootless Podman (recommended) | No daemon, no host root, pasta default, `--network none` plus bind-mounted socket, `--userns=keep-id`, `podman commit` for snapshots | https://docs.podman.io/en/latest/markdown/podman-run.1.html (read) |
| Rootful Docker (installed) | Works today, `docker` group = host root, sudo-in-container is then a real escalation path if a runtime bug appears | measured on omarchy; Amp example uses the same CLI calls (read) |
| Rootless Docker | Same CLI, extra daemon and RootlessKit, socket at `/run/user/<uid>/docker.sock` | https://docs.docker.com/engine/security/rootless/ (read) |
| Apple `container` (Mac, later) | `container build` reads Dockerfile, `commit` needs 1.6+, `--publish-socket host:container`, `--cap-drop`, `--read-only`, network create `--internal` needs macOS 26 | https://github.com/apple/container/blob/main/docs/command-reference.md (read) |
| microVM (E2B Firecracker, Kata) | Own kernel per sandbox; strongest, but needs KVM and a new runtime stack | E2B via https://vercel.com/kb/guide/vercel-sandbox-vs-e2b (read, vendor comparison) |
| Keep systemd-nspawn | Works, but needs pacstrap, root-owned units, polkit rule, host nft | repo `scripts/ops/orb/*` (measured) |

Comparable products: OpenHands' default sandbox is a Docker container that shares the host kernel and is weakened by rw mounts; its enterprise mode drops the Docker socket mount and uses a hardened runtime (https://docs.openhands.dev/enterprise/docker-in-sandbox, read via search summary). Daytona documents default sandbox isolation and an egress allowlist or full block (https://www.daytona.io/docs/en/isolation, read via search summary; which kernel boundary it uses is unverified). Lesson used here: never mount a runtime socket or the home directory into the Orb, and add egress control outside the Orb. A microVM is the upgrade path if container escape becomes the threat model; the interface below does not preclude it.

## 2. The dispatch contract we adopt

### Amp's contract (read: https://ampcode.com/docs/orbs/self-hosted)

`amp orb provider <dispatch>` runs the program once per job with no arguments. Inputs are env vars: `ORB_OPERATION` (`spawn|pause|delete`), `ORB_ID` (e.g. `amp-<thread id>`, also the machine name), `ORB_IMAGE` (spawn), `ORB_SNAPSHOT_ID` (spawn: boot from it; pause: save the disk under it), `ORB_TYPE`, `ORB_TOKEN`, `AMP_URL`. Every operation is idempotent and finishes within five minutes. The provider only makes outbound HTTPS to ampcode.com; no inbound port. The Docker example uses `docker start`, `docker run --init -d --name "$ORB_ID" "$image" sleep infinity`, `docker exec -d --env ORB_TOKEN ... amp orb bootstrap`, `docker stop`, `docker commit` (only with a snapshot id) and `docker rm -f`. A custom image needs a `user` account, a writable `/home/user`, passwordless sudo for `user`, glibc (no Alpine), Git 2.34+, Node 18+, tmux 2.9+. Any program that ignores `ORB_SNAPSHOT_ID` makes every new thread rerun `.agents/setup`. Not on the page: stdin, exit codes.

Cairn differs in one way: the daemon is the provider and it dials nothing at spawn. The worker inside the Orb dials the daemon over `relay.sock`, not the control plane over HTTPS. So `ORB_TOKEN` and `AMP_URL` have no counterpart; the per-step relay token (`<socket>.token`, `relay.ts`) stays.

### Today's `OrbProvider` (measured, `apps/daemon/src/orb/provider.ts`)

`ensure, prepare, start, stop, destroy, list, touch, authenticateRelease`, plus `kind: 'host' | 'orb'`. `OrbLifecycle` (`lifecycle.ts`) calls `provider.list/ensure/touch/stop/destroy`; `runOrbStep` (`step.ts`) calls `prepare`, `start`, `stop`, `authenticateRelease`. Facts that bind us:

- `prepare` returns the per-Orb runtime directory; `step.ts` puts `relay.sock` (and `outbox/` for local repos) in it.
- `prepare` publishes the dist release (`dist.ts`, `pnpm deploy` into `releases/<key>`, `current` symlink) and the project seed (`seed.ts`, bare clone at `/seed/<projectId>/repo`).
- `OrbHandle` is persisted by the daemon in `orb-state/orbs.json` (`machine-loop.ts:178`); the worker checks its own release key against the handle (`authenticateRelease`).
- The provider is chosen in `machine-loop.ts:175-179`: `CAIRN_EXECUTOR === 'orb'` builds `NspawnOrbProvider`, else `HostOrbProvider`.

### Mapping

| Amp op | `OrbProvider` today | New |
|---|---|---|
| spawn (create or resume, run bootstrap) | `ensure` (clone from base) + `start` (`machinectl start`, wait for runtime dir) | `ensure` stays a registry entry only; `start` calls `runtime.spawn`. Create-if-missing moves into spawn so it is idempotent like Amp's |
| pause | `stop` (`poweroff`, then `terminate`) | `stop` calls `runtime.pause` (`stop -t 5`, then `kill`); optional `snapshotId` |
| delete | `destroy` (`machinectl remove`) | `destroy` calls `runtime.remove` (`rm -f`, tolerate not-found) |
| (not in Amp) list | `machinectl list` reconcile | `runtime.list` by label `cairn.orb=1` |
| (not in Amp) touch, authenticateRelease | state file | unchanged, runtime independent |

What stays: `OrbProvider` as the daemon-facing interface, `OrbLifecycle`, `step.ts`, `relay.ts`, `protocol.ts`, `worker.ts` (frames, release check, heartbeat watchdog, stop). What changes: `NspawnOrbProvider` becomes one of two implementations; the new `ContainerOrbProvider` composes `OrbRuntime`. `ComputerOrbs` (`computer.ts`) calls `machinectl` directly and is rebuilt on `OrbRuntime` (section 9).

### Interface

```ts
export type OrbRuntimeName = 'podman' | 'docker' | 'apple';

export interface OrbSpawnSpec {
  orbId: string;
  image: string;
  snapshotImage?: string;
  mounts: readonly { source: string; target: string; readonly: boolean }[];
  env: Readonly<Record<string, string>>;
  limits: { cpus: number; memoryBytes: number; pids: number };
  egress: { socketPath: string } | 'none';
  persistentHome?: { volume: string; target: string };
}

export interface OrbRuntimeState {
  orbId: string;
  image: string;
  state: 'running' | 'paused' | 'absent';
}

export interface OrbRuntime {
  readonly name: OrbRuntimeName;
  health(): Promise<{ version: string; rootless: boolean }>;
  buildImage(input: { contextDir: string; tag: string; buildArgs: Record<string, string> }): Promise<void>;
  imageExists(ref: string): Promise<boolean>;
  spawn(spec: OrbSpawnSpec, options?: { signal?: AbortSignal }): Promise<void>;
  pause(orbId: string, options?: { snapshotImage?: string }): Promise<void>;
  remove(orbId: string): Promise<void>;
  list(): Promise<OrbRuntimeState[]>;
  exec(orbId: string, argv: readonly string[], options?: OrbExecOptions): Promise<OrbExecResult>;
  removeImage(ref: string): Promise<void>;
}
```

`spawn` is create-or-start and idempotent: an existing stopped container starts; a missing one is created from `snapshotImage` if it exists, else from `image`. `pause` keeps the container layer (so `/home/user/work` survives, as the nspawn clone does today). `exec` replaces `runOrbCommand` for in-Orb commands such as the canary's guest probes. `OrbExecOptions`/`OrbExecResult` are reused from `provider.ts`. Container name = `cairn-orb-<id>` with the same validation regex as `validate()` today; label `cairn.orb=1` and `cairn.conversation=<id>` for `list`.

## 3. Runtime adapter design

### Transport: CLI, not API socket

Each adapter shells out through the existing `OrbCommandRunner` (argv array, no shell), like today's `machinectl` calls and like Amp's examples. Reasons: no daemon needed for Podman, argv-only calls are easy to fake in tests (the whole `orb-provider.test.ts` style already does this), and Apple `container` has no documented API socket (it is a CLI, read above). Podman's REST socket (`podman.socket`) is not enabled and not needed. Adapter flag differences are confined to three small modules (`podman.ts`, `docker.ts`, `apple.ts`) that build argv; shared parsing uses `--format json`.

### Image from a Dockerfile

- Location: `apps/daemon/orb-image/Dockerfile` (one file for all runtimes; Apple's `container build` reads `Dockerfile`, read above). A `computer` stage extends the base stage (lane 1 needs Xvfb/Chromium); one multi-stage file, `--target` selects. Route: not under `scripts/`, but not under `src/**`, so the gate decides; see section 7 for the flag.
- Base: a glibc distro. Arch matches the current pacstrap image and the host, so the Node major rule in `build-image.sh` still holds (guest Node major must equal the daemon's, >= 22.19). `ARG NODE_MAJOR`, `ARG CLAUDE_VERSION`, `ARG CODEX_VERSION`, `ARG PNPM_VERSION`, `ARG USER_UID=1000` pin everything the nspawn recipe pins today (`/etc/cairn-orb-image` marker). Packages from the current recipe: base git nodejs npm openssh ca-certificates curl bubblewrap socat python, plus `sudo` and `tmux` (Amp requirement).
- No systemd inside. The nspawn image boots systemd and runs `cairn-orb-worker.service` (`Restart=always`, waits for `/run/cairn/relay.sock`). The container's PID 1 is `tini`/`--init` running a tiny `cairn-orb-entry` script: wait for `/run/cairn/relay.sock`, then `exec node /opt/cairn/daemon/cli.mjs orb-step --socket /run/cairn/relay.sock`, restarting on exit 75 (stale release) only if the supervisor loop is in the entry script. This removes the guest `cairn-orb-check.path` trigger; guest probes run via `runtime.exec` instead.
- Tag: `cairn-orb-base:<recipeHash>` where the hash covers Dockerfile plus pinned args, mirroring the `expected` marker in `build-image.sh`. `buildImage` skips when `imageExists`. Update = bump pins, rebuild, new tag; `ContainerOrbProvider` refuses to create from a tag that is not the current expected one, existing Orbs keep their image until deleted (same as today).
- Build runs as `ian` (`podman build`), no root. The Claude Code `install.cjs` and lifecycle-script rules from the current script carry over (`npm install --ignore-scripts` then explicit install).

### Daemon dist and worker

Unchanged publication (`publishOrbDist` into a host directory), mounted read-only at `/opt/cairn/daemon` (today's `--bind-ro=/var/lib/cairn-orb/dist:/opt/cairn/daemon`). The dist root moves from `/var/lib/cairn-orb/dist` (root-created by the installer) to `$CAIRN_HOME/orb/dist`, created by the daemon itself, so the installer step disappears. The worker still verifies `realpath(entry) == releases/<key>/dist/cli.mjs` (`worker.ts`), so the mount must expose the `releases/` tree, not a single release. An alternative of baking the dist into the image is rejected: the key changes with every daemon build and would force an image build per commit.

### Mounts

| Host | Container | Mode | Note |
|---|---|---|---|
| `$RUN/cairn-orb/<id>/` (daemon-created, 0700) | `/run/cairn` | rw | `relay.sock`, `relay.sock.token`, `outbox/` |
| `$CAIRN_HOME/orb/dist` | `/opt/cairn/daemon` | ro | releases tree |
| `$CAIRN_HOME/orb/seed` | `/seed` | ro | per-project bare clones |
| named volume `cairn-computer-<scope>` | `/home/user` | rw | computer mode only, section 9 |
| `$RUN/cairn-orb/<id>/computer` (daemon-created, 0700) | `/run/cairn-computer` | rw | computer mode only: x11vnc listens on `vnc.sock` (control) and `view.sock` (view-only); the daemon connects and bridges each viewer to its own outbound websocket (D75 section 3.5) |

Never mounted: `$HOME`, any runtime socket, `/run/user`, credentials. Because `step.ts` already treats `/run/cairn` as daemon-owned 0700 (`listen()` checks uid and mode), the daemon now creates the directory itself and the root-only "outbox must be recreated by root" retry in `step.ts` and `runtime-directory.mjs` become unnecessary (inferred: with `--userns=keep-id` the daemon uid owns it on both sides).

### Relay socket

The daemon listens on the host path; the worker connects through the bind mount. Unix sockets cross bind mounts and need no network namespace (inferred from kernel semantics; spike S2). The user inside the container must map to the daemon's uid so it may connect to a 0700 directory: `--userns=keep-id:uid=1000,gid=1000` makes host `ian` appear as image `user`. The `keep-id:uid=,gid=` suboptions are not in the page portion read (it was truncated); verified by spike S1. The `auth` frame with a 256-bit token and the release check stay the real authentication; the socket mode is a second layer.

### Snapshots (#2279)

`podman commit --pause=true cairn-orb-<id> cairn-orb-snap:<projectId>` after the scrub step in #2279 and a `pause`. This is what Amp's Docker example does (`docker commit` on pause when `ORB_SNAPSHOT_ID` is set). Properties:

- A commit captures the container layer only; bind mounts (`/run/cairn`, `/seed`, dist) and volumes are excluded (inferred from OCI commit semantics), so the relay token and seed cannot leak into the image. The sentinel grep in #2279's acceptance can run over `podman image mount` or `podman save` (spike S4).
- Sidecar `{projectId, setupDigest, lockDigest, sourceSha, createdAt}` stays in the daemon state dir as #2279 specifies; `spawn` receives `snapshotImage` only when the sidecar says it is young and matching.
- Cost: on btrfs/overlay the commit is a layer, not a copy. Time not measured; spike S4 reports it against the 40 s cold / 20-25 s warm Amp numbers in #2279.
- CRIU checkpoint (`podman container checkpoint`) is not used: Amp saves no memory either, and rootless checkpoint needs extra caps (guess).
- Docker: same `docker commit`. Apple: `container commit`, 1.6.0 or later (read).
- Snapshots are local images and valid only on the host that made them (read, Amp page); fine, one daemon per host.

## 4. Isolation

Boundary: a rootless container: user namespace, pid/mount/uts/ipc/net namespaces, seccomp default profile, cgroup v2 limits. It shares the host kernel, so a kernel bug is the residual risk (inferred; E2B/Firecracker comparison above is the stronger alternative). nspawn with `PrivateUsers=pick` is no stronger on that axis, so this is not a regression (inferred).

**User namespace.** Rootless Podman maps container uid 0 to `ian` unless `keep-id`; with `keep-id`, `ian` is `user` (1000) and container root is a subuid in 100000:65536 (read: rootless tutorial, https://github.com/containers/podman/blob/main/docs/tutorials/rootless_tutorial.md; subuid range measured present). Files that the agent can reach on the host are only the mounts above: three for a build Orb, plus the home volume and the VNC socket directory for a computer Orb.

**Passwordless sudo for `user` without host privilege.** `/etc/sudoers.d/user: user ALL=(ALL) NOPASSWD:ALL` in the image. Sudo escalates to container root, which is an unprivileged subuid on the host with capabilities only inside the userns. Consequences:

- `--security-opt no-new-privileges` must not be set. It blocks setuid-based escalation through `execve` (read: podman-run page), which would break sudo. Compensation: drop capabilities, keep seccomp and the userns instead.
- `--cap-drop=all` then `--cap-add` the minimum sudo and package installs need: `CHOWN DAC_OVERRIDE FOWNER SETUID SETGID SETFCAP KILL AUDIT_WRITE` (guess; spike S1 finds the smallest working set). No `NET_ADMIN`, `NET_RAW`, `SYS_ADMIN`, `SYS_PTRACE`, `MKNOD`.
- Container root can write files on the three mounts only if the mount is rw; `/seed` and dist are `ro`, and `/run/cairn` already is agent-accessible. So the sudo gain over `user` is container-local: install packages, edit `/etc`, change hostname. That is the Amp use ("configure Git and manage services").
- Seccomp stays the default profile for every Orb. Computer Orbs run Chromium with `--no-sandbox` if spike S1 shows its sandbox cannot start; the container is the boundary. A computer-only seccomp profile, if ever needed, is lane 1's PR.
- The image does not set the nspawn `weaker nested sandbox` differently: Claude Code's `enableWeakerNestedSandbox` stays, because bwrap inside a default-seccomp container usually cannot create nested userns (guess; spike S1).

**Egress limits (concrete).**

- `--network none`: no interface, no DNS, no route. This replaces `firewall.nft` and the `vz-cairn` bridge (measured: today's rules drop everything from `vz-cairn` except `10.203.0.1:7890` and DHCP).
- The relay gets a second listener on a unix socket: `$RUN/cairn-orb/egress.sock` (mode 0600, one shared socket for all Orbs, or per-Orb to attribute traffic). `egress-relay.mjs` keeps all policy: HTTP CONNECT/forward only, resolved addresses must be public (`refused` BlockList for 10/8, 100.64/10, 127/8, 169.254/16, 172.16/12, 192.168/16, ...), ports 80, 443, 22 only (`relayDefaults`, measured). Only the listen and the client-address check change: today it checks `socket.remoteAddress` against `10.203.0.0/24`; on a unix socket there is no remote address, so access control becomes the socket's file mode and mount (inferred).
- Inside the container the entry script starts `socat TCP-LISTEN:7890,bind=127.0.0.1,fork UNIX-CONNECT:/run/cairn/egress.sock` (socat is already in the image list) and sets `HTTP_PROXY=HTTPS_PROXY=http://127.0.0.1:7890` plus the lowercase pair and `NO_PROXY=localhost,127.0.0.1,::1`, exactly the env the nspawn drop-in and `/etc/environment` carry today (with the address changed from `10.203.0.1`). `deps.orbProxyUrl`/`CAIRN_ORB_PROXY_URL` in `step.ts` keeps working.
- Why not pasta: its default gives a full outbound stack (read: podman-run page, "pasta default for rootless"); restricting it needs host nft rules, which is what we delete. `--map-gw`/`-T`/`-U` toggle host reachability only. slirp4netns is not described on the current Podman pages (read) and is legacy (inferred).
- Why not an `--internal` network: needs netavark and a host-side proxy address anyway, and Apple's `--internal` needs macOS 26 (read).
- Apple adapter: `--publish-socket host:container` publishes a socket from the container to the host (read), the opposite direction of a daemon-listened socket. Both `relay.sock` and `egress.sock` would need the container side to listen and the host to connect. The existing `cairn-orb-rpc:`-prefixed line framing (`protocol.ts`) is transport-agnostic, so stdio over `container exec` is a viable alternative (inferred; Apple spike A1 decides, not on the critical path).

**Resource limits.** `--cpus 4 --memory 4g --pids-limit 4096` equals the nspawn drop-in (`limits.conf`: MemoryMax 4G, CPUQuota 400%, TasksMax 4096, measured). Rootless limits need cgroup v2 delegation of `cpu memory pids` (measured present for `ian`'s user slice). Add `--memory-swap` equal to memory (no swap) and `--ulimit core=0` (the worker unit had `LimitCORE=0`). `--read-only` is not used: agents install tools; the writable layer is the design.

**Not mounted / not ambient**: no `--privileged`, no `--device`, no host network, no `--add-host` for host-gateway, `--security-opt label=disable` not needed on Arch.

## 5. Migration

Flag: `CAIRN_ORB_RUNTIME=nspawn|podman|docker|apple`, read where `machine-loop.ts:177` picks the provider; unset with `CAIRN_EXECUTOR=orb` means `nspawn` until the default flips. Both providers can exist on the host at once: nspawn Orbs use `cairn-orb-*` machine names, container Orbs use container names with the `cairn.orb` label and different state files (`orb-state/orbs.json` vs `orb-state/containers.json`), so reconcile never sees the other's handles. The trial daemon (`cairn-daemon-orb.service`, `CAIRN_EXECUTOR=orb`, machine `omarchy-orb`, measured) is the first to flip; the production daemon is not touched.

Deletion schedule (each in its own PR, after the stated gate):

| Item | Deleted when |
|---|---|
| `firewall.nft`, `cairn-orb-firewall.service`, `ufw-rules.mjs`, host-check firewall/ufw/foreign-rules fields | after canary on podman is green on `main` for a week and nspawn Orbs are gone |
| `50-cairn-orb.rules` (polkit), `systemd-nspawn@cairn-orb-.service.d`, `cairn-orb.nspawn`, `prepare-machine.sh`, `runtime-directory.mjs`, `machine-cleanup.mjs`, `host-files.mjs` | same PR as `NspawnOrbProvider` removal |
| `build-image.sh` (pacstrap), `build-computer-image.sh` | when the Dockerfile builds both stages in CI-reproducible form and lane 1 has moved |
| `egress-relay` `10.203.0.1` TCP listener | last, after no nspawn Orb remains |
| `/var/lib/machines/cairn-orb-*`, `/var/lib/cairn-orb` | manual cleanup, sudo line in section 8 |

Canaries (`scripts/ops/orb/canary*.mjs/sh`, #2277/#2528): the harness plants sentinels, runs a stack, and probes from inside the Orb (measured: `canary-sentinels.mjs`, `canary-attacker.mjs`, `canary-stack.mjs`). Port by (a) replacing `machinectl` calls with `OrbRuntime.exec`, (b) keeping every attacker route (`expectedTargets`, `networkTargets`) and adding two container-specific routes: the `/run/cairn` neighbours (other Orbs' directories absent) and host-gateway reachability (must fail with `--network none`), (c) keeping the negative control. `orb-host-check.mjs` loses `firewall`, `ufw`, `foreignRules`, `polkit`, `memoryMax` fields and gains `runtime`, `rootless`, `cgroupControllers`, `imageTag`. Fixtures in `scripts/ops/orb/fixtures` are replaced alongside.

## 6. Failure modes

| # | Failure | Behavior required | Test that proves it |
|---|---|---|---|
| F1 | `spawn` called twice for the same orb | second call is a no-op start, one container | `container-provider.test.ts`: fake runner records one `create`, two `start` |
| F2 | Daemon crashes mid-spawn after `create` | restart `reconcile` finds the labelled container, adopts or removes it | provider test with a pre-seeded `list` result and no state-file entry |
| F3 | `pause` while the worker ignores SIGTERM | `stop -t 5` then `kill`; handle `running=false` | provider test with fake stop that leaves state running |
| F4 | `delete` of an absent container | success, no throw | runner returns "no such container"; test passes |
| F5 | Image tag missing or stale | `spawn` fails with an actionable message, never falls back to another tag | provider test |
| F6 | Snapshot older than 72 h or digest changed | create from `image` | #2279 fake-clock test, 71h59m restores, 72h01m rebuilds |
| F7 | Scrub fails before commit | no snapshot, no commit | command-order test, commit never invoked |
| F8 | Orb tries direct egress (curl to a public IP, DNS, a private IP) | all fail; proxy path reaches 443 and refuses private targets | canary routes on podman, with the negative control |
| F9 | Orb reads host files or other Orbs' dirs | not present | canary route `neighbour-run-dir`, `home-visible` |
| F10 | `sudo` inside the Orb attempts host effect (mount, `/proc/sys`, `nsenter`, write `/seed`) | denied | canary route `sudo-escape` run as `user` |
| F11 | Worker sees stale release | exit 75, daemon refuses, startup watchdog fires | existing `orb-watchdog.test.ts` unchanged, runs on the new provider via the fake runtime |
| F12 | Socket permission mismatch (uid map wrong) | `spawn` fails fast with "relay not connectable", does not hang to the 120 s heartbeat timeout | provider test plus host-check `keep-id` probe |
| F13 | cgroup controller not delegated | `health()` fails, daemon reports no `orb` capability (D71 fail-closed, #2652) | health test with `cgroup.controllers` fixture lacking `memory` |
| F14 | Limits exceeded (fork bomb, memory) | container killed or pid-limited, host unaffected | host-check probe `fork-bomb` with `--pids-limit` |
| F15 | Two daemons share the runtime | `cairn.owner=<machineId>` label; `list` filters by it | provider test |
| F16 | Egress socket missing at spawn | spawn fails; no fallback to host network | provider test asserts `--network none` is in every create argv |
| F17 | Image build run twice concurrently | second waits on lock or fails; no half-tag | build script test with a lock fixture |

## 7. PR list (merge order)

Protection comes from `packages/shared/merge-gate-paths.json`: `scripts/ops/**` and `**/package.json` are protected (owner route, `releaseAndControlPlane`); `apps/*/src/**` and `apps/*/test/**` are auto-merge; the machine registration/dispatch files named in CLAUDE.md need `/security-review`. None of the files below is on those security lists (measured: the lists name `machine*.ts`, `command-gate.ts`, `credentials.ts`). Because the egress boundary is security-relevant by purpose, I still run `/security-review` on PR 4 and 6 and record why in Risk.

| # | PR | Files | Route |
|---|---|---|---|
| 1 | `OrbRuntime` interface, `OrbSpawnSpec`, `CAIRN_ORB_RUNTIME` selection; `NspawnOrbProvider` untouched | `apps/daemon/src/orb/runtime.ts`, `machine-loop.ts`, tests | auto-merge path |
| 2 | `PodmanOrbRuntime` CLI adapter + `ContainerOrbProvider` (spawn/pause/remove/list, mounts, limits, keep-id, `--network none`), fake-runner tests | `apps/daemon/src/orb/{podman,container-provider}.ts`, `apps/daemon/test/container-provider.test.ts` | auto-merge path |
| 3 | Dockerfile + `build-image.sh`-equivalent build entry, recipe hash, image tests | `apps/daemon/orb-image/Dockerfile`, `scripts/ops/orb/build-container-image.sh` + test | protected (owner) |
| 4 | Unix-socket listener in the egress relay + in-container socat bridge env | `scripts/ops/orb/egress-relay.mjs`, `egress-relay.test.mjs`, `apps/daemon/orb-image/entry.sh` | protected (owner), `/security-review` |
| 5 | Relay path simplification: daemon-created runtime dir, drop root-recreate retry; `ORB_AGENT_HOME` to `/home/user` | `apps/daemon/src/orb/{step,worker}.ts`, tests | auto-merge path; agree rename with lane 1 first (section 9) |
| 6 | Canary and host-check port to containers; fixtures; user-unit for the relay | `scripts/ops/orb/canary*`, `orb-host-check*`, `fixtures/*`, `egress-relay.service` as user unit | protected (owner), `/security-review` |
| 7 | Snapshots: `pause({snapshotImage})`, `spawn` from snapshot, sidecar (#2279) | `apps/daemon/src/orb/{snapshot,container-provider}.ts`, tests; measurement script under `scripts/` splits into 7b | 7a auto-merge, 7b protected |
| 8 | Docker adapter (rootless-only guard: refuse if `docker info` lacks `rootless`, allow override flag) | `apps/daemon/src/orb/docker.ts` | auto-merge path |
| 9 | Flip default for the trial daemon, then #2533 default-on keyed on canary | unit file, `machine-loop.ts` | unit under `scripts/`: protected |
| 10 | Remove nspawn implementation, polkit, firewall, pacstrap scripts | deletions in `scripts/ops/orb/**`, `provider.ts` | protected (owner) |
| 11 | Apple adapter and stdio or published-socket relay transport | `apps/daemon/src/orb/apple.ts` | auto-merge path |

Stack-friendly: 1-2 are independent of scripts; 3 and 4 branch from `main` and do not depend on each other; 5 depends on 2; 6 depends on 2-4; 7 on 2; 9 on 6; 10 on 9 plus a week of green canary.

## 8. Host setup on omarchy

Sudo (one batch, ian runs it):

```sh
sudo pacman -S --needed podman passt crun netavark aardvark-dns
```

Cleanup sudo, only after PR 10 (not now):

```sh
for m in $(machinectl list --no-legend | awk '/cairn-orb-/{print $1}'); do sudo machinectl terminate "$m"; done
sudo systemctl disable --now cairn-orb-firewall.service egress-relay.service
sudo rm -f /etc/polkit-1/rules.d/50-cairn-orb.rules /etc/systemd/system/systemd-nspawn@cairn-orb-.service.d/limits.conf
sudo machinectl remove cairn-orb-base cairn-orb-computer
sudo rm -rf /var/lib/cairn-orb /run/cairn-orb /usr/local/lib/cairn-orb
```

Non-sudo, run by me over `ssh -o BatchMode=yes -o ConnectTimeout=5 omarchy`:

1. `grep ^ian: /etc/subuid /etc/subgid` (expect 100000:65536); `podman system migrate` if the ranges ever change.
2. `podman info --format '{{.Host.Security.Rootless}} {{.Host.NetworkBackend}} {{.Store.GraphDriverName}}'` (expect `true`, `netavark`, `overlay`).
3. `cat /sys/fs/cgroup/user.slice/user-$(id -u).slice/cgroup.controllers` includes `cpu memory pids` (measured present).
4. `podman build --target base -t cairn-orb-base:<hash> apps/daemon/orb-image` from the checkout.
5. Spikes S1-S4 (below) with `--network none`.
6. Create `$XDG_RUNTIME_DIR/cairn-orb` (0700) for sockets; install the relay as a user unit (`systemctl --user enable --now cairn-orb-egress-relay`), `Linger=yes` already (measured).
7. Set `CAIRN_ORB_RUNTIME=podman` in the trial unit `cairn-daemon-orb.service` and `systemctl --user restart` it.

Spikes before PR 2 merges (each is a command on omarchy; results go in `docs/verify/`):

- S1: `podman run --userns=keep-id:uid=1000,gid=1000 --cap-drop=all --cap-add=... --network none` with `sudo -n true`, `apt`/`pacman -S` of a package, bwrap, then the minimal cap set.
- S2: bind-mount a directory with a unix socket and connect from `user` (both directions of ownership), and the reverse: a socket created inside the container (`/run/cairn-computer/vnc.sock`) that the host daemon connects to.
- S3: socat to the relay unix socket reaches 443, refuses a private address.
- S4: `podman commit` timing on btrfs with a project's post-setup layer and a sentinel grep over the committed image.

## 9. Open questions for lanes 1 and 2

Coupling points found in `docs/research/coordinator-computer.md` (read from `origin/docs/coordinator-computer`):

- Lane 1 (D75) builds `orb-computer` on `cairn-orb-computer` cloned from `cairn-orb-base` with a `/home/agent` bind from `/var/lib/cairn-computer/<name>` and the existing relay and egress relay (S1 in its doc: 3.1 GB clone, Chromium sandbox working with `PrivateUsers=pick`). Its P2 and P3 touch `scripts/ops/orb/*` and `apps/daemon/src/orb/*`, the same files PR 3, 4, 5 and 10 touch.

Questions for lane 1:

1. Will `ComputerProvider` talk to `OrbRuntime` (spawn with `persistentHome`, pause, remove) instead of `ComputerOrbs`' `machinectl` calls? Proposal: yes; I keep `ComputerOrbs` API (`ensure/touch/hold/sweep/known`) and swap its internals in a follow-up owned by lane 1.
2. Image user: Amp requires `user` with `/home/user`; the code and your doc use `agent` and `/home/agent`. Proposal: rename to `user` in PR 5, one constant (`ORB_AGENT_HOME`). Can P3b absorb it?
3. Chromium needs its sandbox (userns) and `--shm-size`; default rootless seccomp blocks nested userns (guess). Will you run Chromium `--no-sandbox` inside the container, or do you need S1 extended (add `--security-opt seccomp=<profile>` allowing `clone(CLONE_NEWUSER)`)? I will not widen seccomp for ordinary build Orbs.
4. The computer needs X over a unix socket and possibly noVNC; with `--network none` nothing is published. Is a read-only viewer served through the daemon over `relay.sock` (my assumption) or a published port?
5. Persistent home: named volume `cairn-computer-<scopeKey-hash>` (survives `rm`) versus the host bind in your doc. Volume avoids the root-owned `/var/lib/cairn-computer` mount and `computer-home.mjs`.

Questions for lane 2 (B2, #2278 trial-one, #2279 snapshot, #2533 default-on):

1. #2279 is written around `machinectl clone` to `cairn-orb-snap-<projectId>`. Proposal: re-scope its mechanism to `OrbRuntime.pause({snapshotImage})` plus the same sidecar and acceptance criteria; the "through the `machinectl image-status` path" grep becomes `podman image mount`. OK to wait for PR 2 and 7 and not implement it on nspawn?
2. #2533 default-on keys on "orb capability": which host check fields does it read? The fields `firewall`, `ufw`, `polkit`, `foreignRules` disappear in PR 6. Confirm the gate only needs `executor: 'orb'` plus the canary result.
3. `trial-evidence-check.mjs` validates `orbName = "cairn-orb-<conversationId>"` and a `machinectl status` capture (#2278). The container name keeps `cairn-orb-<id>`, but the capture becomes `podman inspect`. Can the validator accept either until nspawn is removed?
4. Is a trial running now that PR 9's flip would interrupt? I flip only the trial daemon, only between tickets, never mid-step.
5. Do any running tickets depend on `/var/lib/cairn-orb/{dist,seed}`? PR 2 moves these under `$CAIRN_HOME/orb/` for container Orbs only; nspawn keeps the old paths until PR 10.

Questions for ian: none blocking. One call is recorded as decided: rootful Docker is not used for production Orbs because of the `docker` group, unless you say otherwise.

### Answers from lane 1 (D75), 2026-11-04

1. Agreed. `ComputerOrbs` keeps its API; lane 1 moves its internals onto `OrbRuntime` in a follow-up it owns.
2. Agreed. PR 5 renames `agent` to `user` through `ORB_AGENT_HOME`, and P3b imports the constant. `scripts/ops/orb/computer-home.mjs` and the computer image's desktop unit also say `agent`; PR 5 leaves them to lane 1.
3. Agreed. No seccomp widening for build Orbs. Chromium falls back to `--no-sandbox` if S1 shows its sandbox fails in the container.
4. Corrected. There is no published port, and the viewer does not go through `relay.sock`. x11vnc listens on two unix sockets, `vnc.sock` and `view.sock`, in a directory the daemon can reach (D75 section 3.5 and S2), and the daemon bridges each viewer to its own outbound websocket. A computer spawn adds one rw bind, `$RUN/cairn-orb/<id>/computer` to `/run/cairn-computer` (row added to the mounts table). It is a separate directory and not a subdirectory of `/run/cairn`, so the relay directory keeps its daemon-only uid and mode check. `OrbSpawnSpec.mounts` already takes any list, so the interface does not change. Spike S2 also covers this direction, with the container listening and the host connecting.
5. Agreed. The home is the named volume `cairn-computer-<scopeKey-hash>`. It survives `podman rm` and image updates, and Update takes a backup first (`podman volume export` or a btrfs snapshot of the volume directory, per D75 section 3.7).
