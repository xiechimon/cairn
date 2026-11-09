# Linux harness confinement

Date: 2026-11-09
Status: proposed; awaiting ian's design review; no implementation authorized

## Decision and boundary

| Decision | Owner and basis |
| --- | --- |
| Linux only; one mandatory bwrap launcher for dispatched harnesses on omarchy | ian and orchestrator, 2026-11-09; supersedes the platform scope in [research §4.2](../research/user-computer-model-2026-11-08.md#42-mode-b-one-cairn-owned-sandbox-around-every-harness) |
| No Seatbelt implementation | Known gap: its proposed file policy cannot meet daemon-PID isolation; non-Linux task launches must refuse, never run unconfined |
| Computer-driver tasks #140/#141 paused; neither driver qualified | ian, 2026-11-09; no driver choice, orb/noVNC deletion, dependency or lockfile change here |

Reuse the research's whole-process precedent, not Bash-only or in-process isolation. Launch observations were inspected at `b46a16893`; proposals are not measured guarantees. Scope: daemon-dispatched harnesses and descendants, including retained orb workers, not the in-server pi-durable Coordinator or external MCP services.

## One policy, inside the backend seam

Only `apps/daemon/src/backend/confine.ts` launches harnesses: bwrap with `--die-with-parent --new-session --unshare-pid --ro-bind / / --dev-bind /dev /dev --proc /proc --tmpfs /tmp`. Networking stays shared; no `TMPDIR` override, resource caps, shell prefix or unconfined fallback. Custom code bridges policy/SDKs, not bwrap's namespace/mount machinery.

- **Writes:** worktree, git common directory, private task temp, own state, and shared caches (`~/.cache`, resolved pnpm store, `~/.npm`, Go modules, Cargo registry). Everything else is read-only; protect git hooks/config inside writable metadata.
- **Denied reads:** SSH, GPG, AWS, gh, netrc, Docker, Kubernetes and password-store credentials; Chrome/Chromium profiles; daemon home; other harness state. Mask directories with empty read-only mounts and files with `/dev/null`. Resolve canonical paths, classify absent targets without creating host secret files, and reject unsafe overlaps/symlinks before spawning.
- **Precedence:** read-only root, denied-parent masks, narrowly re-exposed task/state paths, then protected-file masks. Worktrees and pi state beneath daemon home must work without exposing its machine credentials, session index or unrelated transcripts. No writable cache may alias a denied root. Never rebind the whole daemon home.
- **Only profile difference:** own-state paths: Claude's configured directory plus `.claude.json`, Codex's directory, pi's `agentDir` plus private session directory/exact legacy resume file, Gemini's directory. Never expose shared transcripts/index; parent retains indexing. Preflight uses empty private task scratch, without git writes.
- **Limits:** shared networking, all devices, readable non-denied host files and writable caches/state are explicit trust exceptions, not protection against every host service. Pass only required environment/credential values and FDs; never inherit daemon credentials wholesale or log secrets.

## Launch inventory and failure behavior

Paths are relative to `apps/daemon/src/`; write failing launch tests per row, including create/resume.

| Existing entry | Replacement and failure behavior |
| --- | --- |
| `backend/claude-code.ts`: `query`, SDK default spawn and conditional OAuth-FD spawner | Always install confine, with/without token FD; preserve stdio/abort/credentials, disable inner sandbox. bwrap/FD/SDK failure closes pipes and rejects before prompting. |
| `backend/acp.ts`: configured Claude/Codex adapters and default Gemini executable, including injected spawners | Injection records confined argv, never bypasses policy. Require Codex `full-access` after new/resume/load; disable other inner sandboxes. Unsupported adapters/modes or initialization failure close host tools/processes before prompting. |
| `backend/pi.ts`: `createAgentSession`, built-in file tools, Bash and local MCP children | Move the existing session into confined `cairn-daemon pi-host`, registered in `cli.ts`, in the same change. No in-process fallback; startup failure returns no handle. Descendants inherit confinement. |
| `claude-code-bin.ts` version and `claude-code-auth.ts` auth-status probes | Replace direct `execFile` with confine/preflight policy. Failure reports unavailable/unknown with scrubbed reason, never retries unconfined. |
| `machine-loop.ts` backend selection; `orb/worker.ts` backend factories; probe scripts and `backend/smoke-command.mjs` | Converge on these seams; remove smoke helper's direct spawn and `inOrb` exemptions. Missing bwrap/namespaces fails even inside retained containers. |

Git/workspace management, daemon supervisors and computer-driver helpers are not harness launches. Structural coverage must nevertheless reject new direct harness launches outside the inventoried seams, including SDK defaults; no backend file except `confine.ts` may import `node:child_process`.

## Pi protocol and state ownership

One child per live session; no persisted protocol state or daemon-wide environment mutation. Existing SDK plus versioned, Zod-validated JSONL on private pipes: bounded frames/queues, correlation IDs, backpressure; scrubbed stderr diagnostics. This thin bridge preserves Cairn's custom tools/gates, unlike stock pi RPC.

| State reader/writer or transition | Required behavior and failure-first test |
| --- | --- |
| Parent create/continue → starting; child initialize → ready | Parent resolves the resume file; child validates model, settings and policy. Missing transcript, unsupported protocol or startup exit rejects open; ready includes session identity before any prompt. |
| Parent prompt; child ready → running; child events/usage | Stream ordered StepEvents, final usage and durable transcript updates; parent owns indexing and validates session paths. EOF, invalid/oversized frames or persistence failure fail pending work, never synthesize success. |
| Parent steer/image input; child live session | Preserve ordering, image checks, gates, skills, telemetry and compaction behavior. Reject steering after stopping and unsupported input without another child. |
| Child tool request; parent registered callback; child reply | Bridge only declared local/remote tools and approval callbacks with correlated IDs; reject unknown methods/IDs. Built-in file/Bash tools stay in the child. Do not expose a generic parent filesystem/command executor. External services retain their own authorization. |
| Parent stop/abort; completion, child error/exit, or parent loss → stopping → closed/failed | Settle outstanding requests once, cancel callbacks, close pipes and terminate the entire confined tree. Await cleanup before releasing task paths; descendants cannot survive parent loss. No respawn or blind retry. |

## Acceptance before implementation is called complete

Red-first: argv snapshots; launch/state tests per table row; structural tests; per-profile Linux probes for worktree writes, denied home writes/secret reads, hidden daemon PID, HTTP and GPU. Cover nested daemon-home paths, protected git metadata, absent targets and namespace/mount failure. Real Claude/Codex/pi fake-model E2Es request sentinel reads/home writes and prove denial; record omarchy install (`pnpm install --ignore-scripts`) and tests inside confine. Use targeted Vitest `--maxWorkers=4`, lint, typecheck, spec:parse and prepush. No fresh runtime pass or macOS evidence is claimed. Hold this docs PR with `coordinator-hold`; ian reviews before code.
