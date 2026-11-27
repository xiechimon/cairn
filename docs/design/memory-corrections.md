# Memory corrections: keeping the evidence

Change 2 of [agent memory systems](../research/agent-memory-systems-2026-11-26.md) section 7. When a user corrects the agent, Cairn keeps what happened so a later reader can judge whether saved rules are being injected and followed. Cairn stores facts only: it draws no conclusion that the model saw a rule or that retrieval missed it, and keeps no counts. What a model actually had in front of it depends on prompt reuse, chat history, recall and compaction, and no stored field can establish it.

## What the user sees

Nothing new to set or to look at. The user corrects the Coordinator or a task in chat, as before. The agent writes memory as before. If the correction turn is not a clear single-owner exchange, the write still happens and the tool result says the correction was not recorded.

Owner decision (2026-11-27, option 1): whenever a turn has a mid-turn interjection or a typed answer to a question, do not record the correction's verbatim words; save the memory as usual and tell the agent nothing was recorded.

A turn is unclear when it had a mid-turn interjection or a typed answer to a question card. In those cases Cairn does not store the correction's verbatim words. This is deliberate: when the words in the turn cannot be attributed cleanly, storing the wrong sentence is worse than storing none. Tapping a predefined choice is still recordable; typed free text and a typed custom choice are not.

## State

Table `memory_correction`. Rows are inserted and deleted, never updated.

| Column | Meaning |
| --- | --- |
| `teamId` | owner |
| `ownerMessageId`, `ownerWords` | the message that identifies the user's exchange, and what the user said in it, verbatim, newest first, up to 1,000 characters |
| `pointedFile`, `pointedRule` | the old saved rule the agent pointed at: a `MEMORY.md` line, or a file name; null when it pointed at none |
| `inTurnIndex` | whether that line is in the loaded part (200 lines, 25 KiB) of a memory index attached to this turn; false for a file, whose text no index holds; null without a rule, and when the runner may not have been sent the prompt again |
| `projectId` | scope of the pointed rule, or of the write when there is none |
| `buildId`, `stepId`, `createdAt` | conversation, turn and insert time |

`message.sentByAgent`, `queued_message.sentByAgent` and `chief_message.sentByAgent` mark text an MCP client sent in the user's name. `message.typedAt` and `chief_message.typedAt` keep when the user typed a message whose `createdAt` later became its delivery time. These fields identify authorship and typing time only; Cairn does not track whether a task steer was served, read or acknowledged for memory evidence. Mid-turn worker messages carry a `human-steer-` or `steer-` id prefix instead of extra steer-delivery columns.

`step.ownerSaid` keeps user words that have no message row: a message that restarts a stopped task (stored otherwise only inside the new thread's prompt), and the text of a paired chat app message (stored otherwise only inside the Coordinator turn's prompt).

`step.memoryTrace` holds the index ids attached to a turn. Worker claims record it too, with the same shape.

## Rules

1. **User words are required.** Cairn does not guess which message carries the correction.
   - Coordinator turn: the step's `ownerSaid`, then the user messages and answered question cards in its `ownerMessageIds`. The first one identifies the exchange, so resumed and retried turns stay one exchange; `ownerSaid` is identified by its step id.
   - Worker turn: the messages with origin `user` in the turn's own thread sent after the last turn of that thread that succeeded, so a rerun of a failed or stopped turn keeps the message that started it. The first one identifies the exchange. The task prompt is not a user message. Messages of earlier threads of the task are not used: the words that restarted a stopped task are read from the new thread's `ownerSaid`, until a turn of that thread succeeds, and an earlier message never stands in for them.
   - A design-comment send is not user words: the chat message carries quotes from the artifact and Cairn's own notice.
   - Text and answers an MCP client sent are not user words, in chat and in task threads, whether sent at once, steered or queued. A message the user queued stays theirs when an MCP interrupt is what delivers it.
   - A quoted reply keeps only the text typed under the quote.
2. **An unclear turn records nothing.** The memory write is applied, no `memory_correction` row is written, and the tool result says the correction was not recorded.
   - Coordinator: a turn is unclear when any owner message in it carries `chief_message.delivery` (`steer` or `steer_missed`), when `coordinator_input` or `steer_pending` targets it with a steer, when the turn is claimed while a waiting steer step holds `STEER_HOLDS`, or when a typed answer to a question card belongs to the turn. A card belongs to the turn when its id is in `ownerMessageIds`, when it was answered while the turn ran (not already owned by another turn), or when its typed answer matches a composer message inserted right before it was answered (plain question answered while parked).
   - Worker: a turn is unclear when any user message in the exchange window after the last `done` step carries the mid-turn steer id prefix (`human-steer-` or `steer-`), when `steer_pending` targets the turn, or when a typed answer to a worker question belongs to the turn (`deliveredStepId`, a `continue` continuation step for a question answered since the last `done` step, or answered in the current exchange window / while the turn ran).
   - The whole turn records nothing, not just the interjected or answer message.
   - A predefined choice tap is not typed text. A custom choice is typed text. A Coordinator-relayed answer to a worker question (`answeredBy: 'coordinator'`) is not user words.
