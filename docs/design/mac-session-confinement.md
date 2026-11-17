# Mac session confinement

Date: 2026-11-17
Status: approved by ian on 2026-11-17 (all seven decisions as recommended); segment 1 landed, wiring pending (see Implementation segments). Touches the `machineAndCommandBoundary` security surface (`apps/daemon/src/backend/command-gate.ts`, `machine-client.ts`) and adds a new launcher beside `confine.ts`.
Research: [mac-session-confinement-2026-11-17](../research/mac-session-confinement-2026-11-17.md). Linux counterpart: [linux-harness-confinement](linux-harness-confinement.md).

## Problem

In the packaged Mac app the server and the Runner run as the logged-in user, and so does every agent session. Measured on 2026-11-17 (0.1.57–0.1.95): a session read `home/token` (owner token), `runner/machine.json` (machine token) and `home/server/server.db`, called the server API as the owner, called `/api/machine/token/<stepId>`, and wrote to `server.db`. The command gate blocks `ask` commands, but a session wrote the command into a script and ran the script; the gate matches command text, not what a process may touch, so it cannot be the boundary.

Two facts from the research change the scope:

1. **No harness adapter launches through `confine.ts` yet, on Linux either.** Only the startup preflight does. This design therefore needs a platform-neutral launch seam in the adapters; the Linux adapter migration is the same work.
2. **A Seatbelt profile enforces the needed denials for the whole process tree**, including a script the session writes and runs (实测 in the research note). A nested profile cannot be applied, so the harnesses' own sandboxes must be off and Cairn's profile is the only one.

## Threat model

The session is an LLM-driven process with shell and file tools, running as the user, prompt-injectable, and not trusted with Cairn's own credentials. In scope: reading or writing Cairn's secrets and state, impersonating the Runner or owner, reading the user's other credentials, writing outside its own worktree. Out of scope, stated as trust exceptions (same as Linux): readable non-denied host files, full outbound internet, shared devices, shared caches, and processes started outside the sandbox by the user.

## Paths a session must not read or write

Paths use the packaged layout; `userData` is `~/Library/Application Support/@cairn/desktop`. The policy takes them from the running app's actual configuration (`CAIRN_HOME` values, `config.workspacesDir`), not hard-coded strings.

