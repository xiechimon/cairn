# Per-Command Sandbox Escalation (`user_computer_shell`)

**Date**: 2026-11-24
**Prior art**: [Per-Command Shell Confinement & Escalation Prior Art (Section 5)](../research/per-command-confinement-2026-11-24.md#5-per-command-sandbox-escalation-prior-art-2026-11-24)

## 1. For a Newcomer

- **Where you meet it and why it is there**: When you ask Cairn's Coordinator to do a job on your Mac (for example, convert a PDF or run a local CLI tool), Cairn runs each command inside an OS sandbox that blocks access to your credentials (`~/.ssh`, Keychains, browser cookies, `~/.cairn`, etc.). Most commands work silently. Occasionally a command fails because of the sandbox itself (for example, macOS forbids `qlmanage` from starting a nested sandbox). First, the Coordinator sees that the failure was a sandbox block and tries another tool on its own (such as `sips`). Only if no sandboxed alternative can do the job does Cairn show one inline approval card in the chat with the exact command and **Approve / Decline** buttons.
- **What you must already know**: Nothing about Seatbelt, `bwrap`, or Cairn internals. You only read the exact command on the card and decide whether to let it run once without the sandbox.
- **Accounts, payments, and keys asked**: None. No extra setup, API keys, or settings toggles.
- **Where Cairn stores what you give**: Each approval request and your single-shot Allow/Deny decision is stored locally in Cairn's server SQLite database (`action_proposal`, `chief_message`, `action_journal`, `computer_call`). Nothing is remembered across commands.
- **Where you can get stuck / what you see when it fails**: If you are away when the Coordinator asks, the reply finishes normally saying it is waiting for your approval, and the card stays clickable for up to 7 days. If your Mac is offline when you click Allow later, Cairn tells you the Mac was offline and does not silently retry later. If you click after 7 days, the card shows it expired and nothing runs.

## 2. Why (Problem & Step 0 Data)

Under `open-confine`, every `user_computer_shell` command runs inside macOS `sandbox-exec` or Linux `bwrap` so the Coordinator cannot silently read credentials. However:
1. Today, sandbox denials look like generic command failures (`exit code 255` / stderr text), giving the model no typed signal to distinguish a sandbox block from an ordinary command bug.
2. Commands that genuinely cannot run inside the sandbox (macOS nested-sandbox binaries like `qlmanage`, or an explicit owner-requested command needing host credentials) hit a dead end with no safe escape hatch.

**Step 0 baseline (owner Mac, last 30 days `2026-10-25` – `2026-11-24`)**:
- Desktop `server.db` (`computer_call`, `2026-11-17` – `2026-11-24`): **120** `user_computer_shell` calls (8 non-zero/error, **4** runtime `Operation not permitted` occurrences across `bash` [3, old pre-`open-confine` `.bash_profile`], `gh` [1, `~/.config/gh/config.yml`], `ls` [1, `~/.cairn/workspaces`]; 0 `qlmanage`/`sandbox_init` in desktop DB because `open-confine` had not yet shipped to desktop).
- Legacy VM `shell`: **300** calls (44 failed, 0 sandbox denials).
- Mac mini Langfuse (`v2/observations`, switched `2026-11-24`): 60 observations, 0 `user_computer_shell` spans.

## 3. User Scenarios

| Situation | What the user sees | What the system does | Wait & cost |
| --- | --- | --- | --- |
| Normal host command (`ls`, `sips`, `python3`) | Normal reply; no card | Runs sandboxed (`sandbox-exec`/`bwrap`); credential paths remain denied | Immediate; zero extra turns |
| Sandboxed command hits a block, alternative exists (e.g. `qlmanage` → `sips`) | Normal reply with the converted PNG; no approval card | Daemon detects sandbox denial → returns `"blocked by sandbox: <reason>"` → model switches to `sips` in the same turn | 1 extra tool call; 0 owner clicks |
| Command genuinely needs unsandboxed execution, owner present | Coordinator ends turn explaining approval is needed + one inline `ApprovalCard` with exact command and Approve / Decline | Model calls `user_computer_shell({ command, escalate: true })` → server parks `action_proposal` (`host.shell.escalate`) + card; clicking Approve runs that exact command once unsandboxed and wakes the thread | Non-blocking; 1 wake turn after click |
| Owner is away for hours, clicks Approve later | Turn already finished cleanly; pending `ApprovalCard` stays clickable across reloads | Card has `parkedAt` so turn-end cleanup leaves it pending; later click validates `action_proposal`, executes once unsandboxed, wakes thread | Zero hanging turns; 1 wake turn |
| Owner clicks Decline | Card collapses to `已拒绝`; Coordinator replies acknowledging denial | `action_proposal` → `refused`; nothing dispatched to daemon; wake prompt returns `"denied by owner"` | Immediate; 0 daemon calls |
| Owner never clicks within TTL (7 days) | Card settles to cancelled/expired (`审批已过期，没有执行。`) | `sweepExpiredActionProposals` or late click transitions `pending` → `expired` (HTTP 409 on late click); nothing runs | Background sweep |
| Model tries to repeat the same command later | Fresh `ApprovalCard` required | Approvals are single-shot per `action_proposal` and never remembered (`always` rejected with 409) | 1 click per escalated command |
| Hardline destructive command (`rm -rf ~`, `diskutil eraseDisk`, etc.) | Refused immediately; no approval card | Server & daemon both enforce `ownComputerHardlineRefusal` before and after approval | Immediate refusal |

## 4. State Machine & Persisted Data

### States

1. **`sandboxed`** (default execution): `user_computer_shell` invoked with `escalate !== true`. `computer_call` runs with `hostShellEscalation` unset; daemon wraps with `createHostShellConfinement`.
   - Exit 0 → terminal `done` (normal output).
   - Non-zero, ordinary failure → terminal `done` (output + `[exit code N]`).
   - Non-zero, sandbox denial detected → **`blocked`**.
2. **`blocked`**: Daemon sets `sandboxDenied: { reason }` on the `done` frame (`packages/shared/src/protocol/computer.ts`). Server persists `params.sandboxDeniedReason` on `computer_call` and returns a typed tool result starting with `blocked by sandbox: <reason>` plus output and a one-line model-first instruction.
   - Model tries another sandboxed command → back to **`sandboxed`**.
   - Model calls `user_computer_shell` with `escalate: true` → **`pending approval`**.
3. **`pending approval`**: Server validates owner, connected local Mac with `ownComputerShell`, non-untrusted turn, non-hardline command, reviewable command text (≤ 4000 chars, no control/bidi obfuscation chars), and inserts:
   - `action_proposal` (`actionId = 'host.shell.escalate'`, `targetId = sha256(machineId, command, cwd, timeoutMs)`, `status = 'pending'`, `expiresAt = now + ACTION_PROPOSAL_TTL_MS`, `inputJson = { machineId, command, cwd, timeoutMs, cardDigest }`).
   - `action_subscriber` (`wakeStepId = wake:<proposalId>:<threadId>`).
   - `chief_message` (`id = approval-<proposalId>`, `AskUserQuestionContent` with `status: 'pending'`, `parkedAt: now`, options `[APPROVE_CHOICE, REFUSE_CHOICE]`).
   - Tool returns immediately (non-blocking) telling the Coordinator to inform the owner and end the turn.
   - Transitions out of `pending approval`:
     - Interactive owner card click `Approve` → **`allowed`** (`action_proposal.status = 'executed'`, `decision = 'allow-once'`).
     - Interactive owner card click `Decline` or card cancel → **`denied`** (`action_proposal.status = 'refused'`, `decision = 'refuse'`).
     - `now >= expiresAt` (scheduler sweep or late click) → **`expired`** (`action_proposal.status = 'expired'`, `decision = null`).
4. **`allowed`**:
   - Inside an `IMMEDIATE` SQLite transaction, `answerProposal` checks `status === 'pending'`, `isOwner(db, decidedBy)`, `viaCard === true`, intact `cardDigest`, `interactive !== undefined`, `decision === 'allow-once'` (never `'always'`), `expiresAt > now`, and re-validates hardline refusal + local Mac capability; commits `status = 'executed'`, settles `chief_message` to `answered`, writes `action_wake_outbox (outcome = 'executed', state = 'pending')`, and journals `action_journal`.
   - `dispatchActionWakes` triggers `runApprovedHostShellEscalation` once (guarded by in-memory `inFlight` set and deterministic SQLite PK `computer_call.id = computerCallId(wakeStepId, 'host-shell-escalate')`).
   - Server dispatches `ComputerCall` with top-level server-stamped `hostShellEscalation: 'approved'` (never from `params`).
   - Daemon (`dispatch.ts` + `host.ts`) skips `confinement.wrap` ONLY when `call.tool === 'user_computer_shell'` and `call.hostShellEscalation === 'approved'`, still enforcing `ownComputerHardlineRefusal` and `hostCommandEnvironment` (`CAIRN_*` stripping).
   - When the `computer_call` reaches a final state (`done` / `error` / `interrupted` / `cancelled`), `dispatchActionWakes` enqueues `wake:<proposalId>:<threadId>` with the exact command, exit code, and redacted output, and marks `action_wake_outbox.state = 'delivered'`.
5. **`denied`**:
   - `answerProposal` sets `action_proposal.status = 'refused'`, `decision = 'refuse'`, settles card to `answered` (`已拒绝`), writes `action_wake_outbox (outcome = 'refused')`.
   - Nothing is dispatched to the daemon. `dispatchActionWakes` enqueues the wake step with `"denied by owner"` and marks the outbox `'delivered'`.
6. **`expired`**:
   - `sweepExpiredActionProposals` or a late `answerProposal` click (`expiresAt <= now`) transitions `pending` → `expired`, settles the card to `cancelled` (`审批已过期，没有执行。`), writes `action_wake_outbox (outcome = 'expired')`, and rejects late clicks with HTTP 409. Nothing is dispatched to the daemon.

## 5. Read / Write Paths & Security Boundaries

| Component / File | Reads | Writes | Security Boundary / Failure Behavior |
| --- | --- | --- | --- |
| `packages/shared/src/protocol/computer.ts` | — | Wire schemas: `ComputerCall.hostShellEscalation`, `ComputerFrame(done).sandboxDenied` | Top-level server-only grant field separated from `params` |
| `packages/shared/src/protocol/own-computer.ts` | — | `user_computer_shell` tool schema (`escalate?: boolean`) + 1-sentence description | Hardline refusal rules stay unchanged |
| `apps/daemon/src/backend/sandbox-denial.ts` | `exitCode`, `stderr`, `stdout`, `platform`, `confinement.denied` | `{ reason } \| null` | Never matches when `unsandboxed` or `exitCode === 0`; avoids false positives on ordinary failures (`No such file`, `grep` exit 1, bare `"sandbox"` text) |
| `apps/daemon/src/computer/host.ts` & `dispatch.ts` | `ComputerCall`, `hostConfinement` | `ComputerFrame` (`done` with optional `sandboxDenied`) | Ignores `params.escalate`; bypasses `confinement.wrap` ONLY on `call.tool === 'user_computer_shell' && call.hostShellEscalation === 'approved'`; hardline refusal still runs; `readFile`/`writeFile`/`listFiles`/`attach_file` stay strictly confined |
| `apps/server/src/services/host-shell-escalation.ts` | `action_proposal`, `machine`, `computer_call` | `action_proposal`, `chief_message`, `computer_call` | Validates owner, non-untrusted turn, reviewable command, hardline refusal; at-most-once execution via deterministic `computer_call.id`; if Mac offline → `error` (`COMPUTER_NOT_CONNECTED`) + wake, grant never replayed later; if server restarts mid-run → `interrupted` + wake, never auto-retried |
| `apps/server/src/services/action-proposals.ts` | `action_proposal`, `chief_message`, `action_wake_outbox` | `action_proposal`, `chief_message`, `action_journal`, `action_wake_outbox` | Enforces `isOwner`, `viaCard`, intact `cardDigest`, `interactive`, rejects `always` (409), rejects expired (409), dispatches escalated command asynchronously before enqueuing wake |
| `apps/server/src/services/machine-computer.ts` | `computer_call`, `step`, `chief_thread` | `computer_call`, `action_proposal` | Persists `sandboxDeniedReason`; formats `"blocked by sandbox: <reason>"`; routes `escalate: true` to `proposeHostShellEscalation` (never stamps `hostShellEscalation` directly) |
| `apps/web/src/chief/approval-card-model.ts`, `question-answered-line.tsx`, `chief-message-rows.tsx`, `i18n/en.ts` | `AskUserQuestionContent` | Reuses existing `ApprovalCard` & `ApprovalHistoryLine` | Zero new UI components; shows exact command verbatim (`mono: true`) + Approve/Decline; shows `已批准` / `已拒绝` / `已过期` when settled |

## 6. Test Matrix (Red First, One Test Per Path)

1. **Sandboxed success & credential denial preserved** (`apps/daemon/test/sandbox-denial.test.ts`, `apps/daemon/test/host-shell-confinement.test.ts`): normal command succeeds with no `sandboxDenied`; credential path (`~/.ssh`) remains denied in sandboxed mode and emits `sandboxDenied`.
2. **Sandbox denial vs ordinary failure classification** (`apps/daemon/test/sandbox-denial.test.ts`):
   - macOS `qlmanage` nested `sandbox initialization failed: Operation not permitted` → `sandboxDenied`.
   - macOS Seatbelt file/exec `Operation not permitted` (exit 1 / 126) → `sandboxDenied`.
   - Linux `bwrap` `Read-only file system` / `bwrap:` / `SIGSYS` (159) / denied-path `Permission denied` → `sandboxDenied`.
   - Ordinary failures (`No such file`, non-zero exit with `"sandbox"` in doc text, `chmod 000` non-denied path) → `null`.
   - Unsandboxed run (`hostShellEscalation: 'approved'`) → never flagged `sandboxDenied` even if stderr says `Operation not permitted`.
3. **Daemon security boundary** (`apps/daemon/test/computer-dispatch.test.ts`):
   - `params: { command, escalate: true }` WITHOUT `call.hostShellEscalation === 'approved'` still runs sandboxed.
   - `call.hostShellEscalation === 'approved'` runs that single command unsandboxed, while hardline commands (`rm -rf ~`) are STILL refused.
4. **Server typed blocked result** (`apps/server/test/host-shell-escalation.test.ts`):
   - `done` frame with `sandboxDenied` produces `"blocked by sandbox: <reason>"` tool result; ordinary non-zero frame does NOT.
5. **Pending approval (non-blocking) & deduplication** (`apps/server/test/host-shell-escalation.test.ts`):
   - `user_computer_shell({ command, escalate: true })` returns immediately without hanging, parks `action_proposal` + `ApprovalCard` (`parkedAt` set so turn end does not cancel it), and dispatches nothing to the daemon.
   - Hardline command / untrusted turn / non-owner / control-char obfuscation / >4000-char command are refused with no card created.
6. **Allowed path (including owner away / late click & single-shot)** (`apps/server/test/host-shell-escalation.test.ts`):
   - Owner clicks Allow on card → `action_proposal` transitions to `executed`, daemon receives `ComputerCall` with `hostShellEscalation: 'approved'` and exact command, result wakes thread.
   - Second click returns 409; `decision: 'always'` returns 409; non-card API call returns 409; non-owner / non-interactive call returns 403; calling the same command again with `escalate: true` requires a brand-new approval card (never remembered).
   - Mac offline on Allow → records error `COMPUTER_NOT_CONNECTED`, wakes thread, never auto-runs later.
7. **Denied path** (`apps/server/test/host-shell-escalation.test.ts`):
   - Owner clicks Deny → `action_proposal` transitions to `refused`, nothing sent to daemon, wake prompt contains `"denied by owner"`.
8. **Expired path** (`apps/server/test/host-shell-escalation.test.ts`):
   - Past `expiresAt` → `sweepExpiredActionProposals` or late click transitions to `expired`, card becomes cancelled, late click returns 409, nothing sent to daemon.
9. **Approval card UI rendering** (`apps/web/test/approval-card.test.ts`):
   - Unsandboxed shell card renders terminal icon, exact monospace command, single-shot note, Approve/Decline buttons, and collapses to `已批准` / `已拒绝` / `已过期`.
