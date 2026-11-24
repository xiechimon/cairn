# Light Framework, Heavy LLM, Light Process

Date: 2026-11-24.
Status: proposed (Item A approved by owner; Items B–E proposed for phased adoption).
Prior art: [`docs/research/light-framework-heavy-llm-2026-11-24.md`](../research/light-framework-heavy-llm-2026-11-24.md), [`docs/research/subagents-vs-tasks-2026-11-24.md`](../research/subagents-vs-tasks-2026-11-24.md), [`docs/research/trajectory-self-improvement-2026-11-08.md`](../research/trajectory-self-improvement-2026-11-08.md).
Related confinement work: [`docs/design/2026-11-22-task-confinement-and-credentials.md`](./2026-11-22-task-confinement-and-credentials.md).
Parallel lane boundary (do not duplicate): branch `open-confine` is narrowing Coordinator `user_computer_shell` read-deny rules to credential stores only and adding inbound upload staging + `attach_file` for Coordinator inline file delivery. This design assumes `open-confine` lands as-is and builds on top of it without duplicating its scope.

---

## 1. Newcomer View

Imagine someone who installed Cairn today and has never heard of `pi-durable`, Seatbelt, `work_policy`, or RSI.

- **Where they meet this and why it is there for them**:
  1. **In Coordinator chat (A — Sub-agents)**: When they ask *"compare my last 5 failed tasks and tell me what broke"* or *"check three repos and summarize how auth works"*, Cairn delegates the noisy lookups to fast sub-agents and answers directly in the same chat turn — no board cards, no worktrees, no waiting for a separate task thread.
  2. **When starting any task (B — Light by default)**: Asking Cairn to fix a bug or draft a doc simply runs the model directly on the goal without forcing a rigid "plan -> confirm -> implement -> review" ceremony. If they later want strict TDD or a plan-then-review pipeline, they toggle or edit a Workflow Skill.
  3. **In Settings -> Controls (C — Editable controls)**: Curious or power users can click into any prompt, step brief, tool list, or automation limit that governs Cairn, see the exact text sent to the model, edit it, diff it against the default, or click **Reset to default**. Newcomers never have to touch this page to get started.
  4. **After tasks finish or after they correct Cairn (D — Self-improvement / RSI)**: When the user corrects Cairn (*"always run pnpm lint before pushing"* or rejects a task twice for the same mistake), Cairn quietly proposes a small, targeted improvement to a skill, memory, or prompt — showing a compact card with the exact diff, links to the past tasks that triggered it, and a one-click **Apply** or **Undo** button.
  5. **During any task on their computer (E — Open reads, light writes, recoverable deletes)**: Tasks can freely read normal files across their machine (never hitting annoying read prompts) while credentials (SSH keys, Keychain, browser cookies, `.env`/`.config` tokens) stay silently blocked by the OS sandbox. Tasks can write inside their workspace and working folders, and any deleted file goes to recoverable **Trash** instead of vanishing permanently.
- **What they must already know**: Plain language only. No jargon ("harness", "subagent", "work_policy", "trajectory") is required on the default path.
- **Accounts, payments, and keys asked of them**: Zero new accounts, subscriptions, or API keys. Sub-agents (A) and the self-improvement reflector (D) run on the **same model provider or subscription** the user already connected. Because sub-agents and background reflection consume tokens on that provider, Cairn surfaces sub-agent token/model attribution inline and caps both sub-agent fan-out and reflection frequency/size by default.
- **Where Cairn stores what they give**:
  - Coordinator sub-agent transcripts stay inside the existing per-thread store (`<CAIRN_HOME>/coordinator/<threadId>.sqlite`) or the runner's session log — never creating top-level task rows.
  - Editable prompts, tool policies, and versioned snapshots live in Cairn's local SQLite database (`control_override`, `control_version`) alongside existing skills under `<CAIRN_HOME>/skills` (default `~/.agents/skills`) and memories in `agent_memory`.
  - Soft-deleted files from tasks move to a per-user recoverable Trash folder (`~/.cairn-trash/` on macOS — avoiding macOS TCC prompts on `~/.Trash` — or XDG `$XDG_DATA_HOME/Trash` on Linux), auto-purged after 30 days.
- **Where they get stuck or what they see when it fails**:
  - *Sub-agent times out or errors*: Inline chat pill turns amber (`Timed out after 120s — partial result returned` or `Failed: <reason>`); Coordinator still replies with whatever partial findings were gathered instead of hanging or crashing the turn.
  - *User hits Stop or sends a new message mid-sub-agent*: Running sub-agents abort immediately (`< 2s`), no orphaned background spend.
  - *Task tries to read a credential or delete outside allowed paths*: OS sandbox / command gate returns a plain refusal message to the agent; credentials never leave disk.
  - *RSI suggests a bad edit or auto-learns a noisy skill*: Every change shows a 1-click **Undo** (and `"undo that"` in chat) restoring the exact pre-image snapshot; prompts/controls require explicit user Apply by default.
  - *User breaks a prompt by editing it*: One click on **Reset to default** restores Cairn's built-in text immediately.

---

## 2. Why & Cairn Map Today (`` `实测` ``)

All codebase facts below were measured directly on worktree `light-frame` (`0f156a4e3`).

### 2.1 Fixed Flows & Stages Today

Cairn is mid-migration from a multi-stage SDLC pipeline (`plan -> confirm -> build -> review/verify -> merge`) to D60 single-session execution (`step.kind = 'session'`), leaving substantial hardcoded scaffolding in place:

