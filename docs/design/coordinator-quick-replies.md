# Coordinator quick replies

Status: proposed (owner decision 2026-11-11: the Coordinator may attach a few suggested replies to its latest message; the web shows them as chips above the composer and a click sends one).

## Storage

No migration. The Coordinator conversation already lives in `chief_message`, whose `content` column is JSON and already carries typed system rows (`chief_notice`, `chief_turn_error`, `chief_digest`). Suggestions are one more typed system row:

- id `quick-replies-<stepId>`: one row per Coordinator turn; a second call in the same turn replaces the first (last call wins, `upsertChiefMessage`).
- role `system`, content a JSON string `{"kind":"quick_replies","stepId":"…","replies":["…"]}` validated by `quickRepliesContentSchema` (`packages/shared/src/records/quick-replies.ts`): 1 to 3 replies, each 1 to 40 characters.

Nothing else stores or clears suggestions. Visibility is derived from the conversation each time it is read, so no path has to remember to clear them.

## Writer: the `suggest_replies` tool

- Defined in `CHIEF_REPLY_TOOLS` (`packages/shared/src/protocol/chief-tools.ts`), outside the pinned 47-tool vocabulary, the same way the D60 router tools are. Registered for the in-server runtime (`coordinator/runtime/tools.ts`) and the daemon-run Coordinator (`chiefRemoteTools()`).
- Executed in `executeChiefTool` through `services/chief-quick-replies.ts`. The relay path (`machine-relay.ts`) already refuses calls without a claimed chief step and digest runs only get read tools; no security-surface file changes.
- Params `{replies: string[]}`. `sanitizeQuickReplies` collapses whitespace and newlines, strips markdown markup (`` ` * ~ # > [ ] < | ``, leading list markers), trims, drops empties and case-insensitive duplicates. More than 3 items, an item over 40 characters after cleaning, a non-string item, or nothing left is a 400 the model sees as a tool error; nothing is written.
- Refused in event turns (`[wake:…]`): their text never reaches the owner, so there is no message to attach to.
- Result to the model: `{"shown":[…]}`. The `suggest_replies` tool call row itself is hidden from the web transcript.
- Prompt: one line in the working rules: offer suggestions only after a simple open question or a proposed next step with obvious short answers, at most 3, in the owner's language; never for destructive or irreversible confirmations, which go through `ask_user`.

## Wire

Unchanged endpoints. The row reaches the web in `GET /api/conversations/:id/messages` and on the conversation SSE stream (`convHub.publishMessage`), like a notice. Old clients ignore an unknown system row (`collectChiefStream` skips it). Old servers never write one, so new clients show no chips.

## Reader: `liveQuickReplies(rows, {running, runningStepId})`

Shared pure function, used by the web `mapChief` to set `ChiefContent.quickReplies`. It returns the replies of the newest valid row only when:

| # | Row | Expected | Test |
|---|---|---|---|
| 1 | Latest message is the Coordinator's reply from the same turn, turn finished or still running (owner fidelity pass, 2026-11-11: the chat draft shows the chips while the turn that offered them keeps working) | chips shown | shared `quick-replies.test.ts` "shows…", "same turn is still running"; e2e "shows chips", "chips stay while the turn that offered them is still running" |
| 2 | Owner sends anything after it (chip or typed; a user row exists after it) | hidden | shared "owner send"; e2e "click sends" |
| 3 | A newer turn starts: the thread runs (`activeRun` set) and the live step activity names a different step than the row's `stepId`, or names none yet (a wake turn writes its prompt row only when it ends), or an event-turn prompt row follows it | hidden | shared "hidden once a newer turn runs"; server "new event turn"; e2e "chips hide while a newer Coordinator turn is running" |
| 4 | A question is pending (pending `ask_user_question` row, or the web question dock shows any question) | hidden; dock wins | shared "pending question"; e2e "hidden with question" |
| 5 | Any non-assistant row after it (notice, thread report, turn error, stop marker) | hidden | shared "later system row" |
| 6 | Turn produced no reply text (no assistant text after the turn's start) | hidden | shared "no anchor" |
| 7 | Row absent or fails the schema (old server, tampered row) | no chips | shared "absent/invalid"; server "old messages" |
| 8 | Rewind past the turn | row deleted with the turn's rows | existing rewind delete covers `chief_message` |

## Click

`QuickReplies` (new `apps/web/src/chief/quick-replies.tsx`) renders real buttons above the main composer, only in the Coordinator composer mode (not when the composer targets a task thread or answers a question). A click calls the conversation's `onSend(text)`, the same path as typing: `useChiefSurface.onSend` keeps the send key, shows the existing error toast and rethrows. While the send is in flight the chips are disabled; on failure they stay (the conversation is unchanged); on success the new owner row hides them (row 2).

## Failure behaviour

- Tool rejected (caps, event turn): tool error to the model, no row, no chips.
- Row written but the turn then fails or is stopped: the error or stop row follows it, row 5 hides the chips.
- Send fails: toast, chips stay enabled again, draft in the composer untouched.
- Unverified: real-model behaviour (whether and when the model calls the tool) needs a live model run.
