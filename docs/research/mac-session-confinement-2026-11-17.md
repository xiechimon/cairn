# Confining agent sessions on macOS: prior art

Date: 2026-11-17. Design that cites this note: [mac-session-confinement](../design/mac-session-confinement.md).
Marks: 实测 = read or run first-hand this session; 推断 = derived from 实测; 猜测 = the rest.

## Question

On macOS the Cairn Runner starts Claude Code, Codex (ACP) and pi sessions with the user's full home. A session read the owner token, the machine token and the server database in the packaged app, and edited the database. What do comparable agents use on macOS, what do they block, and where does each fall short?

## What Cairn has today (实测, commit `3722f8e0c`)

| Fact | Evidence |
| --- | --- |
| `confinementArgs` throws `Harness confinement requires Linux` on any other platform | `apps/daemon/src/backend/confine.ts:63` |
| `launchConfined` (bwrap under a systemd user unit, start gate, cgroup cleanup) is called only by the startup preflight in `confinement-availability.ts`. No harness adapter calls it: `claude-code.ts`, `acp.ts` and `pi.ts` spawn directly (`spawn` at `claude-code.ts:1164`, `acp.ts:389`; pi runs in the daemon process and its Bash tool uses `createBashToolDefinition` at `pi.ts:1184`) | `grep -rn "launchConfined\|bwrap" apps` finds only `confine.ts` and `confinement-availability.ts` outside tests |
| The Linux design says adapter migration is a later segment (`docs/design/linux-harness-confinement.md`, "Ownership segment contract") and that macOS reports `not-applicable` with dispatch unchanged | design doc |
| That design also records "No Seatbelt implementation: its proposed file policy cannot meet daemon-PID isolation" | same doc, decision table |
| The Mac app runs the server and the Runner as the logged-in user. Server home is `userData/home` (owner `token`, `server/server.db`); Runner home is `userData/runner` (`machine.json`, `claude/` config dir, `workspaces/` by default, `daemon.log`) | `apps/desktop/src/main.ts:56`, `:347`; `apps/desktop/src/runner.ts` (`writeMachineJson`, `CLAUDE_CONFIG_DIR`); `config.ts:55`; `ls` of the installed app |

**Correction to the task brief:** bwrap exists and is tested, but it does not yet wrap harness sessions on Linux either. Only the preflight uses it (推断 from the grep above). A macOS design therefore has to include the adapter seam, and the same seam work fixes Linux.

## What the Linux policy hides (实测, `confine.ts`)

Root is mounted read-only; `/tmp` is a fresh tmpfs; the home directory is an overlay so writes vanish; the daemon home and `/run` are masked with empty read-only tmpfs mounts; `~/.ssh`, `~/.gnupg`, `~/.aws`, `~/.config/gh`, `~/.docker`, `~/.kube`, `~/.password-store`, Chrome/Chromium profiles, `~/.claude`, `~/.codex`, `~/.pi`, `~/.gemini`, `.netrc`, `.git-credentials` and `.claude.json` are masked (files by `/dev/null`); only the worktree, git directories, task temp, the harness's own state and shared caches are writable; `.git/config`, `config.worktree` and `hooks` are read-only inside writable git directories; PID namespace hides daemon PIDs; network and `/dev` are shared. Only the environment passed through the start gate reaches the harness.

## Mechanisms on macOS

### Seatbelt via `sandbox-exec` (SBPL profile)

First-hand on macOS 27.2 (`/usr/bin/sandbox-exec`, profile `(allow default)` + `(deny file-write*)` + writable subpaths + `(deny file-read* (subpath <secret>))`), 实测:

| Probe under the profile | Result |
| --- | --- |
| `cat` of a file in the denied subpath | `Operation not permitted` |
| read of a non-denied file; write inside the allowed workspace | allowed |
| write elsewhere in the same parent directory | denied |
| denied file read through a script written into the workspace and run | denied (the child inherits the profile, so the script bypass that defeated the command gate does not work) |
| symlink in the workspace pointing at the denied file | denied |
| `cp` and `mv` of the denied path into the workspace; `ls` of the denied directory | denied |
| `sqlite3` creating a database in the denied parent | denied |
| `sandbox-exec` inside the sandbox (nested profile) | `sandbox_apply: Operation not permitted`, rc 71 |
| `curl` to an external HTTPS host; `curl` to a loopback HTTP server | both allowed with `(allow default)` |
| same with `(deny network-outbound (remote ip "localhost:*"))` | loopback refused, rc 7 |
| `claude --version` (2.1.325) and Node 24 inside the profile | run normally |
| `osascript` to Finder with `(allow default)` | works, so Apple Events are an escape unless denied |
| `(deny signal (target others))` then `kill` of a sibling | **not blocked in my test (rc 0)**; unresolved, the test must be rebuilt before relying on it |
| `ps` through `sandbox-exec` | the exec of `/bin/ps` was refused in the first profile; unexplained (SIP binaries under a restrictive write profile), not investigated |