3. **The agent points; Cairn does not infer.** `repeats` copies the saved index line or file name. Nothing is read from what a write removes or rewrites.
4. **Old** means a version holding the line, or the live file and its earlier versions, existed before every quoted message was typed (for a queued message, when it was queued) and before the turn was claimed. A rule named that is not old is recorded as no rule.
5. **`inTurnIndex` is read from the turn's own trace.** A line counts wherever it is attached, including the same text in another scope's index. The trace describes what was sent: a turn that reuses an earlier system prompt records the ids that prompt was built from, and project memory steered into a running turn is added to it when the steer is delivered; until then it waits on the queued step. A step claimed again never reuses the prompt it built itself, so its new trace matches what it sends. A resumed Antigravity session is sent no system prompt, so a turn that already has a session id, and any later turn of an Antigravity conversation, stores null instead of true or false for an index line.
6. **One row per exchange and rule.** A row without a rule exists only while the exchange has no other row; the first pointed rule replaces it with a new row, so every row is newer than all the words it quotes.
7. When the agent points at an old rule, the tool result carries `pointedRule` (including on unclear turns where no words are stored, judged against the turn's claim time). For Coordinator turns, if that rule carries no `(todo:...)` check pointer, the tool result also returns `next` instructing the Coordinator to offer a repository check task via `ask_user` (or say plainly that the rule cannot be checked and stays advice). On acceptance, `create_todo` cites both the correction message and the answered card, and `update_memory` appends one pointer to the task link.

## Transitions

| Stored for the exchange | Event | Rows afterwards |
| --- | --- | --- |
| nothing | a correction write with no old rule in a clear turn | one row without a rule |
| nothing, or the row without a rule | an old rule is pointed at in a clear turn | one row for that rule |
| a row for a rule | another old rule is pointed at in a clear turn | one row for each |
| any | the same rule again, or a correction write with no old rule | unchanged |
| any | the task, project or chat messages behind a row are deleted | deleted |
| anything | the turn is unclear, or there are no user words | no new row; existing rows are unchanged |

The memory write happens as the call asks in every row above.

## Writers and readers

| Path | Effect |
| --- | --- |
| `executeMemoryToolForStep` (Coordinator and worker relays) | only writer; memory write and row in one transaction |
| `deleteTodo`, `deleteProject`, Coordinator chat rewind | delete the rows made from what they remove; a rewind removes the chat's rows made since the first removed message |
| `GET /api/teams/:id/chief/memory-corrections` | only reader: the latest 200 rows, no totals |
| Coordinator turn builder, steering, reused prompt; worker claim | write `step.memoryTrace` |
| Every user message insert and queued message insert made through the MCP server, question answers included | set `sentByAgent` |
| Queued message delivery | writes `message.typedAt` and carries `sentByAgent` |
| Coordinator steer delivery (runner acknowledgement, in-server input) | writes `chief_message.typedAt` before moving `createdAt` |
| A message to a stopped task; a paired chat app message | set `step.ownerSaid` |

## Failures

| Failure | Behavior |
| --- | --- |
| Memory write refused (stale version, bad input) | error returned, no row |
| `repeats` matches no saved entry | 400 before any write, so the agent can read and copy it |
| `repeats` without `correction: true` | 400 |
| Row insert fails | transaction rolls back, the memory write is not applied |
| Turn reclaimed after a crash and the call replayed | no second row |
| A message insert time cannot be distinguished from the turn that started it | treated as part of the starting input, not as an interjection |

## Delivery paths

Every path that puts a message the user could have written into a Coordinator or task turn. "Test" names a case in `apps/server/test/memory-corrections.test.ts` unless a file is given.

| Path | Recorded | Test |
| --- | --- | --- |
| Coordinator composer, new turn | yes | words typed into the Coordinator composer are kept |
| Coordinator composer, steer into a running turn | no | a Coordinator steer delivered by the runner records no correction words; a steer a runner fetched but never acknowledged records no correction words |
| Coordinator waiting messages that were never steered, own turn or folded | yes | waiting Coordinator messages folded into one turn are all quoted |
| Coordinator steer missed, then run as or folded into a later turn | no | a steer the runner missed records no correction words in the turn that then runs it; missed Coordinator interjections folded into one later turn record no correction words |
| Coordinator rerun or retry | the original clear input, if it was never a steer | a retry of the turn that saved the rule does not treat it as old |
| Quoted reply in the Coordinator composer | the typed text only, when the turn is clear | a quoted reply keeps only what the user typed |
| Suggested reply tapped | yes, the tapped text, when the turn is clear | words typed into the Coordinator composer are kept |
| Coordinator rewind | clear input only | rewinding the chat removes the evidence copied from the removed messages; rewinding to a steered message keeps its words as the evidence |
| Typed answer to a Coordinator question card, live or parked | no | a typed answer to a Coordinator question card records no correction words; a custom choice typed on a Coordinator question card records no correction words |
| Typed composer answer to a pending plain Coordinator question, live or parked | no | a typed composer answer to a plain Coordinator question records no correction words; a parked plain Coordinator question answered from composer records no correction words |
| Predefined Coordinator question option tapped | yes | a predefined Coordinator question option tap still records correction words |
| Question card answered by an MCP client, live or parked | no, agent | an answer an MCP client gave to a Coordinator question is not the user words |
| Question option tapped in a chat app | yes, the chosen option | `im-core.test.ts`: an option tapped in the chat app is kept as what the user chose |
| Approval card | no, it carries a decision and no words | `im-core.test.ts`: approving a card in the chat app leaves no words to quote |
| Paired chat app message | yes | `im-core.test.ts`: the words of a paired chat app message are kept as evidence of a correction |
| Orchestrate button | no, Cairn writes the text | the instruction Cairn writes when the user presses orchestrate is not their words |
| Design comment send | no, mixed with artifact quotes | design comments relayed through the chat are not stored as the user words |
| Wakes: reports, mail, memory edits, schedules, pull requests | no, no user message | a turn the user did not send writes memory and records nothing; messages the system or the Coordinator sent are not the user correcting |
| Task message box and `/api/conversations/:id/messages`, new turn | yes | words the user sent through the task page message box are kept |
| Task steer into a running turn | no | a task steer records no correction words even after the runner acknowledges it |
| Task queued message, delivered or sent now | yes when it starts a later turn, judged at the time it was queued; no when delivered into a running turn | a queued task message is judged against the time the user typed it |
| Queued message moved to a new thread | keeps its author | a queued task message that moves to a new thread keeps its author |
| Plan revision and review rejection feedback | yes | words the user sent through plan revision feedback are kept; words the user sent through review rejection feedback are kept |
| Restart feedback on a failed task | yes | a worker turn records its trace and a follow-up correction, never the task prompt |
| Message to a stopped task | yes | words sent to a stopped task are the ones kept, never an earlier message |
| Typed answer to a worker question (thread message box or `answerTaskQuestion`, held or parked) | no | an answer the user typed to a worker question records no correction words; a typed answer via answerTaskQuestion records no correction words |
| `/api/todos/:id/messages` | yes | words the user sent through a task reply from the Coordinator chat are kept |
| Coordinator relay to a task: messages, answers, design comments | no, the Coordinator writes it | what the Coordinator sends a task is not the user words |
| MCP `message_todo` / `reply_thread`, at once, steered or queued | no, agent | task text an MCP client sent is not the user words |
| MCP `interrupt_thread` delivering a queued message | stays with whoever queued it | a queued message the user typed stays theirs when an MCP interrupt sends it |
| Rerun or retry of a task turn | the original clear words, until a turn succeeds | a rerun of a stopped turn judges the rule against the first message it quotes; a rerun of the thread a stopped task restarted keeps the words that restarted it |
| Prompt rows a runner echoes back | no, not origin `user` | messages the system or the Coordinator sent are not the user correcting |

## Tests

`apps/server/test/memory-corrections.test.ts` and `apps/server/test/im-core.test.ts` cover each transition, writer, delivery path and failure; `apps/server/test/coordinator/memory-correction-warm.test.ts` covers the attached index of a turn that reuses its prompt.

## Limits

The rows are a partial record. Corrections the agent never marks, and rules it does not point at, are missing. Whether a rule was pointed at correctly is the model's judgement: read `ownerWords` next to `pointedRule`. A turn with a mid-turn interjection or typed answer has no row at all, even when a human reader could have attributed the words.

- `inTurnIndex: false` does not mean the model never saw the rule: it may have been in chat history, a recalled line, an earlier prompt or a `memories` call. `true` does not mean the model read or applied it.
- A correction handled by an automatic retry in a new thread is not recorded.
- A Coordinator turn that replaces a failed one with a new step does not carry `ownerSaid`, so a chat app message handled that way is not recorded.
- A task correction that arrives only through the Coordinator or another system message is not recorded.
- A worker answer relayed by the Coordinator is not user words.
- Design comments, and the note typed with them, are not recorded.
- A memory file rename, delete or fold edits some index versions in place, so a check made after such an edit in the same turn reads the edited text.
- A queued message edited after it was queued is judged against the time it was first queued. A queued message an MCP client wrote stays marked as that client's after the user edits it, so the edit is not recorded.
- A suggested reply the user taps is recorded as the user's words, although the agent wrote the text.
- An approved paired chat contact's text is stored as the user's words although that person may not be the owner.
- A message the app held and sent later, including a stranded queued message sent again, is judged against the time the server received that send.
- A long turn is cut to 1,000 characters, newest first.
- A user who changes their mind about a saved fact looks the same as a correction when the agent points at the old line.
- Rebuilding a claimed turn's context replaces the trace.
- Only the text of a chat app message is kept, not words inside its attachments.
- Messages stored before `sentByAgent` existed, and text a script posts through the REST API, are treated as the user's.
- A daemon-run Coordinator records the trace its claim built.
- Facts caught only by the compaction extraction are not corrections and make no row.
- Question-answer matching for parked plain Coordinator questions uses message insert time and question answer time; a parked plain question answered before the next unrelated turn has no overlap.