| Path | Read | Write | Why |
| --- | --- | --- | --- |
| `userData/home/` (server home: `token`, `server/server.db`, skills source, uploads) | deny | deny | owner token; server database |
| `userData/runner/` (Runner home) except the entries below | deny | deny | `machine.json` machine token, `device.json`, `daemon.log`, outbox, reports, `chat-sessions`, `agent-runtime` |
| `runner/workspaces/<this session's worktree>` and the git common directory of its repository | allow | allow | the work; `.git/config`, `.git/config.worktree`, `.git/hooks` and any `.git` pointer file stay write-denied, as on Linux |
| `runner/workspaces/` siblings (other conversations, project `repo/` caches) | deny | deny | other tasks' code and credentials in remotes |
| The harness's own state: `runner/claude` (Claude config dir, `CLAUDE_CONFIG_DIR`), the Codex dir, pi `agentDir` | own only | own only | other harness state denied, as on Linux |
| Per-session temp (`$TMPDIR` under `/private/var/folders/...`) | allow | allow | tools need it |
| Shared caches (`~/.cache`, resolved pnpm store, `~/.npm`, Go modules, Cargo registry, `~/Library/Caches` subset needed by toolchains) | allow | allow | same list as Linux; none may contain a denied root |
| `~/.ssh`, `~/.gnupg`, `~/.aws`, `~/.config/gh`, `~/.docker`, `~/.kube`, `~/.password-store`, `~/.netrc`, `~/.git-credentials` | deny | deny | existing Linux list |
| `~/.claude`, `~/.codex`, `~/.pi`, `~/.gemini`, `~/.claude.json` (user's own CLI logins) | deny except the harness's own state | same | existing Linux list |
| `~/Library/Keychains`, `~/Library/Application Support/Google/Chrome` (and Chromium/Firefox/Safari profiles, `~/Library/Cookies`), `~/Library/Mail`, `~/Library/Messages` | deny | deny | Mac equivalents of the browser and credential entries |
| Everything else | allow (read) | deny | parity with Linux read-only root; toolchains live in the home directory |

Network: deny outbound connections to the server's loopback port. The Runner already holds the machine token and talks to the server for the session (`machine-client.ts`); sessions get no server credentials and have no reason to reach it. Other loopback ports stay open so a session can run and test its own dev servers. This is defence in depth: with the token files unreadable, an unauthenticated call reaches no owner route. Internet access stays open.

Apple Events are an open escape: `osascript` to Finder and `open -a` still work under `(deny appleevent-send)` and under `(deny mach-lookup ...)` for the appleevents and launchservicesd names (实测 2026-11-17, macOS 27.2). The profile does not claim to block them; finding the right Mach service names (srt's source) is an open item, and until then a session can start an unsandboxed app.

Known gap, same as Linux: a deny list. A secret kept in a path nobody listed stays readable. The first mitigation is that Cairn's own state lives under two roots that are denied wholesale.

## How the Runner launches a session under the sandbox

One module, `apps/daemon/src/backend/confine.ts` (seam stays inside `backend/`), gains a macOS backend next to the bwrap one. Both take the existing `ConfinementPolicy`; a new `seatbeltProfile(policy)` returns SBPL text, a golden-file tested pure function, and `confineCommand(policy, command, env)` returns `{ command, args, env }` for the platform. On macOS that is `/usr/bin/sandbox-exec -p <profile> -- <command> ...`. The profile carries no secrets (paths only) and may sit in argv.

```
(version 1) (allow default)
(deny file-write*)
(allow file-write* <worktree> <git dirs> <task temp> <own state> <caches> /dev/null /dev/tty* /dev/fd)
(deny file-read* file-write* <each denied root>)      ; userData/home, userData/runner, credential dirs
(allow file-read* file-write* <this session's worktree> <git dirs> <own state>)   ; later rule wins
(deny file-write* <.git/config> <.git/config.worktree> <.git/hooks>)
(deny network-outbound (remote ip "localhost:<server port>"))
```

Rule order matters in SBPL (last match wins); the generator emits denied roots first, then the narrow re-allows, then protected-file denies, and a unit test asserts that order, mirroring Linux's "denied-parent masks, narrowly re-exposed paths, protected-file masks".

| Runtime | Seam | Change |
| --- | --- | --- |
| Claude Code | SDK option `spawnClaudeCodeProcess` (`claude-code.ts`, `spawnWithOAuthTokenOnFd`). Always install it, with or without the OAuth FD | spawn `sandbox-exec ... claude` with a cleared, allowlisted environment; leave the SDK's own `sandbox` off |
| Codex (ACP) | `AcpBackend` `spawnProcess` (`acp.ts:389`) | same prefix; require `full-access` mode after `session/new` and resume so Codex's own Seatbelt is off |
| Gemini (ACP) | same `spawnProcess` | same prefix |
| Pi | today the session, its file tools and its Bash tool run inside the Runner process (`pi.ts`), so a profile on the Bash tool alone leaves the Read/Edit tools able to read the token | move the Pi session into a child, `cairn-daemon pi-host`, speaking the versioned JSONL protocol already specified in the Linux design ("Pi protocol and state ownership"), launched through the same seam. No in-process fallback |
| `claude-code-bin.ts`, `claude-code-auth.ts` probes | direct `execFile` | go through the seam, or are declared not session launches and tested as such |
| `step-local-tools`, git helpers, `local-merge` | Runner's own work | not session launches; unchanged |

Runner-side start sequence on macOS: the Runner builds the policy from the claimed step (worktree, git dirs, temp, own state), generates the profile, spawns the confined process in its own process group (`detached`), and tracks the group. Stop and abort signal the group (`kill(-pgid)`), and the Runner's existing supervisor kills leftover groups after a crash. macOS has no cgroups, so this is weaker than the Linux ownership model: a descendant that calls `setsid` escapes group kill. It stays confined (the profile is inherited) but can outlive the step. Accepted for macOS; the sandbox, not process accounting, is the security property here.

Environment: pass only the allowlisted variables the step already assembles (`step-env.ts`), plus none of the Runner's inherited environment. Today `runnerEnv` hands the Runner's whole `process.env` and server origin to its children; the session must not get the server origin either.

The command gate stays as a policy layer for `ask` commands, but the design states plainly that the sandbox, not the gate, is the boundary.

## When the sandbox is unavailable

Same contract as Linux: an isolation failure is machine unavailability, never repeated task failure, and never a raw fallback.

- Startup preflight on macOS runs the real launch path against a scratch directory: apply the profile, then assert that a sentinel file in a denied root cannot be read, that a write to the scratch worktree succeeds, and that a write outside it fails. Pass means `ready`; any failure means `unavailable` with a bounded reason (`sandbox-exec-missing`, `profile-rejected`, `probe-failed`).
- `confinement-availability.ts` currently reports macOS as `not-applicable` and leaves dispatch unchanged. This changes to `checking → ready/unavailable` on macOS, using the existing observation fence, machines-page reason and one-notification-per-outage path. The reason enum in `@cairn/shared` gains the macOS values.
- Missing `/usr/bin/sandbox-exec` (Apple removing it) makes macOS machines unavailable with a repair message. No sandboxless mode. This is the consequence of fail-closed; decision 2 below.
- Explicit recheck after repair reuses the same preflight; no timer loop, as on Linux.
- Rollout: enforcement ships with all three runtimes migrated. Shipping it per runtime would leave a runtime either unsandboxed or unusable on Mac.

## Tests

Red first, in this order. Test file `apps/daemon/test/mac-session-confinement.test.ts`, run on macOS only (`describe.runIf(process.platform === 'darwin')`), plus pure tests that run everywhere.

1. **Today's hole (must be red now, green after).** Create a temp layout that mimics the app: `<tmp>/home/token` and `<tmp>/home/server/server.db` (a real SQLite file), `<tmp>/runner/machine.json`, `<tmp>/runner/workspaces/a` (the session worktree) and `workspaces/b`. Launch the real Claude Code spawn seam with a recording harness stand-in (a script that runs the probe commands) under the policy for worktree `a`. The probe: `cat token`, `cat machine.json`, `sqlite3 server.db 'insert ...'`, a script written into the worktree that `cat`s the token (the exact bypass seen on 2026-11-17), `ls workspaces/b`, a write to `<tmp>/escape`, and an HTTP request to a local test server standing in for the Cairn server. Assert every secret read and escape write fails, the worktree write succeeds, and the test server saw no request. On current `main` the seam does not wrap the process, so `cat token` succeeds and the test fails; that failure is the recorded negative control.
2. Same probe through the Codex `spawnProcess` seam and the Pi `pi-host` child. A Pi file-tool read of the token (not just Bash) is a separate case.
3. `seatbeltProfile` golden text per runtime profile; rule order test (denied roots, re-allows, protected files); the deny and allow sets are identical across Claude, Codex and Pi except the own-state entry; overlap rejection (a cache aliasing a denied root) as on Linux.
4. Structural test: no file under `apps/daemon/src/backend/` other than `confine.ts` imports `node:child_process`, and no adapter spawns without the seam (extends the Linux structural rule).
5. Availability: `sandbox-exec` missing, profile rejected, probe failure each mark the machine unavailable and start no step; no claim is made while unavailable; one outage notification.
6. Real-harness e2e on the Mac with a fake model endpoint scripting `cat <sentinel>; touch ~/escape` through Claude Code, Codex and pi, asserting denial (the plan already in the 2026-11-08 research, §4.2).
7. A runtime-startup check per harness under the profile (Claude 2.1.325 and Node start fine, 实测; Codex and pi are unmeasured).
8. Items the research left open, each with a test before they are relied on: signal denial against the Runner and other processes, `open`/LaunchServices, Keychain item reads, `.git` pointer-file worktrees, the oldest supported macOS.

Verification evidence for the implementation: the red-then-green log of test 1, plus an end-to-end session in the packaged Mac app that tries to read the owner token and fails.

## Decisions

Approved by ian on 2026-11-17, all as recommended: Seatbelt (not a separate user); fail closed; one platform-neutral adapter seam, Mac first, Linux bwrap plugs in later; deny only the server loopback port; Pi moves to a `pi-host` child; macOS CI job for the probe; enforce only when all runtimes are migrated.

## Implementation segments

| Segment | Content | State |
| --- | --- | --- |
| 1 | `confine-seatbelt.ts` (`seatbeltProfile`, `seatbeltCommand`), golden/order/overlap tests, the Mac probe test with its unconfined negative control (`apps/daemon/test/confine-seatbelt.test.ts`) | landed |
| 2 | Policy source: build `SeatbeltPolicy` per step from the Runner config (server home, runner home, worktree, git directories, own state, caches, server port); thread it to the adapters | pending |
| 3 | Claude Code (`spawnClaudeCodeProcess` always installed), Codex and Gemini (`spawnProcess`) through the seam, with `full-access` and inner sandboxes off; structural test | pending |
| 4 | `pi-host` child and JSONL protocol | pending |
| 5 | macOS availability (`checking/ready/unavailable`, reasons, preflight probe), shared capability enum | pending |
| 6 | macOS CI job; packaged-app end-to-end proof; enforcement switched on once 2 to 5 are in | pending |

Segment 1 changes nothing at runtime: no adapter calls it yet, so Mac sessions stay unconfined until segments 2 to 5 land.
