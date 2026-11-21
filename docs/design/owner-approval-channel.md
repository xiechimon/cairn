# Owner approval channel

Status: implemented beside this document. Grounded on `origin/main b44f16a1b`. Issue #4948; related #4889, #4935, #4986, #4952. Prior art: `docs/research/owner-approval-channel-2026-11-22.md`.

## Newcomer

Someone who installed Cairn on their Mac and let the Coordinator use it (`CAIRN_OWN_COMPUTER=1`, the `user_computer_shell` tool). When the Coordinator wants to do something it cannot undo — delete a project or todos, send a mail — it posts an approval card and waits for a click. The click has to mean "the owner clicked", not "a program on this Mac answered". Today a program the model itself ran on that Mac can mint an owner session over loopback and click the card itself: no window, no person. This change makes every owner decision travel a channel that program cannot ride, and stops the model's shell from reaching the server's files and port at all. What the owner sees: nothing on the Mac — the card looks and answers the same, no new prompt. One visible change on self-hosted Linux: a browser on the same box no longer becomes owner silently; it meets the pairing/token gate like any other browser.

## Threat

A process the model controls runs as the owner's uid on the same host as the Cairn server. The own-computer host shell (`apps/daemon/src/computer/host.ts`, spawned by `user_computer_shell`) is exactly that; the `computer` file tools under the same home are another face of it. Such a process can:

- read any file the owner can — including the owner Bearer token in the server home (mode 0600 is no defense against same uid) and `server.db`
- write `server.db` — e.g. insert a forged `action_proposal` row with `status='executed', decision='always'`, which `coveringGrant` in `action-registry.ts` then honors as a standing grant with no HTTP involved
- open `http://127.0.0.1:<port>` and set any header (`sec-fetch-site`, `origin`, cookies)
- read any same-uid environment (`ps eww`, `/proc/*/environ` — measured readable on macOS for non-restricted targets such as the unsigned Cairn build, and on Linux when `ptrace_scope=0`) — so a secret must never ride env or argv

It cannot, on macOS, read another process's memory (`task_for_pid` is entitlement-gated) or attach to the Electron main↔utility-process channel (a private fd pair) — the two facts the fix builds on. On Linux `bwrap` gives equivalent file confinement for the shell.

What the process can do today, each a path to a forged owner decision:

