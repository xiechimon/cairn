# Task confinement and credential isolation

Date: 2026-11-22
Status: retired (OS task confinement removed in commit `0b0d06261`). Issues: #5006 (macOS Seatbelt confinement for task harnesses), #5393 (credential isolation for lane sessions), #5395 (dispatch ticket for #5006). Related: #4948, #4986, #5398, #2344, #4543, #4604.
Prior art: [mac-session-confinement-2026-11-17](../research/mac-session-confinement-2026-11-17.md), [user-computer-model-2026-11-08](../research/user-computer-model-2026-11-08.md) §4.2, [owner-approval-channel-2026-11-22](../research/owner-approval-channel-2026-11-22.md), [2026-11-22-task-confinement-prior-art](../research/2026-11-22-task-confinement-prior-art.md).
Marks: `实测` = read or run first-hand this session (this worktree at `90d925df4`, or a command on the owner's Mac `studioMac-0001`, macOS 27.2); `推断` = derived from `实测`; `猜测` = the rest. Partial work from the failed 2026-11-21 Cairn tasks is mined at `origin/cairn/conv-01a1fa64` and `origin/cairn/conv-01a1fa87`.

## Newcomer

Someone who installed the Cairn Mac app today and runs a task — a "fix this bug" card that Cairn dispatches to a runner on their own Mac. Under the card, Cairn starts an agent process (Claude Code, pi, or an ACP adapter such as Gemini, Devin or Antigravity) as that user's own account, in a checkout under the runner's workspaces directory.

What is already true on `main`: that agent process runs inside a Cairn-owned Seatbelt profile (`sandbox-exec`), so it cannot read the Cairn app home, the owner token, `~/.ssh`, the login Keychain files, or browser profiles, and it cannot reach the server's loopback port. The triage comments on #5006/#5393 saying "task harnesses report `not-applicable` and run unconfined" were measured against an older bundled runtime; on this worktree the session confinement shipped 2026-11-17 (`dbeee0a18`, `3d10b10ff`, `bb21fb5de`) and the daemon reports `ready` after a real probe (`实测` — `confinement-availability.ts:155-172` runs `runSeatbeltProbe` on darwin and the server refuses dispatch until `ready`, `machine-capabilities.ts` `confinementEnforced`).

What is still true, and what this doc designs:

- The deny list is an older, shorter one. On the owner's own Mac the real credential stores sit under `~/.config` (`cairn/*.env`, `gh`, `devin`, MCP envs — measured 2026-11 in `docs/verify/2344`), `~/.npmrc`, `~/Library/pnpm/rc`, `~/.local/share/{cairn,devin,opencode}`, shell rc files, and the Electron app's own cache/cookie stores. None of those are denied today (`实测`: `confine.ts` DENIED lists cover only `.config/gh`, `.config/containers`, `.config/{google-chrome,chromium}`), so a confined session can still `cat ~/.config/cairn/slack-app.env`.
- The login Keychain is better covered than first feared — the `~/Library/Keychains` file deny in the shipped profile already makes `SecItemCopyMatching` return `errSecNoSuchKeychain` (`实测` by the prior-art probe on macOS 27.2.1, and worth keeping: on this very Mac the user's personal Claude Code OAuth credentials live in `login.keychain-db` as `Claude Code-credentials`, `实测` by prior-art inspection). The holes left are the **system keychain** (`/Library/Keychains`, not denied — WiFi passwords, enterprise certs) and the **Antigravity carve-out** (`confine-session.ts` grants `Library/Keychains` readable to antigravity, which re-opens the whole login keychain to that runtime). The tempting fix — mach-denying `com.apple.SecurityServer` — is wrong: that service also carries TLS validation, which is why Codex and sandbox-runtime allow it; file denies are the right layer.
- A same-uid process can read the runner's and server's full environment block through `KERN_PROCARGS2` (`实测` today: 1804 and 2268 bytes, `CAIRN_OTEL_HEADERS` present), and Seatbelt cannot deny that sysctl for numeric-MIB callers (`实测`: no `sysctl-read`/`process-info*` rule fires). So "no credential may live in the env of a process the session can see" is a design rule this doc has to enforce.
- Per-step git credentials are delivered through a token file under `<daemonHome>/homes/pi/` — a denied root for every runtime except pi, so Claude Code and ACP sessions on macOS cannot read their own step credential today (`推断` from `step-app-credential.ts` + `confine-session.ts` state list).
- The repo-controlled workspace hooks `.agents/setup` and `.agents/resume` run unconfined as the daemon user on every platform (`实测`: `workspace-hooks.ts:74` spawns with no confiner).
- On Linux, sessions are still unconfined: `createSessionConfiner` returns null off-darwin and `launchConfined` only runs the availability preflight (`实测`: `confine-session.ts:143`; `runtime-home.md` documents "Linux: agents run unsandboxed today, visibly").

What it costs the user: nothing new to configure. On the Machines page the runner shows `sandbox: ready` or `unavailable` with a repair reason; a broken sandbox means no task dispatch on that machine, never an unconfined fallback. When it fails, the user sees the machine card carry `confinement: unavailable` and a task that stays `pending` — the existing availability contract from `linux-harness-confinement.md`/`mac-session-confinement.md`, unchanged.

## The threat, measured on this Mac today

The session is an LLM-driven process with shell and file tools, prompt-injectable, running as the owner, that must not hold Cairn's or the owner's other credentials. Same trust boundary as `mac-session-confinement.md` §"Threat model". Out of scope stays: readable non-denied host files, full outbound internet, shared caches, shared devices, and processes the user starts outside the sandbox.

Read-only measurements on `studioMac-0001` (macOS 27.2, this session, all `实测`):

| Channel | Result today | Evidence |
| --- | --- | --- |
| File read under the session profile's deny list | denied (`Operation not permitted`), incl. via a script the session writes and runs | sandbox-exec probe this session; `confine-seatbelt.test.ts` negative control |
| `cat ~/.config/cairn/<file>` inside the shipped profile | **allowed** — `~/.config` is not a denied root | `confine.ts:25-51` DENIED lists |
| `security find-generic-password` inside `(allow default)` | **reaches securityd** — the lookup runs | probe this session |
| `security`/`SecItemCopyMatching` under `file-read*` deny on `~/Library/Keychains` | **blocked** — `errSecNoSuchKeychain` / "item could not be found": the keychain db is a file read, so the file deny covers the API path with no mach deny needed. Caveat: `security` prints the same message for a genuinely-missing item, so the CLI alone cannot distinguish the two — the `SecItemCopyMatching` result is the distinguishing probe | prior-art probe on macOS 27.2.1, `2026-11-22-task-confinement-prior-art.md`; consistent CLI re-probe this session |
| `security find-generic-password` with `(deny mach-lookup (global-name "com.apple.SecurityServer"))` | blocked — `SecKeychainSearchCreateFromAttributes` error; **but** SecurityServer also serves TLS validation — Codex/srt allow it for that reason, so the deny is *not* the chosen fix | probes this session + prior-art report |
| `/Library/Keychains` (system keychain — WiFi passwords, enterprise certs) | **readable** — not on any deny list | `confine.ts` lists (`实测` by inspection) |
| `kill -0 <runner pid>` under `(deny signal)(allow signal (target same-sandbox))` | denied outside the sandbox, allowed on own descendants | probe this session |
| `kill -0 <runner pid>` under `(deny process-info*)` only | **still allowed** — `process-info*` does not gate signals | probe this session |
| Other-process env via `KERN_PROCARGS2` (numeric MIB, `sysctl(2)`) | **readable**: runner pid 34979 → 1804 bytes, node utility 34963 → 2268 bytes; env names include `CAIRN_OTEL_HEADERS`, `CAIRN_OWNER_CHANNEL`, `CAIRN_CONFINE_DENIED_ROOTS`, `SSH_AUTH_SOCK` | ctypes probe this session |
| `KERN_PROCARGS2` under `(deny sysctl-read (sysctl-name-prefix "kern.procargs"))`, `(deny sysctl-read (sysctl-name "kern.procargs2"))`, `(deny process-info*)`, or any `process-info-*` sub-op | **still readable** — name-based rules do not fire for a numeric-MIB lookup; a name-based deny *does* fire for `sysctl -n kern.hostname`, so the deny mechanism itself works | probe this session |
| `(deny sysctl-read)` wholesale | breaks `uname()` — too broad to ship | probe this session |
| `ssh-add -l` inside `(allow default)` | **reaches the agent** — the owner's launchd socket `/var/run/com.apple.launchd.*/Listeners` is usable | probe this session |
| `ssh-add -l` inside the shipped profile's unix-socket denies | blocked (`Operation not permitted`) — `TEMP_SOCKET_DENY` covers the launchd socket class | probe this session; `confine-seatbelt.ts:34` |
| `open -a TextEdit` inside the profile's mach denies | blocked ("Unable to find application") | probe this session; `confine-seatbelt.ts:30` |
| Owner token file `~/Library/Application Support/@cairn/desktop/home/token` | exists, mode 0600 — same-uid readable outside the profile, denied inside it | `stat` this session (metadata only; `~/.cairn` not opened) |
| Nested `sandbox-exec` inside a profile | a second profile that adds restrictions **fails** — `sandbox_apply: Operation not permitted`, exit 71; an `(allow default)` inner profile applies as a no-op. Inner harness sandboxes must stay off, and a confined task cannot escape via `sandbox-exec` | probe this session |
| Same-uid `task_for_pid` / memory | not seatbelt-deniable; unsigned Electron build is inspectable | `owner-approval-channel.md` residuals (`实测` there) |
| `launchctl` user-domain verbs | not seatbelt-deniable — the bootstrap port is inherited; agent `kickstart` is a partial escape class | same residuals row |

Secrets and where they sit (`实测` from code + the env probe above):

| Secret | Where it lives | Readable by a confined session today? |
| --- | --- | --- |
| Owner Bearer token | `userData/home/token` (0600, same uid) | no — server home is a denied root on the desktop |
| `server.db` | same root | no |
| Machine token | `runner/machine.json`, held in memory as `inMemoryToken` (`machine-loop.ts:656`) | no — daemon home denied |
| Device identity | `runner/device.json` | no |
| Step provider key | resolved server-side (`credentials.ts` `resolveStepCredentials`), delivered in `MachineTokenResponse` to the daemon, passed to the session via env (`ANTHROPIC_API_KEY`-class) or the pi initialize frame | yes — its own credential, by design |
| Claude subscription token | server secret box → `CLAUDE_CODE_OAUTH_TOKEN` env (FD 3 inside orbs) | yes — its own |
| Devin / Antigravity tokens | `WINDSURF_API_KEY` / `GEMINI_API_KEY` env, or symlinked oauth files under a prepared isolated home (`agent-config.ts`) | yes — its own |
| Per-step git credential | `git-step-*` key in env (`CAIRN_GIT_CRED_PASSWORD`, `GH_TOKEN`, `GITHUB_TOKEN`), or GitHub App token via `StepAppCredential` file + `GH_CONFIG_DIR` under `<daemonHome>/homes/pi/step-<id>-github/` | env path: its own; **file path: denied for claude-code/ACP** — the dir is under a denied root and not in `state` (`推断`, probe in test plan) |
| MCP connector secrets | `tokenRes.mcpConnectors` headers; `$VAR` resolution stays daemon-side (the sanctioned channel) | resolved values reach the session only where the endpoint needs them |
| Secret-grant vault values | `creds.secrets` → `opts.secrets()` → redaction + `$VAR` references | reference-resolved daemon-side; not env |
| Daemon/server env (`CAIRN_OTEL_HEADERS` and friends) | runner/server process env | **yes — `KERN_PROCARGS2`, not seatbelt-deniable** (`实测` above) |
| Owner shell envs (`GH_TOKEN`, `ANTHROPIC_API_KEY` exported in the user's terminals) | any same-uid process env | **yes — same channel; no SBPL deny exists** (`实测`) |
| SSH private keys | `~/.ssh` files | no — denied root; `SSH_AUTH_SOCK` reaches children through `childEnv` but the socket class is unix-denied (`实测` `ssh-add -l` fails inside profile) |
| Login Keychain items | securityd over mach, backed by `~/Library/Keychains` files | no — the file deny covers the API path too (`实测` `errSecNoSuchKeychain`), **except** for antigravity sessions whose profile re-exposes `Library/Keychains` readable |
| System keychain (`/Library/Keychains`) | securityd over mach, backed by `/Library/Keychains` files | **yes — not denied anywhere** (WiFi passwords etc.) |
| Other harnesses' state | `~/.claude`, `~/.codex`, `~/.pi`, `~/.gemini`, `~/.claude.json` | no — denied, own-state re-exposed per runtime |

## States

Confinement state machine is unchanged (`confinement-availability.ts`, `machine-capabilities.ts`):

`checking` → `ready` | `unavailable` (`startup-failed` | `cleanup-failed`, with a `ConfinementCause`), or `not-applicable` (non-Linux non-darwin). On darwin `ready` requires the existing sentinel probe to pass; on linux it requires `launchConfined` + cgroup cleanup proof. Dispatch requires current `ready` on enforced platforms (`confinementDispatchReady`). Session open adds two per-launch outcomes the doc relies on: `confine()` throws → the session open rejects before spawn (pi-host already fails closed, `pi-host-client.ts:377-382`); the profile cannot express a needed deny → the launch is refused, not silently weakened.

Credential states per step: `none` (verify steps — `git:null` + `READONLY_GIT_ENV`) → `resolved` (daemon holds the bundle, session not yet spawned) → `delivered` (env vars, frame fields, or the step credential dir readable inside the profile) → `revoked/expired` (App token refresh via `/api/machine/token/:stepId`, `StepAppCredential.refresh`, `dispose` deletes the dir). Delivered-but-unreadable is the new failure mode the dir placement must eliminate.

## Every path that launches a task harness or model process

"Task code" here means anything a claimed step can cause to execute, including repo-controlled content. Paths on `main`, `实测` by reading each call site:

| # | Path | Where | macOS today | Linux today | Seatbelt/bwrap profile | Credentials it legitimately needs and how it gets them |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Claude Code session | `claude-code.ts` `spawnClaudeProcess` via SDK `spawnClaudeCodeProcess` | **confined** — `confine` installed whenever a confiner exists (`:1633-1638`), profile from `createSessionConfiner` | unconfined (no confiner) | `seatbeltProfile` with `state=[CLAUDE_CONFIG_DIR (= homes/claude)]`; inner SDK `sandbox` stays off; FD-3 OAuth channel only inside orbs | env: `childEnv` base + step env — `ANTHROPIC_API_KEY`/`CLAUDE_CODE_OAUTH_TOKEN`, per-step git env or App cred file (broken by deny — fix below), `GH_CONFIG_DIR`, MCP headers inside SDK options, telemetry pins |
| 2 | pi session | `pi.ts` → `pi-host-client.ts` `openPiHostSession` spawns `cairn-daemon pi-host` | **confined** — `state=[agentDir, private session dir, resume file]` | unconfined, and runs **in the daemon process** (`openInProcess`, `pi.ts:1020`) | same profile, own-state = `homes/pi` + private dir | spawn env = `piHostEnv` (childEnv + 2 pins); provider key, step env, secrets and MCP config travel in the `initialize` frame on the private pipe (`实测` `serializableSession`) |
| 3 | ACP adapters: Codex (external `codex-acp`), Gemini, Devin, Antigravity managed installs | `acp.ts:651` `spawnProcess` | **confined** — `confine(opts, harness, launch)` before spawn; adapters get own-state per `ownState()` (Gemini: prepared `GEMINI_CLI_HOME`; Devin: prepared home; Antigravity: isolated home + `Library/Keychains` readable only when no API key — see open question) | unconfined | same profile; inner sandbox off (Codex `full-access` mode required) | `runtimeChildEnv(sessionEnv)` — step env; Antigravity OAuth via symlinked files in the prepared home; Devin via `WINDSURF_API_KEY` |
| 4 | Workspace hooks `.agents/setup`, `.agents/resume` | `workspace-hooks.ts:74` `spawn(path, …, detached)` | **unconfined** — repo code as daemon uid | unconfined | **new: wrap through the same confiner** (profile = step workspace, no harness state) | `childEnv` + step git creds env only — no model creds |
| 5 | Daemon-side git for steps: clone/fetch/push helpers (`git.ts`, `withStepGit` in `step-tooling`), local-merge checks (`local-merge.ts`, `step-local-merge.ts`) | daemon process | unconfined | unconfined | daemon trust domain — **not** a model process; runs Cairn's own code with machine/step creds. `core.hooksPath=/dev/null`, `core.fsmonitor=false` keep repo hooks and fsmonitor out | machine creds or step git creds in-process; correct by design, stays unconfined |
| 6 | Host MCP stdio children inside a session | spawned by the harness child (`pi-host` local MCP, Claude SDK MCP servers); daemon-side `mcp-stdio-client.ts` uses `childEnv` | inherits confinement | unconfined where the session is | inherits | endpoint env resolved daemon-side (`$VAR`); only the endpoint's own vars |
| 7 | Harness probes: `claude-code-bin` version, `claude-code-auth` status, managed install/version checks | daemon-side `execFile` | unconfined | unconfined | daemon trust domain — executes a managed binary with `CLAUDE_CONFIG_DIR=homes/claude`, no repo input | `childEnv` + config dir env |
| 8 | Verify steps (`attachmentVerify`) | same seams as 1–3 | confined (session profile) | unconfined | same profile | `git:null` + `READONLY_GIT_ENV` (no push path, no SSH agent, global/system gitconfig nulled), no App cred file |
| 9 | `localMerge` step kind (`runLocalMergeStep`) | daemon-side exec | unconfined | unconfined | daemon trust domain (git plumbing only) | step git creds in-process |
| 10 | Orb/container worker steps | `orb/` providers (Linux containers, Apple `container` on mac via `VmRuntime`) | container boundary, not Seatbelt | container boundary | n/a | creds delivered inside the guest — outside this doc's profile |
| 11 | Coordinator runtime | in-server (`apps/server/src/coordinator/runtime/`) | n/a — server process | n/a | explicitly out of confinement scope (`linux-harness-confinement.md`) | resolves creds server-side |
| 12 | Owner host shell (`CAIRN_OWN_COMPUTER`) | `computer/host.ts` via `createHostShellConfinement` | **confined** (host-shell profile) | **confined** (bwrap) | `hostShellProfile` — done (`owner-approval-channel.md`) | allowlisted env, no `CAIRN_*` |

Gaps this doc closes: row 4 (hooks unconfined), rows 1–3 and 8 on Linux (no confiner), and for all confined rows the credential-placement and deny-list defects from the threat table.

## The Seatbelt profile per path

One profile builder (`seatbeltProfile` in `confine-seatbelt.ts`), fed by `createSessionConfiner`. Changes:

### A. Deny-list expansion — mapping `scripts/ops/secret-reach/batch-sandbox.settings.json` onto the policy (#5393's core ask)

The batch `denyRead` list is the owner-measured inventory of where real credentials sit on this Mac. Mapping, `实测` against `confine.ts`/`confine-seatbelt.ts` current lists:

| batch-sandbox entry | Today in the session profile | Change |
| --- | --- | --- |
| `~/.cairn` | covered when daemon home is `~/.cairn` (standalone daemon) — the desktop passes runner + server homes as `deniedRoots` | keep; ensure `~/.cairn` is a denied root even when it is not the daemon home (add to MAC list) |
| `~/.config` | only `.config/gh`, `.config/containers`, `.config/google-chrome`, `.config/chromium` | **deny `~/.config` wholesale**; `allowRead` carve-out for `~/.config/git` (git identity lives there and holds no token on this setup — verify before shipping; batch does the same) |
| `~/Library/Application Support/@cairn` | only `home/` and `runner/` via `deniedRoots` | **deny the whole tree** — the Electron stores (`Cache`, `Cookies`, `Local/Session Storage`, `IndexedDB`, `databases`, `Preferences`) hold session cookies the file tools would otherwise read; `runner/workspaces` carve-out stays (worktree roots are re-exposed per session) |
| `~/.local/share/{cairn,devin,opencode}` | absent | add — agent credential stores |
| `~/.claude`, `~/.codex`, `~/.pi`, `~/.gemini`, `~/.claude.json`(+`.backup`) | present | add `~/.claude.json.backup` |
| `~/.ssh`, `~/.gnupg`, `~/.aws`, `~/.docker`, `~/.kube`, `~/.password-store`, `~/.netrc`, `~/.git-credentials` | present | keep |
| `~/.npmrc`, `~/Library/pnpm/rc` | absent | add — npm registry tokens |
| shell rc (`~/.zshrc` `.zshenv` `.zprofile` `.bashrc` `.bash_profile` `.profile`) | absent | add — rc files are both a secrets surface and code a login shell would run |
| package-manager creds (`~/.cargo/credentials.toml`, `~/.pypirc`, `~/.m2`, `~/.gradle`, `~/.gem`, `~/.terraform.d`, `~/.azure`, `~/.deno`, `~/.composer`, `~/.vercel`, `~/.netlify`) | absent | add |
| `~/Library/Keychains`, `~/Library/Application Support/{Google/Chrome,Chromium,Firefox,Safari}`, `~/Library/{Cookies,Mail,Messages}` | present (`MAC_DENIED_DIRECTORIES`) | keep — file deny is what blocks Keychain API reads (`实测`) |
| `/Library/Keychains` | absent | **add** — the system keychain (WiFi passwords, enterprise certs) is same-uid readable through securityd today |
| `~/Library/Application Support/Claude` | absent | add — Claude Desktop MCP keys |
| `~/Library/Application Support/Code` | absent | add — VS Code user data (extensions' stored secrets) |
| history files (`~/.zsh_history` `.bash_history` `.python_history` `.node_repl_history` `~/.local/share/fish`, `~/.aider.*`, `~/.cache/huggingface`) | absent | add — command-history leakage |
| `~/Library/Group Containers`, `~/Library/Containers` | absent | **not added** — too broad (app containers hold non-secret data and some are TCC-mediated anyway); named residual + open question |
| carve-outs `~/.cairn/{workspaces,plans,tools}`, `~/.config/git`, runner workspaces, runner-web-tools | workspaces/plans/tools come from the policy inputs (workspace, `handoffDirectories`, `readable`) | keep as policy inputs, not literals |

The batch `denyWrite` entries (`.claude`, `CLAUDE*.md`, `AGENTS*.md`, `.git`, `~/.cache/lane-tmp`, `~/Library/pnpm/rc`) are a **different** mechanism (trusted-write injection) — covered for sessions by the existing `.git` metadata write-deny; the `AGENTS.md`/`CLAUDE.md` write-injection class is a real residual for sessions too (a session can write `apps/web/AGENTS.md` inside its own worktree; the merge gate, not the sandbox, is the boundary for landing it — documented in `docs/verify/2344`, same class accepted here).

### B. Outside-process rules (from the `conv-01a1fa64` branch, corrected by today's measurement)

Adopt, `实测` working: `(deny signal)` + `(allow signal (target same-sandbox))`, `(deny process-info*)` + `(allow process-info* (target same-sandbox))` — a session cannot signal or inspect the runner, the server, or other tasks (signal probe verified working; process-info is harmless to keep as defense in depth).

Do **not** claim the `kern.procargs` sysctl-read deny: `实测` it does not fire for numeric-MIB `KERN_PROCARGS2` callers, so the env-read channel stays open in SBPL on macOS 27.2. Close the channel at the source instead:

- No credential may ride the env of any process a session can inspect. The daemon env already carries `CAIRN_OTEL_HEADERS` (`实测` in the runner's env block today) — move OTel headers (and any future `CAIRN_*_SECRET`) out of `process.env` into the already-denied `otel.env`-style file or the desktop `parentPort` channel; the daemon reads it at startup, env carries only a flag. Same rule for the server utility process (`CAIRN_OWNER_CHANNEL` already carries only a flag, correct).
- Session env vars contain only that session's own credentials — it may read them; it cannot read other sessions' env only if other sessions' env are likewise minimal, which `childEnv` already guarantees.
- The residual that remains: the **owner's own** processes (terminals with exported `GH_TOKEN` etc.) are env-readable by a confined session. No SBPL mechanism closes it; mark it a named trust exception and an open question (option: sign the desktop build with `restrict` dyld flag so its processes refuse `procargs2` — needs packaging verification; the owner's shells stay readable regardless).

### C. Keychain — file denies, not a SecurityServer mach deny

The prior-art probe resolved this: Keychain items are file-backed, so the existing `~/Library/Keychains` file deny already makes `SecItemCopyMatching` return `errSecNoSuchKeychain` and `security` report items missing — no mach deny is needed for the login keychain (`实测` on macOS 27.2.1 by the research probe; re-confirmed CLI-side this session). The two additions:

- Deny `/Library/Keychains` (the system keychain: WiFi passwords, enterprise certs, `find-generic-password -s` on `System.keychain` works for a same-uid process today).
- Antigravity's `Library/Keychains` readable carve-out re-opens the **login** keychain to that one runtime — keep it only if its no-API-key OAuth path genuinely needs it (open question 3); it is the one place a session can still reach owner keychain items.

A `(deny mach-lookup)` on `com.apple.SecurityServer` (+`securityd.xpc`) works — `实测` this session it errors `security` — but the service also carries certificate/TLS validation; Codex and sandbox-runtime both allow it for exactly that reason, and denying it would break any session tool that validates TLS through Security.framework. The file denies are the right layer and already cover the threat.

### D. Unchanged, already measured

`(deny file-write*)` outside writable paths; protected `.git` metadata write-deny; unix-socket denies over denied paths + the temp-socket classes + container sockets (`实测` `ssh-add -l` denied); `network-outbound/inbound/bind` deny on the server port for `localhost` + `*`; `com.apple.coreservices`/`lsd` (LaunchServices/Apple Events), `com.apple.windowserver`/`hiservices`/`pasteboard` (synthetic input, screen capture, pasteboard) mach denies — all kept from the shipped profile and `owner-approval-channel.md`'s verified set.

### E. Linux

`createSessionConfiner` stays the one seam; on linux it returns a confiner built on `launchConfined` (systemd unit + bwrap + start-gate env frame — credentials cross on the private stdin frame, never argv/unit metadata, per the approved `linux-harness-confinement.md` contract). This needs an async confiner signature (`confine(...) → Promise<LaunchHandle>`) so the child is the managed unit and `stop()` is the verified cgroup teardown; on a daemon without a systemd owner unit the availability probe already reports `unavailable`, so no session launches unconfined. Scope decision in open question 1 — the macOS work does not wait on it.

## Which credentials each path gets, and how

The broker is the daemon: every credential is resolved **outside** the sandbox (server-side `resolveStepCredentials`/`stepToken`, or daemon-side helpers), and only the resolved value crosses the boundary. This is the same architecture the prior art converged on — sandbox-runtime and Codex both hold the real secret outside and hand the workload a scoped value or a placeholder swapped at an allowlisted destination; SPIFFE's Workload API and systemd `LoadCredential` deliver the same way (per-credential, never ambient). Cairn's version is the simplest of the family: per-step resolution plus a private delivery channel per mechanism below, no proxy layer needed because every consumer is known. Per step:

| Credential | Resolution point | Delivery into the confined process | Lifetime |
| --- | --- | --- | --- |
| Provider API key | server secret box → `MachineTokenResponse.provider.apiKey` | claude/ACP: env via `claudeCliEnv`/`runtimeChildEnv`; pi: `initialize` frame (never env/argv) | step |
| Subscription tokens (Claude/Devin/Antigravity) | server → `claudeSubscriptionToken`/`devinToken`/`antigravityToken` | env (`CLAUDE_CODE_OAUTH_TOKEN`, `WINDSURF_API_KEY`, `GEMINI_API_KEY`); FD 3 inside orbs only | step |
| Git — hosted repo | `issueStepGitCredential` `git-step-<id>` key | env `CAIRN_GIT_CRED_*` via `gitCredentialEnv` | step claim; revoked at settle (`revokeStepGitCredential`) |
| Git — GitHub App | `autonomousToken` → `StepAppCredential` | **file**: `<dir>/github-token` + `<dir>/gh/hosts.yml`, referenced by `CAIRN_GIT_CRED_FILE` + `GH_CONFIG_DIR` env | refreshed ≤15 min before expiry, dir `dispose`d at step end |
| MCP connector secrets | server `mcpConnectors` headers | endpoint env/headers inside MCP config or remote tool calls; `$VAR` resolved daemon-side | step |
| Secret-grant vault values | `openSecretGrants` | never delivered wholesale; daemon resolves `$VAR` references and passes resolved values; redaction lists hold them for output scrubbing | step |
| Machine token | daemon file `machine.json` | never — daemon memory only | n/a |
| Owner token | server file | never — server memory + injected headers | n/a |

The placement fix (required): `StepAppCredential` currently writes under `agentRuntimeDir` (`<home>/homes/pi`) — a denied root re-exposed only to pi sessions. **Move the per-step credential dir to its own root** — e.g. `<home>/creds/step-<id>/` — created private, and add it to the `state` list the confiner is called with for *every* runtime (one `Launch`/`confine` signature already accepts `state`). For pi it stays inside `agentDir` coverage; for claude-code/ACP it becomes readable; for all runtimes it is denied to *other* sessions by the same deny+re-expose order. The `gh` hosts file goes with it. Until this lands, GitHub-App-backed git ops inside a macOS claude-code session fail closed at the credential helper (EPERM on `cat $CAIRN_GIT_CRED_FILE`) — a safe but broken behavior; `推断`, the test plan asserts it before and after.

Env rules after this change (single rule, no exceptions): **task-reachable envs carry only that task's own credentials; daemon/server envs carry no credentials at all** (the `KERN_PROCARGS2` hole makes anything weaker cosmetic). `childEnv`/`runtimeChildEnv`/`piHostEnv` already build the first half; the OTel-header removal completes the second.

## Migration of current call sites

1. `confine.ts`: extend `DENIED_DIRECTORIES`/`DENIED_FILES` with the portable additions; `confine-seatbelt.ts` `MAC_DENIED_DIRECTORIES` gets the mac additions (`Library/pnpm/rc`, `Application Support/{Claude,Code,@cairn}`, Keychains stays); `~/.config` becomes a denied root with `~/.config/git` in `readable`.
2. `confine-seatbelt.ts`: add `OUTSIDE_PROCESS_DENIALS` (signal + process-info, from `conv-01a1fa64`); drop the sysctl-read line (dead weight — measured not to fire for `KERN_PROCARGS2`). No SecurityServer mach deny — file denies carry Keychain.
3. `confine-session.ts`: `~/.config` deny + `~/.config/git` readable; `~/.cairn` in `deniedRoots` when it is not already the daemon home; accept a per-session `state` entry for the step credential dir.
4. `runner.ts`/`step-app-credential.ts`: create the credential dir under `<home>/creds/step-<id>/` (or `chat-sessions/step-<id>-creds`), pass it through `SessionOpts` → backends → `confine(..., state)` — one new field threaded on the existing `state` parameter (pi-host already passes `state`; claude-code/acp add the same argument).
5. `workspace-hooks.ts`: wrap the hook spawn through the session confiner with the step's policy (workspace + task temp + caches only, no harness state); a machine that cannot confine fails the hook — `setup` hook failure already fails the step, `resume` is non-fatal today and stays non-fatal (decision in open questions).
6. Linux: `confine-session.ts` returns a linux confiner over `launchConfined`; backend `confine` call sites become `await` on an async signature; `pi.ts` linux path routes through `pi-host` instead of `openInProcess` (deletes the in-process fallback, per the approved segment-4 contract).
7. `otel.ts`/desktop: `CAIRN_OTEL_HEADERS` (and the server's copy) move out of env into a denied file or `parentPort`; `daemonOtelFromEnv` reads the file.
8. `batch-sandbox.settings.json` and `canary.mjs` stay the batch-session tool — the deny-list *source of truth* for user-facing secret paths is shared: the settings file entries map mechanically onto `DENIED_*`/MAC lists (a test asserts every batch `denyRead` entry is covered by the session profile's deny set, so the two lists cannot drift).

## Failure behavior

- Profile build throws (unsafe path, overlap) → `confine()` throws → session `open` rejects; no unconfined fallback (existing).
- `sandbox-exec` missing/profile rejected → machine `unavailable` (`seatbelt-missing`/`seatbelt-probe-failed`), no dispatch, one notification (existing).
- Step credential dir unreadable inside the profile → git auth fails with EPERM — the placement fix removes this; until then it is a fail-closed bug, not a leak.
- Hook spawn under confinement fails → `setup` hook: step fails (existing fatal); `resume` hook: logged, step continues (existing non-fatal).
- Credential delivery fails (token refresh, `/api/machine/token` unreachable) → existing step failure path (`App credential refresh unavailable`), not machine-unavailable.
- Secrets-in-env audit fails (a `CAIRN_*`/`*_TOKEN`/`*_SECRET` in daemon env) → startup refuses or warns — the rule above made checkable (open question 4 proposes the audit).
- `/Library/Keychains` deny breaks a needed system-keychain read (nobody has shown one exists for session work — the probe in test 6 watches for it) → document rather than drop silently.
- Nested sandbox: inner harness sandboxes stay off (claude `sandbox` unset, Codex `full-access`); a second Seatbelt apply fails, so enabling one later is an explicit regression, not a silent overlap.

## Tests, one per path (red-first)

All run on `main` where the behavior exists to be red:

1. **Denied-root probe per runtime** (`confine-seatbelt.test.ts`, exists): extend the sentinel set to the new deny entries — a sentinel under `~/.config`, `~/.npmrc`, `~/Library/pnpm/rc`, `~/.local/share/devin`, `~/Library/Application Support/@cairn/desktop/Cache` (temp dirs mirroring the layout, never the real files) is unreadable inside the generated profile for claude-code, pi, and an ACP adapter. Red today: `~/.config` sentinel reads fine.
2. **Batch↔seatbelt list parity** (new pure test): every `denyRead` entry in `batch-sandbox.settings.json` maps to a deny in `seatbeltProfile` output or is on an explicit `allowRead` carve-out list in the test; new unmapped entries fail. Red today.
3. **Step credential dir** (new): build the policy with the credential dir as `state`; inside the profile, `cat $CAIRN_GIT_CRED_FILE` and `gh auth status` (offline fixture) succeed; a second session's profile for a different step cannot read it. Red today for claude-code/ACP; green for pi (agentDir is already state).
4. **Outside-process** (`conv-01a1fa64` tests, kept + corrected): `kill -0` an outside pid fails, own child passes; **replace** the procargs assertion with an honest residual test — `KERN_PROCARGS2` on an outside pid returns bytes inside the profile (documents the open channel), and a separate audit test asserts the daemon/server env contains no credential-shaped names so the channel yields nothing.
5. **Hooks** (new): a fixture `.agents/setup` that `cat`s a denied sentinel fails with EPERM under the wrapped spawn; the hook's own workspace writes succeed.
6. **Keychain** (new, macOS): inside the session profile a `SecItemCopyMatching`/`security find-generic-password` probe against a fixture keychain item returns `errSecNoSuchKeychain`/not-found; the same probe against an item in `System.keychain` fails once `/Library/Keychains` joins the deny list; `git ls-remote`, `node -e`, `curl -sI https://…` still succeed — the TLS-validation check that justifies *not* mach-denying SecurityServer.
7. **Linux parity** (extends 1,3,5): same sentinels through `launchConfined`-backed session confiner; pi runs in `pi-host`, never in-process; `openInProcess` unreachable when a confiner exists.
8. **Structural** (`confine-session.test.ts`, landed on the branch): every backend `machine-loop` builds receives the confiner; extend to assert `workspace-hooks` and the step credential dir are on the confined path.
9. **Availability**: probe failure → `unavailable`, no claims; unchanged contract.
10. **Env audit** (new): enumerate `process.env` of the daemon under test after credential resolution; assert no `*_TOKEN`/`*_SECRET`/`CAIRN_OTEL_HEADERS`/`*_PASSWORD` — the secrets-in-env rule made executable.
11. **canary**: the `secret-reach` canary run inside a real confined session (the `docs/verify` acceptance): every channel `no`/0 bytes for the denied inventory; the same run outside reports red as the negative control.
12. **Real-harness e2e on the Mac** (segment 6 of `mac-session-confinement.md`, still pending): fake-model session through claude-code and pi scripts `cat <sentinel>; security find-generic-password …; sysctl procargs2` — the first two denied, the third asserted as the documented residual.

## Scenario table

| Situation the user meets | What they see | What the system does | Wait/cost |
| --- | --- | --- | --- |
| Run a task on the Mac app | Task runs normally; nothing new | Session spawns under the expanded profile; step creds delivered via env/file inside the profile | none |
| Task on a repo with a `.agents/setup` hook | Hook output in the step log as today | Hook runs under the same profile; a hook that tries to read `~/.ssh` fails visibly | none |
| GitHub-backed project task on macOS | git clone/push inside the step works | Credential dir is session-readable state (after fix) | none |
| `sandbox-exec` removed by a macOS update | Machine shows `unavailable: seatbelt missing`; tasks stay pending | No dispatch; repair message; one notification | until repaired |
| A task tries `cat ~/.config/cairn/x.env` | Tool error `Operation not permitted` in the transcript | Kernel deny; event may appear in step logs | none |
| A task tries `security find-generic-password` | "item could not be found" | keychain db is a denied file read, so the API has nothing to return | none |
| A task reads another process's env | **succeeds today** — documented residual | Nothing in daemon/server env is a credential (env rule); owner's own shell envs remain exposed | named residual |
| `pnpm install`/`git push`/`gh pr create` inside a session | works | per-step App cred via `GH_CONFIG_DIR`+token file, refreshable | none |
| Daemon restarted mid-step | same as today | credential dir re-created on resume; availability re-probes before claims | none |
| Linux runner | unchanged until segment L lands; then confined sessions with the same deny list semantics | `launchConfined` path; `unavailable` if no systemd owner | staged |

## Recommendation

Ship as two ordered workstreams under this one design:

1. **macOS credentials + deny hardening** (#5393 + #5006 core): deny-list expansion, SecurityServer mach deny, signal/process-info denies from `conv-01a1fa64` (drop the dead sysctl line), step credential dir placement fix, `.agents/*` hooks through the confiner, env-credential rule + OTEL header removal, parity test against `batch-sandbox.settings.json`, segment-6 e2e.
2. **Linux session confinement** (the approved `linux-harness-confinement.md` adapter segment, unchanged): linux `SessionConfiner` over `launchConfined`, async confiner signature, pi `openInProcess` deletion on confined machines, the same deny-list source.

Order rationale: the macOS profile already enforces, so every deny-list and credential fix has immediate effect and immediate red/green evidence on the owner's machine; the Linux seam work is larger and should not gate the credential fixes. The two share the deny-list source, so the settings↔profile parity test (test 2) must land with workstream 1 and gate workstream 2's deny list automatically.

## Open questions for the owner

1. **Linux adapter migration in this ticket chain or its own?** Recommended: own ticket, this doc's workstream 2 — the seam and deny list are shared, the systemd/cgroup machinery is a separate review surface (#4543/#4604-class).
2. **Deny `~/.config` wholesale?** Recommended: yes, with `~/.config/git` readable (mirrors the batch list, which the owner already measured). If a `mise`/`fnm` config under `~/.config` turns out to be toolchain-required (unmeasured on this Mac — fnm does not use it; mise users might), carve it readable in the same change rather than dropping the deny.
3. **Antigravity's `Library/Keychains` readable carve-out — keep it?** Recommended: keep for now and document as the one session-reachable keychain hole; remove it the day antigravity's no-API-key OAuth path is shown not to need the files (needs a probe of what antigravity actually reads — its managed home may not need `~/Library/Keychains` at all). Do *not* mach-deny SecurityServer for any runtime — it carries TLS validation.
4. **`CAIRN_OTEL_HEADERS` out of the process env?** Recommended: yes — deliver via the existing `otel.env`-style file under the denied home or `parentPort`; add the env-audit test (test 10) so no `*_TOKEN`/`*_SECRET`/`*_PASSWORD`/`CAIRN_OTEL_*` survives in daemon/server env. The same rule applies to the server utility process (already flag-only for `CAIRN_OWNER_CHANNEL`).
5. **Owner-shell env leakage (`GH_TOKEN` exported in terminals) — accept as named residual?** Recommended: accept and document — no SBPL deny reaches `KERN_PROCARGS2`; the hardening option is signing the packaged build with the `restrict` flag so its own processes refuse the sysctl (owner's terminals stay readable either way), worth a packaging spike but not blocking.
6. **`.agents/*` hooks confined — and `resume` stays non-fatal?** Recommended: confine both, keep `resume` non-fatal as today (its contract is best-effort); `setup` keeps failing the step.
7. **`~/Library/Group Containers` / `~/Library/Containers` deny?** Recommended: not now — named residual; enumerate per-app additions later with real targets (the batch list made the same call).
8. **`sandbox-exec` deprecation contingency** — already decided (fail closed, no sandboxless mode); reaffirm only: when Apple removes it, Mac machines go `unavailable`, which is why test 9 stays the contract.
9. **Batch launcher (`batch-claude.mjs`, on `conv-01a1fa87`) — land separately?** Recommended: yes, rebase that branch independently — it fixes batch `claude -p`, a different boundary than daemon sessions; this doc does not gate it.
10. **`createSessionConfiner` per-session `state` for the credential dir: new `SessionOpts` field or a `confine()` argument?** Recommended: `confine()` argument (pi already passes `state` the same way) — keeps `SessionOpts` free of credential plumbing and matches the existing signature.

## What this doc does not cover

- The in-server Coordinator runtime (out of confinement scope per `linux-harness-confinement.md`).
- `task_for_pid`-readable memory, `launchctl` user-domain verbs, other session-server unix sockets on non-enumerated paths — the documented residuals from `owner-approval-channel.md` §Residuals, unchanged here.
- Windows — no enforcement story (`createSessionConfiner` and `hostShellConfinement` both return null/throw off darwin+linux; dispatch behavior there is unchanged and out of scope).
- Server-side HTTP rules (`#4986` paired-device/channel work) — orthogonal and landed.
