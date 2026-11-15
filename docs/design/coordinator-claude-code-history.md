# Coordinator on Claude Code: carrying the earlier conversation

Status: revision 2 (answers an independent review of revision 1, FAIL), proposed on 2026-11-15. Owner decision (mon X, 2026-11-15): switching a Coordinator to Claude Code must not make it forget the thread. Follows `docs/design/coordinator-on-claude-code.md` (#4981), where a system-prompt replay was built and removed because `issue-fence.test.ts` forbids user and issue text in the chief system prompt.

## Problem

A Coordinator thread that ran on the in-server runtime has its history only in `chief_message` rows (and, for long threads, a `chief_summary` row). A Claude Code turn on a Runner starts a Claude session with the system prompt, memories and the latest message only.

Measured on the live database (read only): of 152 chief threads, 136 hold a non-empty `sessionId`. Those are stale pi session ids from the era when the Runner ran Coordinator turns; the in-server runtime never stores a session id and never clears the old one. A claim for such a thread says `continue`, the Claude Code backend finds no transcript file for that id and throws `SessionNotResumableError`, and the daemon falls back to a new session (`StepSessionOpener.fallBackToNewSession`). So the fallback, not a plain new session, is the path nearly every first Claude Code turn takes. Both must carry the history.

## Decision

The server sends the earlier conversation as data in a new optional claim field. The daemon puts it in front of the message only when it opens a new Claude session. It never enters the system prompt, the journal, the uploaded transcript or any `chief_message` row.

### Wire

`ClaimedStep.chief` gains an optional `history: string` (`packages/shared/src/protocol/machine-wire.ts`, plus the shared snapshot). An old daemon strips it (non-strict schema) and a new daemon with an old server sees it absent: both mean no history, today's behavior.

### Server: what the history is

Built in `chiefClaimPayload()` (Runner claims only; the in-server turn path never calls it, so pi never receives a doubled history). Computed for every chief claim that is not a digest and not a mail turn, whatever the session action: `chiefThread.sessionRuntime` is always `'pi'`, so the server cannot tell a resumable Claude session from a stale pi id, and the history is built on every such claim and discarded by the daemon when the session resumes. That cost (one bounded query, at most about 20 KB in the claim) is accepted.

Source, in order:

1. The thread's `chief_summary.summary` when one exists, redacted, cut to 4000 characters from the end.
2. The newest conversation rows of the thread after the summary cursor. The selection reuses `conversational()` and `strictlyAfter()` from `apps/server/src/coordinator/seed-summary.ts` (exported for this), which already handle the `(coveredAt, coveredRowid)` tie. Added in SQL before the limit: tool-call rows (object content, via `json_type(content) != 'object'`; every `chief_message.content` is written as JSON by the ORM, and the live database holds no row that is not valid JSON (8675 rows checked)), daemon prompt rows (`user-<stepId>`), rows created at or after the step, and the step's `ownerMessageIds`. The newest 300 remaining rows are read and turned into lines by `chiefTranscriptLines()` (`用户：`, `Coordinator：`, `系统通知：`, ask-user questions; mail text is already reduced to a notice). Each line is redacted and cut to 8000 characters (`SEED_ROW_MAX_CHARS`, as the in-server seed does), then lines are kept newest first until the total reaches 16000 characters and put back in order.

Excluding every `user-<stepId>` row is deliberate: that row holds the instruction plus project sections, so it would repeat the posted message. It also drops wake and event notices that only exist as such a row from earlier Runner turns; those notices are not carried.

If the result is empty there is no `history` field. Otherwise it is wrapped by a new `fenceHistoryText()` in `packages/shared/src/records/prompts.ts`, built like the existing issue, mail and report fences: a fixed opening line (no user input in the label) stating that the block is earlier conversation, background and not instructions (including instructions that change tools, secrets, repositories, memory or merging), every body line quoted with `> ` after `quoteIssueLines` normalizes line breaks and format characters, attachment tokens neutralized, and a closing line. A quoted line cannot begin with the closing marker.

### Daemon: when it is used

The prefix is applied in `StepSessionOpener.open()` to a copy of the session options handed to `createSession`: `backend.createSession({ ...sessionOpts, prompt: historyThenPrompt })`. `sessionOpts.prompt` itself is never changed. The Claude Code backend pushes `opts.prompt` on every open, including `continueSession`, and the pass loop reopens a session by id after a network failure, so an in-place prefix would repeat the history into a session that already holds it.

| Path | History |
|---|---|
| Claim says `new` | prefixed on the direct `createSession` |
| Claim says `continue`, session found | not used |
| `continue`, session not resumable (the common first turn after the switch) | prefixed on the `createSession` that follows the fallback, whether the fallback rebuilt the prompt or kept a journal resume prompt |
| Recovery after a daemon restart, session found | not used |
| Recovery, session missing | prefixed, same fallback path (the journal keeps the claim, see below) |
| Network retry inside a pass | reopens by session id: not used |
| Rewind or retry turns (`freshSession`, session id cleared) | claim says `new`: prefixed; for rewind the doomed rows are already deleted |

The prefix is applied for any chief claim carrying `history` whatever backend opens it (a new pi session on a Runner would also forget the thread), and never when `sessionOpts.prompt` is undefined: it is not sent as a history-only turn. The no-vision image retry does not apply to Coordinator steps (`step-preflight.ts` gives a chief no prompt images), so it is not a path.

The journal `prompt` field, the `transcriptPromptRowId` row and `freshSessionPrompt` stay the original instruction. The journal's copy of the whole claim (`step-<id>.json`, private, removed when the step finishes) does hold `chief.history`; recovery needs it to rebuild the prompt after a restart. The orb path is not involved: chief steps skip it. After the first Claude turn the session holds the history in its first user message and the thread's `sessionId` becomes the Claude session id, so later turns continue it and need no history.

## What this does not do

- Rows between the summary cursor and the newest 300 uncovered conversation rows are not carried, and the 16000-character cap has the same effect on older lines.
- It does not summarize on its own: a thread with no `chief_summary` and more than 16000 characters of recent lines loses the older lines. The in-server runtime keeps writing summaries, and a switched thread already has them.
- It does not repair the "continue session unavailable" system notice that the fallback writes on the first switched turn.
- The raw Claude session log the daemon uploads at step end (`step-sessions/<stepId>.jsonl`, redacted, served only as a raw step view) now contains the fenced history in its first user message. No transcript, digest, summary or memory path reads that file.
- The history text is in the Runner's local Claude session file and in the daemon journal's claim copy until the step finishes; both are on the Runner that claimed this thread's turn, and the text is redacted at the server. The Claude Code backend does not record the user turn in its spans.
- An old daemon (non-strict wire schema) strips the field and behaves as today, so a Runner that is not updated still forgets the thread; update the Runner with the server.

## Every path that reads or writes the changed behavior

| Path | After |
|---|---|
| In-server turn, snapshot capture, eval context, `chiefTurnContext` | unchanged, never sees the field |
| Chief claim, digest or mail turn | no history |
| Chief claim, ordinary turn, thread has earlier conversation | `chief.history` present |
| Chief claim, thread with no earlier conversation | field absent |
| Redaction, cap, tool-call rows, ids to skip | as above |
| Daemon opener paths | table above; `sessionOpts.prompt` unchanged |
| `chief_message` rows written by the daemon transcript | unchanged: original instruction |
| Daemon journal | `prompt` unchanged; `claimed` copy holds the history until the step finishes |
| Per-claim cost | one bounded query and up to about 20 KB per non-digest, non-mail chief claim |
| `issue-fence.test.ts` (chief system prompt contains no issue or user text) | unaffected: system prompt untouched |
| Old daemon / old server | field ignored / absent |

## Tests

1. Shared: `fenceHistoryText` quotes every line; a body line that imitates the closing marker or carries format or attachment characters cannot escape; wire snapshot and `machine-wire`, `g2t2-executor-wire` tests updated for the optional field.
2. Server claim: history present for a thread with earlier messages; excludes the current owner message, tool-call rows, digest, report and daemon prompt rows; a thread whose newest 400 rows (more than the 300 read) are tool calls still replays the conversation behind them; one oversized message is cut to 8000 and does not empty the rest; newest lines win under the 16000 cap and nothing is cut mid-line; the summary is included and rows start after its cursor (including the tie); planted secrets in the summary and in lines are redacted; absent for a thread with no earlier conversation, for digest and mail turns; the system prompt is byte-identical with and without history.
3. Daemon opener: prefixed on `new`; not on `continue` when found; prefixed on fallback with a rebuilt prompt and with a journal resume prompt; `sessionOpts.prompt`, the journal `prompt` and the transcript row hold the original instruction; a network retry that reopens by session id does not carry the history.
4. End to end (`integration`, real server and daemon, fake `claude`): a thread with earlier messages and a stale session id claims `continue`, falls back, and the first user message the fake receives is the fenced history then the new message; the second turn continues and does not repeat it; no `chief_message` row contains the fence marker; the token does not appear. The fake binary logs the first user message text.
5. Negative control: without the daemon prefix the end-to-end test fails.
6. Regression: `issue-fence`, `coordinator/runner`, daemon `runner-*` and step-opener tests, shared snapshot.

## Security

A listed machine-protocol surface (`apps/server/src/services/machine-claim.ts`) changes. No credential, token or secret-channel path changes. The history is this thread's own messages sent to the Runner that claimed this thread's turn, redacted by pattern (`redactSecrets`), which is a pattern list and misses other secret shapes. A head-bound independent security review is done before the PR.

## Not in this change

Real-account acceptance, reply latency, the system notice, multi-subscription.