1. `POST /api/auth/bootstrap` as a same-uid loopback peer on Linux with no `sec-fetch-site` → owner cookie → the approval-card answer route (the issue's repro).
2. `cat <cairnHome>/token` → `Authorization: Bearer` → the same answer routes (needs no bootstrap at all, works on macOS).
3. `sqlite3 server.db` → forged `action_proposal` row → `coveringGrant` treats the next external call as pre-approved.
4. `POST /api/remote/pairing` with owner creds → `POST /api/remote/pair` (open) → a paired-device session → answer cards as `device:<id>` — grants store only `codeHash`, but minting the grant needed only the stolen Bearer.
5. `POST /api/machine/enroll/start` (unauthenticated) + `/confirm` with owner creds → re-key the local machine (#4952's surface).

## Options

| Option | Blocks self-approval | Owner-visible change | Verdict |
|---|---|---|---|
| Require `sec-fetch-site` on bootstrap | No — the process sets any header | None | Insufficient alone |
| Person-channel credential held in Electron main memory, injected into the app's own requests (prior art: 1Password broker + Codex private-fd channel + Electron `webRequest` injection) | Yes — main's memory and the mojo channel are the two places a same-uid program cannot reach | None | **Chosen** |
| Per-answer HMAC from an `ipcMain` signer | Yes | None, but adds a preload+web signing path per answer while covering only answers | Rejected — a static unobservable header covers every decision route with one mechanism and zero new IPC surface |
| OS prompt per approval (LocalAuthentication / Touch ID) | Yes | New prompt per approval | Rejected — changes the owner experience; the design-brief fallback. Kept as a later hardening in the research doc |
| Paired device per approval | Yes | New prompt per approval | Rejected — same |
| Confine the host shell (seatbelt / bwrap file+net) | For the file paths yes; for loopback, macOS yes, Linux no (no per-endpoint net control) | The shell loses read of Cairn's own dirs and the session secrets list, and `open`/LaunchServices escapes | **Chosen, with the credential** |
| Keep bootstrap + peer-uid, hardened | No — `sec-fetch-site`, `origin`, peer uid are all forgeable by a same-uid process | None | The bypass itself — **removed**, not hardened |
| HMAC grant tag on `action_proposal` rows | Yes for the db-forgery path | 'always' grants die at every server restart | Rejected — breaks persisted grants |

## Chosen: remove the bypass, person-channel credential, confined host shell

### Remove the loopback-owner mint

`POST /api/auth/bootstrap`, `ctx.loopbackOwner`, and `lib/loopback-owner.ts` go away. Peer uid was the bypass — the one thing a same-uid process is guaranteed to match. Linux self-host browsers on the same box now meet the pairing/token gate (the `bootstrapLoopback` calls in the web client are removed with it; the gate's pair-code and token entry are unchanged). Owner sessions still come from the Bearer token, the Cloudflare access exchange, or a paired-device grant.

### The credential (`x-cairn-owner-channel`)

- The Electron main process mints 32 random bytes in memory per launch — never on disk, never in any env or argv (env is same-uid readable on the unsigned build).
- Main→server: the server fork (`utilityProcess`) posts `{type:'cairn-owner-channel-ready'}` on `process.parentPort` at module init when `CAIRN_OWNER_CHANNEL=ipc` is in its env; main answers `{type:'cairn-owner-channel', key}` over the same private channel. The env var carries a flag, not the secret.
- Main→renderer: the existing `signOwnPagesIn` `webRequest` filter that injects `Authorization` for the app origin also injects `x-cairn-owner-channel`. `enrollLocalMachine` (a main-process fetch) adds it explicitly.
- The server, when a channel is expected, requires the header on every route that turns an owner decision into effect — the table below. A paired-device identity is exempt (it is already out-of-band: the token lives on another device and grants hold only code hashes).
- Fail closed: while a key is expected but has not arrived, the decision routes refuse with 503.

### The confined host shell

`HostComputerProvider` gains a `confinement` option (wired in `machine-loop.ts` from `CAIRN_HOME`, `~/.cairn`, `CAIRN_CONFINE_DENIED_ROOTS` — the desktop already passes the server home there — `CAIRN_SERVER`'s port, and `CAIRN_AGENT_DESKTOP`):

- `resolveInHome` refuses any path inside the denied roots or the session secrets list (`DENIED_*` plus the macOS list: Keychains, browser profiles, Mail, Messages, Cookies) — kills token theft, db forgery and grant minting through the file tools on every platform, no sandbox needed. `cwd` resolves through the same check.
- `execute` on darwin spawns under `sandbox-exec` with a profile that `(allow default)` then denies `file-read* file-write*` on the same paths and under the `agent-desktop` directory (file-read there is what closes copy-then-exec around `process-exec`), denies `network-outbound` **and** `network-inbound`/`network-bind` on the server port for `localhost` and `*` — without the bind deny a confined shell could kill the same-uid server, rebind the port and harvest the injected Bearer+channel headers; `*` covers `127.0.0.1` and `::1`. `process-exec` stays denied under the `agent-desktop` directory. `mach-lookup` denies on `com.apple.coreservices`/`com.apple.lsd` keep `open`/Apple-Event launches inside the profile, and `com.apple.windowserver`/`com.apple.hiservices`/`com.apple.pasteboard` denies cut CGEventPost synthetic input, screen capture and the pasteboard — verified: `cliclick` moves are dropped, `screencapture` fails, Apple Events to running apps error (-1728/-10827), while `git`/`node`/`clang`/`curl` keep working. The same port and mach-service denies ride the session `seatbeltProfile` (`confine-session.ts`), since harness sessions are the same same-uid threat. On darwin the path check folds case (APFS is case-insensitive) and both roots and probes resolve through realpath. The port is derived from `CAIRN_SERVER` with the scheme default (80/443) in both machine-loop and confine-session so a port-less URL cannot silently switch the denies off. Container runtimes are unreachable two ways: the daemon's state (`~/.docker`, `~/.orbstack`, `~/.colima`, `~/.lima`, `~/.rd`, `~/.local/share/containers`, `~/.config/containers`, `$XDG_RUNTIME_DIR/podman`, `/run/user/<uid>/podman`) is file-denied, and the sockets themselves are unreachable because `file-read*` denies do not govern a unix-domain `connect` — the profile adds one `remote unix-socket` deny per denied directory (subpath) and denied file (literal), `literal` denies on the absolute container sockets (`/var/run/docker.sock`, `/private/var/run/docker.sock`, `/run/docker.sock`, `/run/podman/podman.sock`) for rootful daemons outside the home, and a regex covering the agent-socket classes under the tmp roots (`/tmp`, `/private/tmp`, `/var/tmp`, per-user `$TMPDIR` `/var/folders/<hash>/<hash>/T`, and `/var/run` — where launchd actually vends `com.apple.launchd.*/Listeners` agent sockets on modern macOS): launchd Listeners, `ssh-*`, `tmux-*`, `uscreens`, `screens`, `zellij-*`. The same regex rides a `local unix-socket` bind deny and a `file-write*` deny — without them a confined process could squat a class path (or hardlink a real socket inode to one) and serve a fake agent/tmux to the owner's later clients. The denies are emitted one filter per rule — a probe found that a single `remote unix-socket` rule carrying ~30 filters enforces only the first. On linux bwrap ro-binds `/dev/null` over any denied path that exists but is not a directory, which covers sockets and fifos. A `docker run -v /` mount would void every file deny, so the client can never reach the daemon socket.
- `execute` on linux spawns under `bwrap`: `--bind / /` then `--tmpfs` masks on `/tmp` and `/var/tmp` (the whole agent-socket class — tmux, ssh-agent, screens, zellij — lives at enumerable names there, and a fresh tmpfs also closes socket squatting), `--tmpfs` masks on denied directories and `/dev/null` ro-binds on denied files — the `/run/user/<uid>` runtime dir contributes `podman`, `systemd`, `keyring`, `gcr`, `gnupg`, `at-spi`, `dconf`, `dbus-1`, `docker`, `containerd`, `buildkit`, `pulse` directories plus the `bus`, `ssh-agent.socket`, `docker.sock`, `containerd.sock` sockets and every other socket file enumerated at its root at wrap time (wayland and pipewire sockets are sockets too, so display, capture and virtual-pointer paths close with them), so `systemd-run --user`/`busctl` cannot spawn outside the mount namespace, AT-SPI cannot drive owner apps, and rootless-container and agent/keyring sockets are unreachable. `DBUS_SESSION_BUS_ADDRESS` is dropped from the env because an abstract-socket bus cannot be masked by a mount. There is no per-endpoint network control on Linux, so the credential is what stops the HTTP path there. When `bwrap` is absent the call refuses rather than running unconfined.
- The shell env stays the existing whitelist — no `CAIRN_*` variable; `SSH_AUTH_SOCK` and `DBUS_SESSION_BUS_ADDRESS` are dropped (a usable agent or an abstract-socket session bus would let the shell authenticate as the owner or spawn outside confinement), and no secret ever enters it (test). `bwrap` and the `python3` subreaper resolve against a fixed system PATH so a planted `~/.local/bin` binary cannot become the confiner.
- The screen driver (`AgentDesktopHostScreen`, `user_computer_*` tools) refuses to drive Cairn itself: a window whose app name or title contains `cairn` or a Cairn origin host (`CAIRN_SERVER` + `CAIRN_WEB_ORIGINS`, plus the literal `cairn` token) on any app — dev builds run as `Electron` so the check cannot lean on the app name — and, once an observation lands, any window whose accessibility rows contain a Cairn string; every `act` re-checks before each action. A window once identified stays refused for the daemon's life. The remote-desktop driver (`DesktopAccessibility`) applies the same app-name and title rules; synthetic OS input is additionally cut at the mach-lookup layer above, so a click cannot reach the channel-carrying renderer by any of the three paths.

### Every path that issues or checks the owner credential

| Path | Before | After |
|---|---|---|
| `POST /api/auth/bootstrap` | same-uid peer (+ optional `sec-fetch-site`) → owner cookie | **removed** |
| `Authorization: Bearer <token>` | owner identity on all routes | unchanged for ordinary routes; not sufficient on decision routes when the channel is configured |
| `cairn_auth` owner session (`kind: owner`) | owner identity | same as Bearer — needs the channel on decision routes |
| `/api/auth/access` (Cloudflare) | owner cookie for a verified account | issues `kind: external` sessions — exempt from the channel check (the verified IdP exchange is itself a channel the model cannot mint or steal; keeps tailnet/phone approvals working) |
| Paired-device token/session | `device:<id>` identity | unchanged; exempt from the channel check |
| Card answer / cancel (`routes-chief`) | owner or device | + channel check for non-device callers |
| `POST /api/actions/proposals/:id/answer` | owner or device | + channel check for non-device callers |
| `POST`/`DELETE /api/remote/pairing*` | owner | + channel |
| `POST /api/machine/enroll/confirm` | owner | + channel |
| Renderer fetch (desktop window) | `Authorization` injected | + channel header, invisible |
| `enrollLocalMachine` (desktop main) | `Authorization` | + channel header |
| IM callback answers | internal channel | unchanged |

## States and transitions

- `ctx.ownerChannel`: `undefined` (headless server — today's rules) → `{ key: null }` (flag set, handshake pending — decision routes refuse) → `{ key }` (configured). The key never rotates within a launch; a server restart re-shakes.
- Proposals keep the `pending → executed/refused/expired/superseded` machine; the new check sits at route admittance, before `answerProposal`.
- Host-shell confinement is per-spawn; a profile that cannot express the denies fails the call instead of falling back to an unconfined spawn.

## Failure behavior

- Decision route without/with wrong channel on a configured server → `403 owner channel required`.
- Channel expected but never arrived (fork handshake failed) → `503` — loud, closed.
- Host file tool under a denied root → `ComputerRefusal`, "inside a protected Cairn directory".
- `bwrap`/`sandbox-exec` unavailable or profile rejected → the exec call fails with a refusal; no unconfined fallback.
- A forged `action_proposal` row is unreachable only where file confinement holds; on unconfined installs the db-write hole stays a documented residual of #4986.

## Residuals (named, not fixed here)

- Same-uid `kill` on the server: macOS Seatbelt `signal (target others)` was probed and does not hold — the confined shell can still kill the server process. Rebinding the port is denied in both profiles, so a kill buys availability only (the desktop respawns the server); it cannot capture the channel. Linux `bwrap` has no signal isolation either — same class.
- File-tool TOCTOU: `denied()` is checked before each fs operation, not pinned to a descriptor. A racing symlink swap could slip a read of a denied path through the file tools — its worst yield is the on-disk Bearer token, which still cannot reach a decision route without the channel key (never on disk). The spawned-command path is sealed by the OS sandbox, which has no check/use gap.
- `POST /api/machine/enroll` stays an API-key route (not an owner decision): what it mints is a machine identity — machine tokens answer to `/api/machine/*` only and cannot produce `pairedDeviceId` or reach approval routes. Enrolling a rogue machine needs a machine-access API key the owner created; a stolen key exercises only the capability the key already grants, outside this issue's goal.
- Other session-server sockets: attaching to an already-running emacs/nvim daemon or a session server on a non-enumerated socket executes outside the sandbox. The known classes are closed — `~/.tmux`/`~/.screen` file-denied; `remote unix-socket` regex + bind + file-write denies cover the launchd/ssh/tmux/screen/zellij classes under `/tmp`, `/private/tmp`, `/var/tmp`, `/var/run` and per-user `$TMPDIR`; on linux `/tmp` and `/var/tmp` are fresh tmpfs and the runtime dir's agent/keyring/at-spi/dbus/container entries plus every root-level socket are masked — but arbitrary socket paths cannot be enumerated; class partially open.
- Linux abstract sockets and X11 input: bwrap shares the network namespace, so abstract unix sockets (a `unix:abstract=` session bus, `/proc/net/unix`-enumerable) stay reachable — `systemd-run --user` over an abstract bus can still spawn outside the mount namespace; `--unshare-net` would close it but also cuts the shell's real work. Dropping `DBUS_SESSION_BUS_ADDRESS` removes the convenient path only. Likewise X11 display access (inherited `DISPLAY`) exposes XTEST input injection on X11 linux hosts — there is no linux analogue of the windowserver/mach deny; wayland compositor sockets are masked, so this residual is X11-class only.
- Whole-screen observation: a `user_computer_observe` screenshot of an app that shares the screen with the Cairn window can leak the card's pixels into model context — information leak only; it cannot produce a click or a channel key.
- `POST /api/computers/:id/actions` and a small set of mutators outside `OWNER_ONLY_PATTERNS` remain paired-device reachable — pre-existing, unchanged by this change; a decision-route audit table lives in the test.
- On Linux there is no per-endpoint network deny in `bwrap`, so the session-level kill-and-rebind has no OS analogue there; the credential (never on disk/env) is what stops the header harvest on Linux.
- Headless servers on a shared host (`cairn` self-host + same-box model processes): no broker process exists to hold a channel; the Bearer token file remains same-uid readable. Approval answers there keep today's credential rule until #4986's confinement precondition lands — the loopback mint is still removed.
- Same-uid memory inspection: Seatbelt cannot deny `task_for_pid` — `vmmap`/`sample`/`lldb` against the same-uid server or desktop main process work inside the profile (measured), so the in-memory channel key is heap-readable in principle. On a hardened-runtime build without `get-task-allow`, same-uid `task_for_pid` is refused — worth verifying at packaging; on linux `ptrace_scope` is the analogue. Until then the key is "not on disk, not in env" — still strictly better than the file token it replaces, and harvesting it requires the confined process to locate a 43-char string in a large heap.
- launchd mutation IPC: the inherited mach bootstrap port is not seatbelt-deniable, so `launchctl kickstart`/`bootstrap` verbs reach the user domain. Overwrite a loaded agent's `Program` under a profile-writable path (e.g. a user-dir helper) and `kickstart -k` respawns it outside the sandbox — measured to the answered-request stage; the spawned child itself was verified to stay confined only via `bsexec`, not via the agent path. Denying exec of `launchctl` is cosmetic (the IPC is reimplementable); closing this needs either a deny-list over every loaded agent's writable program path or a different-uid broker — future hardening.
- Desktop on Linux: `ptrace_scope=1` (default on Ubuntu/Arch) keeps main memory safe; `=0` or a same-uid debugger degrades the credential to "not in env/disk", still strictly better than today's file token.
- `HostDesktops` providers (linux `computer` sessions on the host) run model commands too; they are the #4986 class and keep their existing behavior — the channel protects approvals regardless.