- **Hardcoded phase state machine & board columns**: `PHASE_VALUES` (`todo`, `queued`, `planning`, `confirm`, `building`, `needs_input`, `review`, `done`, `failed`, `stopped`, `closed`) and `boardColumnFor` in [`packages/shared/src/phase.ts`](../../packages/shared/src/phase.ts#L1-L89); `PHASE_TRANSITIONS` in [`apps/server/src/services/phase.ts`](../../apps/server/src/services/phase.ts#L3-L15).
- **Hardcoded 4-step workflow inside every new task**: [`apps/server/src/services/build-start.ts`](../../apps/server/src/services/build-start.ts#L158-L189) ignores `withPlan` (hardcodes `withPlan: false`) and always enqueues `kind: 'session'` with `SESSION_BRIEF` ([`packages/shared/src/records/prompts.ts`](../../packages/shared/src/records/prompts.ts#L226-L237)), forcing a fixed 4-step sequence (plan checklist -> write tests first -> implement -> self-check + `thread_report`).
- **Retired gate deadwood still wired into completion**: `review` and `verify` steps are no longer enqueued (`settleRetiredGateStep` / `retireMergeGateSteps` in [`apps/server/src/services/build-gate-steps.ts`](../../apps/server/src/services/build-gate-steps.ts#L22-L128)), yet legacy `plan` / `confirm` / `plan-rewrite` / `replan` branches remain active in [`apps/server/src/services/build-step-complete.ts`](../../apps/server/src/services/build-step-complete.ts#L257-L294) and [`apps/server/src/services/build-confirm.ts`](../../apps/server/src/services/build-confirm.ts#L11-L36).
- **Mandatory delivery block**: [`apps/server/src/services/build-undelivered.ts`](../../apps/server/src/services/build-undelivered.ts#L15-L96) auto-creates a blocking `ask_user` (`needs_input`) whenever a code task finishes without git changes or (on GitHub repos) without a PR.
- **Hardcoded automation caps**: `CI_FIX_ROUNDS_MAX = 3` ([`apps/server/src/services/ci-fix-prompts.ts`](../../apps/server/src/services/ci-fix-prompts.ts#L8)), `CI_MERGE_CONFLICT_ROUNDS_MAX = 2` ([`apps/server/src/services/ci-pr-rounds.ts`](../../apps/server/src/services/ci-pr-rounds.ts#L26-L74)), `REVIEW_ROUND_CAP = 3` and PR wake cap `10` ([`apps/server/src/services/pr-wakes.ts`](../../apps/server/src/services/pr-wakes.ts#L67-L70)), `STUCK_REJECTIONS_TRIGGER = 2` and `RESEARCH_WAIT_MAX_MS = 20 min` ([`apps/server/src/services/research-stuck.ts`](../../apps/server/src/services/research-stuck.ts#L26)), `STALL_AFTER_MS = 15 min` ([`packages/shared/src/records/step.ts`](../../packages/shared/src/records/step.ts#L170)).

### 2.2 Complete Inventory of System Prompts & Instruction Builders Today

All 37 prompt/instruction surfaces verified in code:

| Group | Prompts / Builders (Symbol & Location) | Editable Today? |
|---|---|---|
| **Coordinator Core & Turn Context (16)** | `COORDINATOR_SYSTEM_PROMPT` & `buildChiefSystemPrompt` ([`chief.ts:1899-1996`](../../apps/server/src/services/chief.ts#L1899-L1996)); `DAEMON_QUICK_REPLIES_GUIDANCE` ([`machine-claim.ts:344-348`](../../apps/server/src/services/machine-claim.ts#L344-L348)); `chiefTurnContext` ([`coordinator-steps.ts:223-426`](../../apps/server/src/services/coordinator-steps.ts#L223-L426)); `projectTurnContextTraced` ([`project-instructions.ts:20-65`](../../apps/server/src/services/project-instructions.ts#L20-L65)); `formatSkillRouteSection` ([`skill-route.ts:86-108`](../../packages/shared/src/skill-route.ts#L86-L108)); `recallMemorySection` ([`memory-recall.ts:115-166`](../../apps/server/src/services/memory-recall.ts#L115-L166)); `channelGreetingPrompt` ([`chief.ts:358-465`](../../apps/server/src/services/chief.ts#L358-L465)); `wakeFacts`/`settleWakePrompt`/`fireChiefWake` ([`chief.ts:1473-1840`](../../apps/server/src/services/chief.ts#L1473-L1840)); `buildOrchestratePrompt` ([`prompts.ts:550-579`](../../packages/shared/src/records/prompts.ts#L550-L579)); `memoryEditTurnPrompt` ([`memory-edit.ts:149-175`](../../apps/server/src/services/memory-edit.ts#L149-L175)); mail wake ([`mail.ts:183-194`](../../apps/server/src/services/mail.ts#L183-L194)); IM `inboundPrompt` ([`im/core.ts:526-545`](../../apps/server/src/services/im/core.ts#L526-L545)); action-proposal wake ([`action-proposals.ts:606-619`](../../apps/server/src/services/action-proposals.ts#L606-L619)); `PROJECT_CREATED_NEXT` ([`chief-tools.ts:142-143`](../../apps/server/src/services/chief-tools.ts#L142-L143)). | Only `project.instructions` and `agent_memory` slices are editable; all system/wake templates are hardcoded. |
| **Auxiliary LLM Prompts (5)** | `SUMMARY_SYSTEM_PROMPT` & `COORDINATOR_SUMMARY_PROMPT_HEAD` ([`compaction.ts:29,152-187`](../../apps/server/src/coordinator/runtime/compaction.ts#L29), [`chief.ts:273-281`](../../packages/shared/src/records/chief.ts#L273-L281)); `COORDINATOR_MEMORY_FLUSH_PROMPT_HEAD` ([`chief.ts:261-271`](../../packages/shared/src/records/chief.ts#L261-L271), [`memory-flush.ts:213-225`](../../apps/server/src/coordinator/memory-flush.ts#L213-L225)); `SUGGEST_REPLIES_ASK` ([`suggest-replies.ts:22-28`](../../apps/server/src/coordinator/runtime/suggest-replies.ts#L22-L28)); `ATTACHMENT_CAPTION_ASK` ([`server/.../image-text.ts:26-27`](../../apps/server/src/coordinator/runtime/image-text.ts#L26-L27)) & `IMAGE_CAPTION_ASK` ([`daemon/.../image-text.ts:9-10`](../../apps/daemon/src/backend/image-text.ts#L9-L10)). | None editable. |
| **Worker System Prompts (5)** | `composeWorkerSystemPrompt` ([`step-prompt.ts:134-160`](../../apps/daemon/src/step-prompt.ts#L134-L160)); `WEB_RESEARCH_GUIDANCE` ([`web-research.ts:1`](../../packages/shared/src/web-research.ts#L1), unconditionally appended to every daemon step in [`step-session-opts.ts:38`](../../apps/daemon/src/step-session-opts.ts#L38)); `composeBrief`/`composeSessionBrief` ([`brief-file.ts:25-61`](../../apps/daemon/src/brief-file.ts#L25-L61)); `<available_skills>` catalog ([`daemon/src/backend/skills.ts:104-196`](../../apps/daemon/src/backend/skills.ts#L104-L196)); `infoCardBrief` & nudge messages ([`info-card-tools.ts:83-101`](../../packages/shared/src/protocol/info-card-tools.ts#L83-L101), [`info-card-guard.ts:6-10`](../../apps/server/src/coordinator/runtime/info-card-guard.ts#L6-L10)). | Only `project.instructions`, repo `AGENTS.md`/`CLAUDE.md`, memories, and Skills are editable. |
| **Task / Step Templates & Suffixes (11)** | `SESSION_BRIEF` & `SESSION_REWORK_BRIEF` ([`prompts.ts:226-237`](../../packages/shared/src/records/prompts.ts#L226-L237)); `CONTINUE_PROMPTS` (`:239-247`); legacy plan/replan/restart/handoff notes (`:249-282,345-393,506-536`); `buildWorkBranchNote`/`GITHUB_OVERLAP_RULE`/`CAIRN_PUSHES_NOTE` (`:395-504`); `buildRetryLessonsSection` (`:284-339`, [`retry-lessons.ts:33-356`](../../apps/server/src/services/retry-lessons.ts#L33-L356)); `buildCiFixPrompt`/`buildMergeConflictPrompt`/`buildReviewFindingsPrompt`/`buildQueueWaitPrompt` ([`ci-fix-prompts.ts:20-55`](../../apps/server/src/services/ci-fix-prompts.ts#L20-L55), [`pr-wakes.ts:222-230`](../../apps/server/src/services/pr-wakes.ts#L222-L230)); `researchPrompt` ([`research-prompts.ts:11-43`](../../packages/shared/src/records/research-prompts.ts#L11-L43)); retired `buildVerifyStepPrompt` ([`verify.ts:46-165`](../../packages/shared/src/records/verify.ts#L46-L165)); `CORRECTION_PROMPT` ([`correction.ts:4-5`](../../apps/server/src/services/merge-gate/correction.ts#L4-L5)); `buildHostedMergeInstruction` ([`hosted-merge-instruction.ts:13-15`](../../apps/server/src/services/hosted-merge-instruction.ts#L13-L15)); untrusted data fences & state notes (`prompts.ts:21-88,186-218`). | None editable. |

### 2.3 What Users Can Edit Today vs. Hidden Schema vs. Hardcoded

- **Editable in UI + API**: `project.instructions` (16K chars) & `project.description` (8K chars), repo `AGENTS.md`/`CLAUDE.md` (external editor), `agent_memory` / `team_memory_entry`, Skills (`skillsDir`), Coordinator model routing (syncs `session` automatically), per-task `routeOverride`, MCP servers / mail rules / IM / secrets, and task schedules.
- **Exists in DB / API with NO UI (orphaned/hidden)**: `work_policy` (`tools` limited to 5 Chinese switch labels in `AGENT_TOOL_SWITCHES`, `skillsAllowlist`, `defaultSkill`, `secrets`, [`schema.ts:656-674`](../../apps/server/src/db/schema.ts#L656-L674)), separate `session`/`review`/`compaction` `routing_rule` + `fallbackModels`, `project.autonomy` (`planAutoApproveEnabled`, `localChecks`, not even in `patchProjectBodySchema`), `thread_pr` toggles (`autoFix`, `mergeWhenReady`, `autoArchive` — read-only in UI), `team.maxAutonomousMergesPerDay`, `project.splitPolicy`/`maxConcurrent`, and `PermissionRule` ([`permission-rules.ts:3-46`](../../packages/shared/src/records/permission-rules.ts#L3-L46) — accepted by `PiBackend` and `AcpBackend` but never loaded from DB/config).
- **Completely hardcoded**: All 37 built-in prompts/briefs, `CORE_COORDINATOR_TOOLS` & `WORKER_REMOTE_TOOLS`, tool descriptions, `SESSION_BRIEF` 4-step structure, all loop/timeout caps, and action-approval classes (`SLICE1_ACTIONS`).

### 2.4 Task History Stored Today (RSI Learning Surface)

Cairn already persists almost every raw signal RSI needs in SQLite (`apps/server/src/db/schema.ts`) and on disk:

- **Explicit corrections & rejections**: `build_feedback` (`kind: 'revision' | 'restart'`, `side: 'plan' | 'build'`, `feedback`, `:1510-1525`), `coordinator_input` (`kind: 'steer'`, `:1218-1246`), `chief_message.delivery` (`'steer'`/`'steer_missed'`, `:1261-1272`), `action_proposal` (`decision: 'refuse' | 'allow-once' | 'always'`, `:1738-1765`), `action_journal` (`kind: 'undo' | 'undo-refused' | 'error'`, `:1716-1736`), `design_comment` (`:1295-1352`).
- **Execution traces & outcomes**: `todo` + `todo_transition` + `build` (`errorMessage`, `changes`, `prUrl`, `retryClass`, `harnessHash`) + `step` (`ranModel`, `skillInjection`, `memoryTrace`) + `step_route` + `gate_verdict` (`pass | block | ...`) + `message` (assistant text, toolcall/result JSON, verdict/CI events) + `chief_message` + `computer_call` (exit code, stdout/stderr head/tail, errors) + `token_usage` / `step_usage` / `chief_turn_usage`.
- **On-disk & OTel**: Redacted `step-sessions/<stepId>.jsonl` (10 MiB cap, 30-day TTL in [`attachment-gc.ts:10`](../../apps/server/src/services/attachment-gc.ts#L10)), per-thread `pi-durable` `<threadId>.sqlite`, `coordinator_turn_snapshot` (30-day TTL, 256 MiB cap, currently only captures `projects` and `create_todo`), and OTLP/Langfuse spans (`runtime-otel.ts`, `claude-telemetry.ts`).
- **Existing but unimplemented RSI tables**: `memory_candidate` (`schema.ts:741-759`) and `build_outcome_backfill` (`schema.ts:1527-1535`) exist in schema with **zero runtime writers or readers**.

### 2.5 Current Read / Write / Delete Confinement

- **Tasks on macOS**: Active Seatbelt sandbox (`sandbox-exec`) via [`confine-session.ts`](../../apps/daemon/src/backend/confine-session.ts#L229-L474) + [`confine-seatbelt.ts`](../../apps/daemon/src/backend/confine-seatbelt.ts#L320-L498). `(allow default)` reads minus the hardened credential deny list (`~/.ssh`, `~/.gnupg`, `~/.aws`, `~/.config` minus `~/.config/git`, `~/Library/Keychains`, `/Library/Keychains`, browser profiles, `~/.cairn`, `@cairn`, shell rc/history, etc.); `(deny file-write*)` outside workspace + git dirs + taskTemp + harness state + caches; `.agents/setup` & `.agents/resume` hooks confined; per-step GitHub App creds placed in `<credsDir>/step-<id>-github`.
- **Measured Task gaps**:
  1. **Linux**: `createSessionConfiner` returns `null` off-darwin (`confine-session.ts:230`); `bwrap` + systemd `launchConfined` is implemented and probed, but not wired into task session launches.
  2. **Claude Code skips `command-gate.ts`**: Normal task steps run with `permissionMode: 'bypassPermissions'` ([`claude-code.ts:1523-1525`](../../apps/daemon/src/backend/claude-code.ts#L1523-L1525)), whereas `pi` (`pi.ts:1165`) and ACP (`acp-permission-gate.ts:208`) invoke `command-gate.ts`.
  3. **No Trash wrapper**: `rm` permanently unlinks files inside writable paths; only catastrophic patterns (`/`, `~`, `$HOME`, `/root`) are blocked in `command-gate.ts`.
  4. **Antigravity host-login carve-out**: Re-exposes `~/Library/Keychains` and `allowKeychainServices: true` when `CAIRN_ANTIGRAVITY_AUTH_MODE === 'host'` (`confine-session.ts:254-255,453-460`).
- **Coordinator**: In-server `pi-durable` has no direct local FS/shell tools; daemon-backed Coordinator runs `lockedDown: true` (disabling `Bash` on Claude Code, `read-only`/`relay-only` on ACP). Host shell access goes through `user_computer_shell` (`HostComputerProvider` + `hostShellProfile` + `ownComputerHardlineRefusal`), whose read-deny narrowing and `attach_file` delivery are being handled on branch `open-confine`.

---

## 3. Scenario Table (Target End-State)

| Situation the User Meets | What the User Sees | What the System Does | Wait & Cost |
|---|---|---|---|
| **A1. "Compare my last 5 failed tasks and tell me what broke"** *(multi-read lookup in chat)* | Coordinator stays in chat; 1–3 collapsed inline trace pills (`Subagent: Inspect failed tasks · 4 calls · 8s`) expand on click to show summary and child tool trace; no task cards created. | Coordinator calls `subagent` in parallel (same runtime as Coordinator: in-server `pi-durable` child conversations, depth 1, read-only tools); returns bounded summaries straight into the active turn. | ~5–15 s; 1 turn, 0 daemon/worktree startup; child token usage rolled into turn telemetry. |
| **A2. Sub-agent hits 120 s timeout or provider error** | Inline pill shows amber `Timed out (partial)` or red `Failed`; Coordinator still answers in chat using partial findings or explains what failed. | Timeout aborts child cleanly, extracts last partial output/tool results, returns `{ status: 'timed_out', partial: true, summary }` as tool result; parent turn never hangs or crashes. | Bounded by `timeoutSec` (120 s default, 300 s hard cap). |
| **A3. User sends a barge-in correction or clicks Stop while sub-agents are running** | Running sub-agent pills stop immediately (`Aborted`); Coordinator processes the new message or settles stopped. | Parent abort propagates via `pi-durable` task ownership (`AbortSignal`) or daemon child cancel; children terminate within `< 2 s`. | `< 2 s` cleanup; zero orphaned token burn. |
| **B1. "Add a dark-mode toggle to the settings modal"** *(default light task)* | Task runs directly in one session without a mandatory plan-approval wall or artificial 4-step ceremony; diff/PR arrives when done. | Task starts with minimal goal-oriented `SESSION_BRIEF`; model decides its own exploration, editing, and verification steps. | Faster first edit; lower prompt overhead (~1–2k fewer instruction tokens). |
| **B2. User wants strict `plan -> confirm -> implement -> review` on a critical repo** | User enables the bundled `plan-implement-review` Workflow Skill on the project (or edits Project Session Brief in Settings -> Controls); tasks in that project follow that pipeline. | Control Registry resolves `project -> team -> default` skill/brief override and injects the user's chosen workflow instructions. | Zero product code branching; instant toggle/edit. |
| **C1. User wants to inspect or tweak Coordinator's system prompt or disable a tool** | Opens Settings -> Controls; sees Everyday presets and Advanced prompt/tool cards; edits text, previews diff, clicks Save (or Reset to default). | Server validates, stores pre-image snapshot in `control_version`, writes `control_override`; next turn compiles new prompt above the cache boundary. | Immediate on next turn; 1-click revert. |
| **D1. User rejects two tasks for forgetting `pnpm lint` before push** | After the task settles, a compact card appears in chat / Improvements inbox: *"Suggested skill update: run `pnpm lint` before push · based on 2 tasks [View diff] [Apply] [Dismiss]"*. | Delta reflector reads the 2 `build_feedback` + error slices (capped 32K chars), drafts a targeted skill/prompt diff citing the 2 task IDs, validates against protected-surface deny rules, and stages a proposal. | Runs in background after idle; ~1 cheap reflection call (~$0.01–0.03); zero blocking latency. |
| **D2. User enables Auto-learn for skills and dislikes a learned skill** | Inline `"Learned: <name> [View diff] [Undo]"` row appears in chat; user clicks **Undo** (or types *"undo that"*). | Server restores previous `control_version` / skill snapshot atomically and marks the candidate rejected so the reflector does not re-propose it immediately. | `< 1 s`; reversible at any time. |
| **E1. Task reads a spec file in `~/Documents/specs/` and edits code in its worktree** | Works seamlessly with zero approval prompts. | Seatbelt / `bwrap` allows all non-credential reads and workspace writes; credential stores remain kernel-denied. | 0 prompts, 0 extra latency. |
| **E2. Task runs `rm old-report.pdf` on a user file** | File disappears from folder, but user can recover it from Trash (`~/.cairn-trash/` or Linux XDG Trash) or Cairn's Trash drawer for 30 days. | Confined `$PATH` trash shim intercepts `rm` for non-ephemeral files and atomically moves targets to Trash with a JSONL restore manifest; hard-delete patterns (`/`, `~`, `shred`) stay blocked across `pi`, `claude-code`, and ACP. | `< 50 ms`; fully recoverable for 30 days. |

---

## 4. Detailed Design

### A. Coordinator Sub-Agents (APPROVED — Ready to Build Immediately)

#### A.1 Goal & Boundary vs. Cairn Tasks

- **Coordinator Sub-Agent**: Ephemeral, in-turn helper spawned by the Coordinator during an active `chief` turn. Executes on the **same runtime as the Coordinator by default**, returns a bounded summary straight into the Coordinator's active turn, creates **no** `todo`/`build`/`step` row, **no** Tasks panel card, **no** git worktree, and **no** PR.
- **Cairn Task (`create_todo`)**: Remains the unit for durable multi-minute work, repository edits/PRs, cross-machine routing, scheduling, user steering, and crash-resumable deliverables.

#### A.2 Tool Contract (`subagent`)

Registered as a core Coordinator tool in `CORE_COORDINATOR_TOOLS` ([`packages/shared/src/protocol/chief-tools.ts`](../../packages/shared/src/protocol/chief-tools.ts#L29-L41)):

```ts
type SubagentToolInput = {
  /** Clear, self-contained task for the sub-agent. */
  task: string;
  /** Optional label shown in the chat trace pill (<= 60 chars). */
  label?: string;
  /** Optional focused background context string (<= 16,000 chars). */
  context?: string;
  /** 'fresh' (default) starts clean; 'fork' clones parent history up to tool boundary for prompt-cache reuse. */
  mode?: 'fresh' | 'fork';
  /** Tool scope: 'read-only' (default), or explicit subset of parent's already-offered safe tools. */
  tools?: 'read-only' | string[];
  /** Optional wall-clock timeout in seconds (default 120, min 10, max 300). */
  timeoutSec?: number;
  /** Optional max model turns (default 15, min 1, max 30). */
  maxTurns?: number;
};

type SubagentToolResult = {
  status: 'completed' | 'failed' | 'timed_out' | 'aborted';
  summary: string;          // Capped at 8,000 chars; scanned against injected tags
  partial?: boolean;        // True if timed_out or hit maxTurns with partial work
  error?: string;           // Plain failure reason when status === 'failed'
  childId: string;          // Child conversation/session ID for expandable UI inspection
  runtime: string;          // e.g. 'pi' | 'claude-code' | 'acp'
  model: string;            // Actual provider/modelId executed
  toolCalls: number;
  durationMs: number;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
  };
};
```

#### A.3 Sub-Harness Choice (Same Runtime as Coordinator by Default)

Single tool contract (`subagent`), dispatched to the Coordinator's own runtime:

1. **In-server `pi-durable` Coordinator (default for all `pi` API-key providers + `openai-codex` OAuth)**:
   - Add a 5th extension `coordinatorSubagentExtension` in [`apps/server/src/coordinator/runtime/server-runtime.ts`](../../apps/server/src/coordinator/runtime/server-runtime.ts#L183-L202).
   - Uses `pi-durable`'s native task-owned child conversation primitive inside the thread's existing `<threadId>.sqlite` store:
     - `tx.createConversation({ ownership: { kind: 'task', taskId: api.taskId } })` for `'fresh'`, or `tx.forkConversation(parentConversationId, { ownership: { kind: 'task', taskId: api.taskId } })` for `'fork'` (auto-falling back to `'fresh'` with a note if parent `contextTokens > 0.6 * contextWindow`).
     - `configure(tx, childId, { model: parentModel, extensions: { remove: [coordinatorSubagentExtension] }, tools: resolvedReadOnlyTools, maxTurns })` — removing `coordinatorSubagentExtension` structurally enforces **depth = 1**.
     - Marked `replay: 'safe'` with deterministic `requestId = "subagent:" + api.taskId + ":" + toolCallId`, scanning `tx.scanConversations({ ownerTaskId: api.taskId })` on server restart so a crash mid-sub-agent resumes rather than spawning a duplicate.
     - Zero daemon round-trip, sub-second spawn, uses parent's exact `pi` credentials and prompt cache.
2. **Daemon-backed Coordinator on `claude-code` subscription**:
   - Uses the **same `claude-code` runtime** on the claimed daemon — zero extra API keys, same subscription, shares prompt cache on `fork`.
   - Two implementation options weighed: exposing Claude Code's built-in `Agent` tool (adding `'Agent'` to `lockedDown` allowed tools with `maxTurns`, `disallowedTools` on child, and `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=1`) vs. routing Cairn's `mcp__cairn__subagent` tool to a daemon-side child SDK query.
   - **Recommended choice**: Expose Cairn's unified `subagent` MCP tool backed by a **daemon-local child session of the same `claude-code` harness** (inheriting the parent's `claude-code` subscription token, `lockedDown` Seatbelt profile, and read-only tool allowlist `['mcp__cairn', 'Read', 'Glob', 'Grep']` without `Agent`/`Bash`), OR allow native `Agent` only if we verify SDK `agents` config can enforce depth=1 + read-only tool restriction + output cap under `lockedDown`. Using Cairn's `subagent` tool guarantees identical schema, strict 8K cap, tag scanning, 120s timeout, and identical UI trace pills across `pi` and `claude-code` (see Open Question #1).
3. **Daemon-backed Coordinator on ACP (`antigravity`, `devin`)**:
   - Because ACP v1 exposes no portable child-session lineage ([`subagents-vs-tasks-2026-11-24.md`](../research/subagents-vs-tasks-2026-11-24.md) §2.2), the `subagent` relay tool runs either a same-daemon isolated ACP sub-turn (when the adapter supports concurrent `session/new` under `acpTurnPolicy = 'read-only'`) or falls back transparently to Cairn's in-server `pi-durable` sub-runner if a `pi` model is configured — normalizing progress/results into the exact same `SubagentToolResult` and chat UI pill.

#### A.4 Context Down, Tool Filtering, and Result Back

- **Context passed down**:
  - `mode: 'fresh'` (default): Compact child system prompt (~400 tokens: *"You are a focused read-only sub-agent assisting Cairn's Coordinator. Complete the assigned task concisely and return factual findings with citations/IDs. Do not ask the user questions."*), current timestamp + active `projectId` (if in a project channel), plus user message = `task` + optional fenced `<context>`.
  - `mode: 'fork'`: Clones parent conversation entries up to the pre-tool-call boundary + appends `task` as the next user message, preserving the provider's prompt-cache prefix.
- **Strictly stripped from every sub-agent (monotonic permission ceiling)**:
  - `subagent` itself (enforces **depth = 1**).
  - User-facing / stateful / mutating Coordinator tools: `ask_user`, `notify_user`, `request_secret`, `suggest_replies`, `create_todo`, `open_thread`, `stop_thread`, `delete_todos`, `merge_builds`, `create_project`, `delete_project`, `save_memory`, `update_memory`, `delete_memory`, `create_skill`, `update_skill`, and all non-read-only MCP connector tools (`readOnlyHint !== true`).
  - Default `'read-only'` allowlist: `todos`, `threads`, `projects`, `models`, `machines`, `skills`, `docs`, `usage`, `issues`, `pull_requests`, `workflow_runs`, `conversation`, `search_history`, `read_history`, `channel_messages`, `inspect_run`, `memories`, `attachment`, plus read-only MCP connectors (`readOnlyHint === true`) and, on daemon-backed runtimes, local `Read`/`Glob`/`Grep` (under Seatbelt).
  - Untrusted turns (inbound mail / report wakes) cannot grant host-computer tools to sub-agents (`refuseRestrictedTurnTool` inherited monotonically).
- **Result returned back**:
  - Final assistant text trimmed to **8,000 chars** (`SUBAGENT_SUMMARY_MAX_CHARS = 8_000`; if truncated, appends `\n[truncated; full trace in childId]`).
  - **Output sanitization** (borrowed from Claude Code's subagent output scanner): escapes synthetic control tags (`<system-reminder>`, `<turn_state>`, `<untrusted>`, `Human:`, `Assistant:`) and wraps output under a non-authoritative tool-result boundary so a prompt-injected document read by a sub-agent cannot hijack the Coordinator.
  - Usage (`inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens`) is accumulated into the parent turn's `chief_turn_usage` / `step_usage` row and emitted as child OTel spans (`invoke_subagent`) under the parent Coordinator turn trace.

#### A.5 How It Shows in Chat (Single UI Path)

- Reuses Cairn's existing `chief_message` `{ kind: 'toolcall', call: { id, name: 'subagent', arguments, startedAt, result, isError, endedAt, meta } }` pipeline in [`apps/server/src/coordinator/runtime/mirror.ts`](../../apps/server/src/coordinator/runtime/mirror.ts#L51-L87) — **no new top-level feed or Tasks panel row**.
- **While running**: `TurnMirror` emits an initial `toolcall` row immediately on start and updates lightweight `meta: { label, status: 'running', toolCalls, lastTool, elapsedMs, childId }` on child tool-call ticks (throttled to <= 1 update/sec) over existing SSE `conversation` events. The chat renders a compact inline pill: `[spinner] Subagent: <label> · 3 lookups · 6s`.
- **When settled**: Final `toolcall` upsert writes `{ status, summary, childId, model, toolCalls, durationMs, usage, childSteps }` (compact list of `{ name, argSummary, isError, durationMs }`, capped at 30 entries) directly onto the persisted `chief_message` row. The pill stays permanently visible in the transcript (collapsed by default; clicking expands the child's summary, model/tokens, and step list — eliminating the "finished subagent vanishes" bug documented in [`subagents-vs-tasks-2026-11-24.md`](../research/subagents-vs-tasks-2026-11-24.md) §2.3).

#### A.6 State Machine, Concurrency, Persistence & Read/Write Paths

**States & Transitions**:

```text
queued -> running -> completed
                  -> failed
                  -> timed_out (returns partial summary if available)
                  -> aborted   (parent Stop or barge-in)
queued -> aborted              (parent aborted before slot acquired)
```

**Concurrency Limits**:
- Max **4** concurrent foreground sub-agents per Coordinator turn (`SUBAGENT_MAX_CONCURRENT = 4`). If the Coordinator emits >4 parallel `subagent` calls in one assistant turn, slots 1–4 run immediately and 5+ queue cleanly behind a per-turn semaphore (bounded at 8 total calls per turn to prevent runaway fan-out; call 9+ returns a structured refusal `{ status: 'failed', error: 'max subagents per turn (8) reached' }`).

**Every Path That Reads or Writes State**:

| Path | Reader / Writer | State Touched |
|---|---|---|
| `coordinatorSubagentExtension` (new `subagent.ts` in `apps/server/src/coordinator/runtime/`) | In-server Coordinator | Creates/reads child conversation in `<threadId>.sqlite` (`pi-durable`); emits progress details via `api.details()` |
| `TurnMirror.onView()` (`apps/server/src/coordinator/runtime/mirror.ts`) | In-server Coordinator -> Server | Writes/upserts `chief_message` (`kind: 'toolcall'`, `name: 'subagent'`) and publishes SSE `message` |
| `daemonSubagentHandler` (new `subagent.ts` in `apps/daemon/src/backend/`) | Daemon Coordinator | Runs bounded child session on same daemon harness; relays progress/result to `/api/machine/relay-tool` |
| `recordChiefTurnUsage` (`apps/server/src/services/coordinator-steps.ts`) | Server | Rolls child `usage` into `chief_turn_usage` & `step_usage` |
| `stopChiefTurn` / `drainSteers` (`apps/server/src/services/chief-turns.ts`, `runtime/turn.ts`) | Server | Propagates `AbortSignal` / `root.abort()` to cancel active child conversations |
| `GET /api/teams/:id/chief/messages` & chat renderer (`apps/web/src/chief/`) | Web UI <- Server | Reads persisted `chief_message` toolcall row and renders collapsible inline subagent pill |

#### A.7 Failure & Timeout Paths — One Test Per Path

| # | Path / Failure Mode | Expected Behavior | Test |
|---|---|---|---|
| 1 | Happy path (`mode: 'fresh'`, in-server `pi-durable`) | Spawns child conversation, runs read-only tools, returns `{ status: 'completed', summary, usage, toolCalls, childId }` straight into parent turn; zero `todo`/`build` rows created | `coordinator-subagent.test.ts` (fresh happy path) |
| 2 | Happy path (`mode: 'fork'` + large-context fallback) | Forks parent history when `contextTokens <= 0.6 * window`; auto-falls back to `'fresh'` with note when above threshold | `coordinator-subagent.test.ts` (fork + fallback) |
| 3 | Parallel fan-out & semaphore cap (`>4` concurrent, `>8` per turn) | First 4 execute concurrently, 5–8 queue and succeed, 9th fails fast with cap error without crashing turn | `coordinator-subagent.test.ts` (concurrency + per-turn cap) |
| 4 | Depth-1 structural enforcement | Child toolset omits `subagent`; any direct attempt to invoke `subagent` inside child is rejected | `coordinator-subagent.test.ts` (depth-1 block) |
| 5 | Monotonic tool ceiling (read-only + untrusted turn) | Child cannot call `create_todo`, `ask_user`, `save_memory`, mutating MCP tools, or host tools from a mail turn | `coordinator-subagent.test.ts` (tool ceiling + untrusted turn) |
| 6 | Wall-clock timeout (`timeoutSec` exceeded) | Child aborts cleanly; returns `{ status: 'timed_out', partial: true, summary }` with partial text/tool summary; parent turn continues | `coordinator-subagent.test.ts` (timeout partial return) |
| 7 | `maxTurns` exhausted | Stops child loop at `maxTurns`; returns `{ status: 'completed', partial: true, summary }` with partial findings | `coordinator-subagent.test.ts` (maxTurns cap) |
| 8 | Provider / rate-limit error inside child | Child fails cleanly; returns `{ status: 'failed', error }` (secret-scrubbed) as tool result; parent turn recovers | `coordinator-subagent.test.ts` (provider error isolation) |
| 9 | Parent Stop / barge-in abort mid-subagent | `stopChiefTurn` / `root.abort()` cancels child within `< 2s`; child settles `aborted`; no orphan LLM calls after settle | `coordinator-subagent.test.ts` (parent abort cascade) |
| 10 | Output cap (8,000 chars) & prompt-injection tag scan | Output >8K truncated with pointer to `childId`; synthetic `<system-reminder>` / `<turn_state>` tags escaped | `coordinator-subagent.test.ts` (cap + sanitization) |
| 11 | Crash recovery (`pi-durable` `replay: 'safe'`) | Simulated restart during foreground sub-agent reattaches to existing `ownerTaskId` conversation via `scanConversations` instead of duplicating work | `coordinator-subagent.test.ts` (crash replay) |
| 12 | Usage rollup & OTel span parentage | Child tokens add into parent `chief_turn_usage` and emit child span under parent trace ID | `coordinator-subagent.test.ts` (usage + telemetry) |
| 13 | Chat UI persistence after completion | Persisted `chief_message` subagent pill remains visible and expandable after turn completes and after page reload | `subagent-pill.test.ts` under `apps/web/test/` (persisted trace pill) |
| 14 | Daemon-backed Coordinator (`claude-code` / ACP) | Same `subagent` tool contract executes on daemon harness (under `lockedDown` read-only policy) and returns identical `SubagentToolResult` | `coordinator-subagent-daemon.test.ts` under `apps/daemon/test/` |

---

### B. Fixed Flows as Editable User Preferences (Light by Default)

1. **Minimal default `SESSION_BRIEF`** ([`packages/shared/src/records/prompts.ts`](../../packages/shared/src/records/prompts.ts#L226-L237)):
   - Replace the hardcoded 4-step script (plan checklist -> tests first -> implement -> self-check) with a 3-line goal-oriented default: understand the request, make the needed changes or produce the requested answer, and verify your work before finishing.
2. **Ship structured pipelines as optional, editable Workflow Skills**:
   - Package Cairn's proven structured workflows (`plan-implement-review`, `tdd-bugfix`, `research-then-implement`) as bundled, editable `SKILL.md` packs in `skillsDir`.
   - Users can invoke them ad-hoc (`/plan-implement-review`), attach one as a project's `defaultSkill` (reusing existing `work_policy.defaultSkill` + per-project override), or edit the Markdown directly.
3. **Remove mandatory ceremony & dead legacy stages**:
   - **Relax `build-undelivered.ts`**: Stop auto-blocking a finished task with `needs_input` simply because it made zero commits or opened no PR; only require a PR/diff when the user/project workflow policy asks for code-delivery verification, otherwise settle to `done` with the assistant's summary (leaving it easy to follow up in the same thread).
   - **Retire dead legacy branches**: Once legacy `confirm`/`plan` rows are migrated or drained, remove unused `plan-rewrite`, `plan-auto-confirm`, and retired `review`/`verify` step-enqueue scaffolding from core server flow; keep `phase` simple (`todo`, `running`, `needs_input`, `done`, `failed`, `stopped`, `closed`).
   - **Un-hardcode automation caps**: Move `CI_FIX_ROUNDS_MAX`, `CI_MERGE_CONFLICT_ROUNDS_MAX`, `REVIEW_ROUND_CAP`, PR wake cap, and auto-stuck-research trigger (`STUCK_REJECTIONS_TRIGGER`) out of TypeScript constants into editable team/project settings with sensible light defaults (e.g., auto-stuck-research opt-in or toggleable rather than silently holding rework for 20 minutes).

---

### C. All Interface Controls Viewable & Editable

#### C.1 Unified Control Registry

Introduce a typed registry (new `controls.ts` under `packages/shared/src/`) covering every active system prompt, step brief, tool set, and workflow parameter from §2.2–2.3:

- **Precedence chain**: `Built-in Default` -> `Team Override` -> `Project Override` (for project-scoped controls).
- **Storage**: Two lightweight SQLite tables (mirroring existing `agent_memory` patterns) + optional file export/sync:
  - `control_override(id, teamId, projectId | null, key, format: 'markdown' | 'json', content, updatedBy, updatedAt)`
  - `control_version(id, overrideId, teamId, key, beforeContent, afterContent, source: 'user' | 'rsi' | 'reset', rationale, evidenceJson, createdAt)`
  - Every edit — whether from the user or from RSI (Item D) — appends a `control_version` row, making diffing and 1-click Undo trivial.
- **Prompt-cache discipline** (learned from OpenClaw & Hermes): Resolved prompt controls assemble strictly **above** the volatile context boundary in [`apps/server/src/coordinator/runtime/volatile.ts`](../../apps/server/src/coordinator/runtime/volatile.ts#L37-L68) and are frozen for the active turn, so editing a control takes effect cleanly on the next turn without invalidating in-flight cache prefixes.
- **Safety invariants (never overridable by prompt edits)**: Untrusted-data XML fencing (`fenceMailText`, `fenceIssueText`), secret redaction, OS sandbox credential deny lists, and `OWNER_ONLY_EXCEPTION_IDS` (`set_secret`, `delete_secrets`, `merge_builds`, `rest.eval-ruler`) stay enforced in code, outside the editable prompt layer.

#### C.2 Control Catalog & UI Surface (Progressive Disclosure)

To keep newcomers comfortable while giving full control to power users, Settings -> **Controls** splits into two tabs:

1. **Everyday** (4 high-leverage cards):
   - **Coordinator Instructions** (`coordinator.system` + team `<preferences>`)
   - **Task Workflow** (`task.session_brief` + optional `defaultSkill` picker, e.g., *Light (default)* / *Plan -> Implement -> Review* / *Custom*)
   - **Tool Access** (surfaces hidden `work_policy` switches + Coordinator tool enable/disable + MCP server toggles)
   - **Automation & PR Defaults** (surfaces hidden `thread_pr` defaults `autoFix`/`mergeWhenReady`/`autoArchive`, `project.autonomy`, and loop caps)
2. **Advanced** (every remaining active prompt & auxiliary instruction):
   - `task.rework_brief`, `info_card.brief`, `research.brief`, `web_research_guidance`, `compaction.summary`, `compaction.memory_flush`, `suggest_replies`, `ci_fix`, `merge_conflict`, `review_findings`, `channel_greeting`, and **Inspect Effective Prompt** (read-only live preview of the fully assembled Coordinator or Task prompt for a chosen project).
- Every editable item includes: **Diff vs. Default**, **Version History**, and **Reset to Default**.

---

### D. RSI: Smallest Closed Loop From Real Task History

Designed from the synthesis of **OpenClaw Skill Workshop**, **Hermes Background Review**, **Letta MemFS git-versioning**, **DSPy/GEPA reflective trace evolution**, and Cairn's prior study ([`trajectory-self-improvement-2026-11-08.md`](../research/trajectory-self-improvement-2026-11-08.md)). Works **100% locally on Cairn's own SQLite DB** — zero Langfuse or external infra required.

#### D.1 Smallest Loop Architecture (3 Stages)

```text
[1. Delta Signal Harvester (deterministic, 0 LLM)]
        |  reads new rows since watermark:
        |  - build_feedback (revision / restart)
        |  - coordinator_input / chief_message steers & corrections
        |  - build.errorMessage & gate_verdict blocks
        |  - action_journal undos
        |  - successful complex tasks (toolCalls >= 8)
        v
[2. Bounded Reflector (isolated pi-durable sub-turn, tool-restricted)]
        |  input: compact episode slice (<= 32K chars, redacted)
        |       + current editable skills/memories/controls index
        |  allowed tools: ONLY read_control, read_skill, propose_improvement
        |  output: NO-OP (common) OR 1-2 targeted Proposals (diff + cited IDs + rationale)
        v
[3. Apply / Stage + Versioned Undo + 14-Day Recurrence Check]
        |  - System prompt / control edits -> ALWAYS staged as Proposal (default)
        |  - Learned skills / memories -> Propose (default) OR Auto-apply (opt-in)
        |  - Every change writes control_version / skill_version pre-image
        |  - Inline chat pill or Improvements inbox: [View diff] [Apply] [Undo] [Dismiss]
```

#### D.2 Trigger Cadence, Cost Bounds & Watermark

- **Event trigger**: Fires after a task receives a user correction/revision (`build_feedback` or `action_journal.undo`) OR after a Coordinator thread accumulates `10` turns with `>= 1` steer/correction, debounced by **30 seconds of idle** (mirrors OpenClaw's 10-iter/30s idle pattern).
- **Manual trigger**: User can run `/improve` in chat or click **Review recent tasks** in Settings -> Controls -> Improvements.
- **Strict delta watermark**: `rsi_watermark(teamId, lastProcessedAt, lastBuildFeedbackId, lastMessageId)` guarantees each episode is reflected on **at most once** (avoiding the cumulative re-reflection cost bug measured in `trajectory-self-improvement-2026-11-08.md` §4).
- **Hard budget cap**: Max 1 reflection run per hour per team (unless manually triggered), max `32,000` input chars per episode bundle, skips cron/subagent/incognito turns.

#### D.3 How the User Sees, Reviews, and Undoes Changes

- **New table `rsi_proposal`**: `id`, `teamId`, `projectId`, `targetKind` (`'skill' | 'memory' | 'control'`), `targetKey`, `title`, `rationale`, `unifiedDiff`, `evidenceIds` (clickable `todoId` / `buildId` / `chiefMessageId`), `signature` (deterministic failure/correction hash for dedupe & recurrence tracking), `status` (`'pending' | 'applied' | 'dismissed' | 'reverted' | 'expired'`), `versionId` (links to `control_version` / skill backup), `createdAt`, `decidedAt`.
- **Two visibility modes**:
  - **Default (`propose`)**: Surfaces a compact, non-blocking card in the Coordinator thread (or Improvements drawer): title, 1-line rationale, cited task links, expandable unified diff, and `[Apply]` / `[Edit]` / `[Dismiss]`. Dismissed signatures enter a 30-day cooldown so the reflector does not nag.
  - **Opt-in (`auto-skills`)**: Skills and memories apply immediately with a compact `"Learned: <title> [View diff] [Undo]"` pill in chat (prompts/controls still require explicit `[Apply]` unless user opts into full auto). Saying *"undo that"* in chat or clicking `[Undo]` atomically restores the pre-image snapshot and marks `status = 'reverted'`.
- **Hard Refusal Guard (DSPy / DGM invariant)**: The reflector tool layer **refuses** any proposal targeting security surfaces, OS sandbox deny lists, permission rules, `OWNER_ONLY_EXCEPTION_IDS`, or eval rulers. It can only target user-editable skills, memories, and non-security prompt controls.
- **Lightweight Outcome Measurement (GEPA-lite)**:
  - Track `signature` recurrence over the next 14 days after a proposal is `applied`.
  - Track `lastUsedAt` on learned skills (reusing existing `skill_audit` + `step.skillInjection`): if a learned skill is unused for 30 days or if its `signature` recurs >= 2 times after applying, surface a one-line prompt to archive or refine it.

---

### E. Permissions During Tasks (Open Reads, Lightly Controlled Writes & Deletes)

Coordinates directly with `open-confine` (Coordinator `user_computer_shell` + `attach_file` — **not duplicated here**) and [`docs/design/2026-11-22-task-confinement-and-credentials.md`](./2026-11-22-task-confinement-and-credentials.md).

#### E.1 Concrete Default Policy Table

| Action | Proposed Default for Tasks | Enforcement Layer | Failure / Edge Behavior |
|---|---|---|---|
| **Read files** | **Fully open** across workspace and host machine **except credential stores** (`~/.ssh`, `~/.gnupg`, `~/.aws`, `~/.config` minus `~/.config/git`, `~/Library/Keychains`, `/Library/Keychains`, browser profiles, `~/.cairn`, `@cairn`, shell rc/history, package-manager creds). | OS Sandbox: macOS Seatbelt `(allow default)` + credential `(deny file-read*)` ([`confine-seatbelt.ts`](../../apps/daemon/src/backend/confine-seatbelt.ts)); Linux `bwrap` mask mounts wired into [`confine-session.ts`](../../apps/daemon/src/backend/confine-session.ts#L230). | Kernel returns `EPERM`; agent sees plain permission error; zero secrets leak. |
| **Write / Edit files** | **Open (zero prompts)** inside: (1) task git worktree/workspace, (2) `$TMPDIR` / `taskTemp`, (3) harness own state/caches, and (4) user-authorized personal working folders (configurable in Settings -> Permissions, e.g., `~/Desktop`, `~/Documents`, `~/Downloads` when enabled for non-repo tasks). **Denied** on `.git` internal metadata, credential stores, OS system dirs, shell rc, `LaunchAgents`/cron, and Cairn server/daemon homes. | OS Sandbox `(deny file-write*)` + explicit allowlist (`confine-seatbelt.ts`, Linux `bwrap` `--ro-bind` root + `--bind` writable roots). | Writes outside allowed roots fail with `EPERM`; if a task legitimately needs a new folder, it asks the user once via existing `ask_user` / folder grant. |
| **Delete files** | **Recoverable Trash by default** instead of permanent `unlink` / `rm`. Ephemeral scratch paths (`$TMPDIR`, `node_modules`, `dist`, `.next`, `target`, `.pytest_cache`) and `git`-cleanable tracked paths may fast-delete; **untracked files and user files move to recoverable Trash**. Catastrophic hard-delete commands (`/`, `~`, `$HOME`, `/Users`, `/System`, `shred`, `srm`, `mkfs`, `dd`) remain **hard-blocked**. | 1. **Confined `$PATH` Trash Shim (`cairn-rm` / `rm` wrapper)** prepended to task `PATH` + daemon file tools.<br>2. **Unified `command-gate.ts`** wired into **all** harnesses — closing the gap where `claude-code` currently skips `command-gate` via `bypassPermissions` (use SDK `canUseTool` hook). | Moving to Trash logs `{ ts, taskId, originalPath, trashPath, sizeBytes }` to `~/.cairn-trash/manifest.jsonl` (macOS) or XDG Trash `.trashinfo` (Linux). If Trash move fails (cross-device / quota), refuses rather than silently hard-deleting; user restores with 1 click or `cairn trash restore`. |

#### E.2 macOS TCC & Trash Placement Detail

- On macOS, writing directly into `~/.Trash` from a Seatbelt-confined child process can trigger TCC (`Operation not permitted` / Finder prompt) depending on macOS privacy grants.
- **Single reliable cross-platform path**:
  - **macOS**: Use `~/.cairn-trash/<YYYY-MM-DD>/<stepId>/<unique>-<basename>` + `manifest.jsonl`, explicitly added to the Seatbelt session `writable` list (outside TCC-protected `~/.Trash`, zero OS popups, atomic `rename` on same APFS volume, `cp -pR` + `unlink` fallback across volumes), with a 30-day daemon sweep matching `STEP_SESSION_RETENTION_MS` and a simple **Recently Deleted (Trash)** view / restore command.
  - **Linux**: Standard FreeDesktop XDG Trash (`$XDG_DATA_HOME/Trash/{files,info}`), bind-mounted writable in `bwrap` so desktop file managers can also restore items natively.
  - **Direct `unlink()` from scripts (e.g. `node -e "fs.unlinkSync(...)"`)**: A `$PATH` `rm` shim covers shell `rm` (the vast majority of agent deletes) while Seatbelt's existing `deny file-write-unlink` protects top-level roots and `.git` metadata. For non-repo user folders, tasks keep git/backup awareness and `manifest.jsonl` records every shimmed delete; documenting this exact boundary avoids pretending a `$PATH` wrapper intercepts raw syscalls.

#### E.3 Closing Measured Confinement Gaps

1. **Wire `command-gate.ts` into `claude-code` task steps**: Replace unconstrained `permissionMode: 'bypassPermissions'` in [`apps/daemon/src/backend/claude-code.ts`](../../apps/daemon/src/backend/claude-code.ts#L1523-L1525) with a fast in-process `canUseTool` callback calling `decideBashCommand` / `decideToolCall` (auto-allowing everything except `DEFAULT_BASH_PATTERNS` + user `PermissionRule`s), bringing `claude-code` to parity with `pi` and ACP with zero extra user prompts.
2. **Wire Linux `bwrap` session confinement**: Enable `launchConfined` inside [`apps/daemon/src/backend/confine-session.ts`](../../apps/daemon/src/backend/confine-session.ts#L230) on Linux so read-deny / write-allow / Trash rules match macOS.
3. **Audit Antigravity `Library/Keychains` carve-out**: Verify whether Antigravity's managed auth still requires host Keychain access (`confine-session.ts:254-255,453-460`); if removable, drop it so no task runtime can read login Keychain items.

---

## 5. Phased Implementation Plan & Exit Criteria

| Phase | Scope | Key Code Areas | Exit Criteria |
|---|---|---|---|
| **Phase 1: Coordinator Sub-Agents (A)** *(Build Immediately)* | Unified `subagent` tool (`fresh` + `fork`), in-server `pi-durable` child conversations (`coordinatorSubagentExtension`), daemon-backed Coordinator support (`claude-code`/ACP), depth=1, semaphore cap (4 conc / 8 turn), 8K cap + tag scan, timeout/partial return, barge-in/stop abort cascade, usage rollup, persisted collapsible inline chat pill. | `packages/shared/src/protocol/chief-tools.ts`, `apps/server/src/coordinator/runtime/{server-runtime,subagent,mirror,turn}.ts`, `apps/server/src/services/coordinator-tool-defs.ts`, `apps/daemon/src/backend/{claude-code,acp}.ts`, `apps/web/src/chief/` | All 14 tests in §A.7 green in CI; live `verify-cairn` walk demonstrates parallel lookup in Coordinator chat (0 Tasks panel cards created), persisted expandable pill after reload, timeout partial recovery, and `< 2s` barge-in abort with screenshots. |
| **Phase 2: Light Default Flow & Task Permissions (B1 + E)** | Minimal goal-oriented `SESSION_BRIEF`, bundled optional `plan-implement-review` Skill, relax `build-undelivered.ts` false-blocks, retire legacy `plan`/`confirm`/`review`/`verify` deadwood; wire `canUseTool` `command-gate` in `claude-code`, ship recoverable Trash `rm` shim + 30-day sweep + restore API, wire Linux `bwrap` in `confine-session.ts`. | `packages/shared/src/records/prompts.ts`, `apps/server/src/services/{build-start,build-undelivered,build-step-complete,build-gate-steps}.ts`, `apps/daemon/src/backend/{claude-code,command-gate,confine-session,trash-shim}.ts` | Unit/integration tests for minimal brief, Trash move+restore+catastrophic-block across `pi`/`claude-code`/ACP, and Linux `bwrap` probe; live `verify-cairn` walk confirms a normal task runs without 4-step ceremony and a task `rm` moves to recoverable Trash while credential reads remain denied. |
| **Phase 3: Editable Control Plane (C)** | Control Registry (new `controls.ts` in `packages/shared/src/`), `control_override` + `control_version` DB migration, wire all active prompts/briefs/tool policies/loop caps to resolve `project -> team -> default`, Settings -> Controls UI (Everyday + Advanced tabs, Diff vs Default, Version History, Reset to Default, Effective Prompt preview); surface hidden `work_policy`, `thread_pr` toggles, and `project.autonomy`. | `packages/shared/src/` (new `controls.ts`), `apps/server/src/db/schema.ts`, `apps/server/src/services/{controls,chief,routing-rules,pr-wakes,ci-loop}.ts`, `apps/server/src/` (new `routes-controls.ts`), `apps/web/src/resources/` (new `controls-page.tsx`) | Round-trip tests for override precedence, cache-boundary stability, safety-invariant non-overridability, and Reset to Default; live `verify-cairn` walk edits `coordinator.system` and `task.session_brief` in UI, observes changed behavior on next turn, and reverts in 1 click. |
| **Phase 4: Minimal RSI Loop (D)** | Delta signal harvester (`rsi_watermark`), bounded tool-restricted reflector (`pi-durable`), `rsi_proposal` table + protected-surface refusal gate, inline chat card + Improvements drawer (`[View diff]` / `[Apply]` / `[Undo]` / `[Dismiss]`), opt-in `auto-skills` mode, 14-day signature recurrence & 30-day unused-skill hygiene tracker. | `apps/server/src/services/rsi/{harvester,reflector,proposals,hygiene}.ts`, `apps/server/src/db/schema.ts`, `apps/server/src/` (new `routes-rsi.ts`), `apps/web/src/chief/` (new `rsi-card.tsx`) | Negative-control tests proving reflector refuses security/sandbox/ruler edits, never re-scans past watermark, and restores exact pre-image on Undo; live `verify-cairn` walk triggers a real revision -> generates cited diff proposal -> applies -> verifies effect on next run -> undoes cleanly. |

---

## 6. Open Questions for the Owner

Decisions that affect product direction, UX defaults, or trade-offs where the owner's call is needed (each paired with a recommendation):

1. **Daemon-backed `claude-code` Coordinator sub-agents (Phase 1)**: Should a Coordinator running on a `claude-code` subscription execute `subagent` via Cairn's unified `mcp__cairn__subagent` tool (spawning a bounded child `claude-code` query on the same daemon with identical 8K cap, tag scan, 120s timeout, and UI pill) or directly unlock Claude Code's native `Agent` tool under `lockedDown`?
   - **Recommended**: Cairn's unified `subagent` tool backed by a child `claude-code` query on the same daemon — keeps one tool contract, guaranteed depth=1, strict read-only ceiling, output scanning, and identical chat UI across `pi`, `claude-code`, and ACP.
2. **RSI default apply mode (Phase 4)**: When the RSI reflector proposes an edit, should **all** targets (`skill`, `memory`, `control` prompt) default to `propose` (user clicks Apply), or should learned `skill`/`memory` edits default to `auto` with an inline `"Learned [Undo]"` pill (OpenClaw style) while system prompts stay `propose`?
   - **Recommended**: `propose` by default for everything in Phase 4 launch (zero silent behavior drift while building trust), with a one-click Settings toggle for `auto` on skills & memories once verified on real history.
3. **Storage format for editable controls (Phase 3)**: Keep editable prompt/control overrides in SQLite (`control_override` + `control_version`, like `agent_memory` today) or store them as plain Markdown/YAML files in a git-tracked `<CAIRN_HOME>/controls/` directory (Letta MemFS / OpenClaw style) so external editors and git work natively?
   - **Recommended**: Plain Markdown/YAML files in `<CAIRN_HOME>/controls/` (with git auto-commits for history/rollback, or SQLite mirror for fast UI queries) if the owner prefers editing prompts in his own editor/repo; SQLite-primary if multi-device/hosted sync matters more. *(Default recommendation: SQLite `control_override` + `control_version` with 1-click Export/Import to match existing `agent_memory` and desktop/server deployment cleanly, unless local file editing is a hard preference.)*
4. **Trash directory on macOS (Phase 2)**: Use Cairn's own `~/.cairn-trash/` (zero macOS TCC prompts under Seatbelt, 30-day auto-expiry, 1-click UI restore) vs. attempting native macOS `~/.Trash` (visible in Finder Trash, but risks TCC permission popups inside confined processes)?
   - **Recommended**: `~/.cairn-trash/` with a Cairn UI "Recently Deleted" restore button (and native XDG Trash on Linux) — zero TCC friction inside Seatbelt.
5. **Non-repo host write folders for Tasks (Phase 2)**: Should tasks be writable *only* inside their git worktree + `$TMPDIR` by default (asking once if a task needs `~/Desktop` or `~/Documents`), or should `~/Desktop`, `~/Documents`, and `~/Downloads` be writable by default for personal tasks?
   - **Recommended**: Worktree + `$TMPDIR` writable by default for code tasks; allow user-configured extra writable folders (default empty, one-click grant when a personal task asks) so prompt-injected code repos cannot silently modify personal documents outside the repo.