Consequences (推断 from the table): a subpath deny enforced in the kernel covers the whole process tree and every tool the session spawns, so the owner token, machine token and `server.db` can be made unreadable and unwritable without a second process. A later `allow` for a nested path wins over an earlier `deny`, so re-exposing one worktree under a denied Runner home is one rule, unlike bwrap's mount ordering. A second Seatbelt profile cannot be applied inside, which is why Cairn must switch the harnesses' own sandboxes off and keep one policy (the earlier plan said the same, `user-computer-model-2026-11-08.md` §4.2, there marked 猜测; now 实测).

Known limits:

- Apple marks `sandbox-exec` deprecated (man page: use App Sandbox instead). Several projects report it works on Sequoia and later, none gives a removal date; no supported replacement exists for sandboxing a command-line process ([WebSearch summary](https://jmmv.dev/2019/11/macos-sandbox-exec.html), [Trail of Bits seatbelt-sandboxer](https://mintlify.com/trailofbits/skills/plugins/seatbelt-sandboxer)). 实测 that it works on 27.2.
- Profiles are hard to get right: temp directories (`/private/var/folders`), `/bin/sh` mapping to bash, TLS trust daemon, Mach services. Go tools (`gh`, `gcloud`) fail TLS under a network-restricted profile unless `com.apple.trustd.agent` is allowed, which opens an exfiltration path ([Claude Code sandboxing](https://code.claude.com/docs/en/sandboxing)).
- Apple Events and `open` let a sandboxed command start an unsandboxed app; both Claude Code and srt block Apple Events by default and warn that enabling them removes isolation (same page; [srt](https://github.com/anthropic-experimental/sandbox-runtime)).
- A user-id sandbox does not stop the process calling a localhost service. Claude Code's docs: a localhost service that needs no authentication "can then act for the command outside the sandbox" (same page). Cairn's server on loopback is exactly that service.
- Keychain: the sandboxed `security` CLI ran and reported its own error, not a permission error (实测 with a nonexistent item). Whether an existing item is readable under `(allow default)` is unmeasured.

### Claude Code's native sandbox (Seatbelt, built on `@anthropic-ai/sandbox-runtime`)

Source: [Claude Code sandboxing](https://code.claude.com/docs/en/sandboxing), [srt](https://github.com/anthropic-experimental/sandbox-runtime) (both 实测 as read today).

- Covers shell commands only. Built-in Read/Edit/Write/WebFetch, hooks, local MCP servers and other child processes are outside it and follow permission rules.
- Defaults: writes to the working directory and temp; reads of most of the machine **including `~/.ssh` and `~/.aws/credentials`**; network only through a local proxy with an empty allowlist; environment inherited, secrets included.
- Escape hatches: `dangerouslyDisableSandbox` retry, `excludedCommands`, filesystem-off mode. `failIfUnavailable` is off by default: without it the harness runs commands unsandboxed when the sandbox cannot start.
- srt (the library): reads deny-then-allow, writes allow-only; `denyWrite` beats `allowWrite`; masked credential files become unreadable on macOS; unix sockets blocked by default; loopback blocked unless `allowLocalBinding`.
- Trade-off: it protects the user's machine from a cooperating-but-fallible agent. It does not protect the host application's own secrets by default, and it leaves non-Bash tools unconfined, so it is not a boundary around Cairn's Pi file tools or an MCP child.

### Codex CLI

Source: [codex-rs/core README](https://github.com/openai/codex/blob/main/codex-rs/core/README.md) (实测). Seatbelt through `/usr/bin/sandbox-exec`, which must exist; workspace-write allows writes under configured roots and keeps `.git` (directory or pointer file), the resolved `gitdir` target and `.codex` read-only; network follows the sandbox policy. The page documents no macOS-specific limit and does not describe the read policy. Same shape as the Cairn plan: whole-process profile, protected paths inside writable roots.

### App Sandbox (entitlements)

A signed app opts in with `com.apple.security.app-sandbox`; a child inherits it. It is designed for the app that carries the entitlement, with per-container home and user-granted file access ([Apple documentation, secondary summaries only in the search](https://book.hacktricks.xyz/kr/macos-hardening/macos-security-and-privilege-escalation/macos-security-protections/macos-sandbox)). 推断: it fits an app that is sandboxed from birth, not a Node runtime and arbitrary toolchains (git, pnpm, compilers) that the session must run against the user's real files. Applying it to the Runner would also sandbox the Runner's own claim loop and git operations. Not measured; not recommended.

### A separate macOS user

Run sessions as a second account (`sudo -u`, or a dedicated `_cairn` user). File permissions then separate the home directories without any profile. 推断: this is the strongest filesystem boundary, but it needs an administrator account and password to create the user and to grant `sudo`, a per-user toolchain (Homebrew, fnm, CLI logins, Claude and Codex auth live in the owner's home), shared worktree ownership, and a packaged installer step. Cairn's current Mac install is a drag-install app. Not measured here (creating a user needs `sudo`). Cairn's earlier decision was a single mandatory launcher per platform ([linux-harness-confinement](../design/linux-harness-confinement.md)), and a second user would not remove the loopback-service problem either.

### Containers and VMs

Docker Desktop or Apple's `container`/Virtualization.framework give the strongest isolation but a different filesystem and toolchain from the user's Mac, and are outside what an installed Mac app can assume. The retained Linux "orb" path already covers this case for those who want it. Out of scope.

## Comparison

| Option | Blocks | Does not block | Cairn fit |
| --- | --- | --- | --- |
| Seatbelt profile around the whole harness process (Cairn-owned) | any file read/write by path, for every tool in the tree; optionally loopback network | the same-uid server API on loopback unless network is restricted; Apple Events unless denied; things not expressible in SBPL | closest match to the Linux policy; 实测 works today |
| Claude Code native sandbox | Bash tree only | Read/Edit/Write tools, MCP children; `~/.ssh` readable by default; falls back to unsandboxed unless `failIfUnavailable` | not a boundary for Cairn's secrets |
| Codex native sandbox | its own commands, `.git` | does not confine Claude or pi; Cairn would run it with its inner sandbox off | cannot be the one policy |
| App Sandbox | the entitled app | wrong shape for arbitrary child toolchains | no |
| Separate macOS user | everything by permission | needs admin setup and per-user toolchains | possible later hardening |
| Container/VM | everything | different environment | out of scope |

## Pattern that fits

One Cairn-owned Seatbelt profile, generated from the same `ConfinementPolicy` that drives bwrap, wrapped around the whole harness process (Claude Code, the Codex ACP adapter, and a child process hosting the Pi session) with every inner sandbox off. This is what the Linux design already decided and what Codex and srt do per command; Cairn applies it per session so non-Bash tools are covered too. Fail closed when the profile cannot be applied: the Runner reports unavailable and starts no session.

The recommendation, code areas and open decisions are in the design note. Items this research did not settle and the implementation must measure: signal denial, `ps`/`kill` behaviour, Keychain reads, Apple Events denial, `open`/LaunchServices, `.git` pointer files in worktrees, per-harness startup under the profile (Codex and pi were not run here; Claude 2.1.325 and Node 24 were), and behaviour on the oldest supported macOS.

## Sources

- [Claude Code sandboxing](https://code.claude.com/docs/en/sandboxing) — read today.
- [sandbox-runtime (srt)](https://github.com/anthropic-experimental/sandbox-runtime) — README read; profile generator source not read.
- [Codex core README](https://github.com/openai/codex/blob/main/codex-rs/core/README.md) — read today; source of `seatbelt.rs` not read.
- [jmmv on sandbox-exec](https://jmmv.dev/2019/11/macos-sandbox-exec.html), [Trail of Bits seatbelt-sandboxer](https://mintlify.com/trailofbits/skills/plugins/seatbelt-sandboxer) — search results only, not opened; used for the deprecation status. Apple's own `sandbox-exec(1)` man page was not opened; the "deprecated" wording is from the search summary (猜测 on exact text).
- Cairn: `apps/daemon/src/backend/confine.ts`, `confinement-availability.ts`, `docs/design/linux-harness-confinement.md`, `docs/research/user-computer-model-2026-11-08.md` §4.2.
- Not covered: `agent-reach` was not run for this note; sources were fetched with WebFetch.
