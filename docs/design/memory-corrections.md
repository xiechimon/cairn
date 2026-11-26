# Memory corrections: keeping the evidence

Change 2 of [agent memory systems](../research/agent-memory-systems-2026-11-26.md) section 7. When a user corrects the agent, Cairn keeps what happened so a later reader can judge whether saved rules are being injected and followed. Cairn stores facts only: it draws no conclusion that the model saw a rule or that retrieval missed it, and keeps no counts. What a model actually had in front of it depends on prompt reuse, chat history, recall and compaction, and no stored field can establish it.

## What the user sees

Nothing new to set or to look at. The user corrects the Coordinator or a task in chat, as before. The agent writes memory as before and says that this write records a correction.

## State

Table `memory_correction`. Rows are inserted and deleted, never updated.

| Column | Meaning |
| --- | --- |
| `teamId` | owner |
| `ownerMessageId`, `ownerWords` | the message that identifies the user's exchange, and what the user said in it, verbatim, newest first, up to 1,000 characters |
| `pointedFile`, `pointedRule` | the old saved rule the agent pointed at: a `MEMORY.md` line, or a file name; null when it pointed at none |
| `inTurnIndex` | whether that line is in the loaded part (200 lines, 25 KiB) of a memory index attached to this turn; false for a file, whose text no index holds; null without a rule |
| `projectId` | scope of the pointed rule, or of the write when there is none |
| `buildId`, `stepId`, `createdAt` | conversation, turn and insert time |

`step.memoryTrace` holds the index ids attached to a turn. Worker claims record it too, with the same shape.

## Rules

1. **User words are required.** Cairn does not guess which message carries the correction.
   - Coordinator turn: the user messages and answered question cards in the step's `ownerMessageIds`. The first one identifies the exchange, so resumed and retried turns stay one exchange.
   - Worker turn: the messages with origin `user` in the turn's own thread sent after the last turn of that thread that succeeded, so a turn quotes what started or steered it, and a rerun of a failed or stopped turn keeps the original message. The first one identifies the exchange. The task prompt is not a user message. Messages of earlier threads of the task are not used: a correction sent to a stopped task starts a new thread whose text is stored only as the prompt, and an earlier message must never stand in for it.
   - A design-comment send is not user words: the chat message carries quotes from the artifact and Cairn's own notice.
   - With neither, the memory write is applied, nothing is recorded and the tool result says so.
2. **The agent points; Cairn does not infer.** `repeats` copies the saved index line or file name. Nothing is read from what a write removes or rewrites.
3. **Old** means a version holding the line, or the live file and its earlier versions, existed before the first quoted message and before the turn was claimed. A rule named that is not old is recorded as no rule.
4. **`inTurnIndex` is read from the turn's own trace.** A line counts wherever it is attached, including the same text in another scope's index. The trace describes what was sent: a turn that reuses an earlier system prompt records the ids that prompt was built from, and project memory steered into a running turn is added to it when the steer is delivered; until then it waits on the queued step.
5. **One row per exchange and rule.** A row without a rule exists only while the exchange has no other row; the first pointed rule replaces it with a new row, so every row is newer than all the words it quotes.
6. When the agent points at an old rule, the tool result carries `pointedRule`.

## Transitions

| Stored for the exchange | Event | Rows afterwards |
| --- | --- | --- |
| nothing | a correction write with no old rule | one row without a rule |
| nothing, or the row without a rule | an old rule is pointed at | one row for that rule |
| a row for a rule | another old rule is pointed at | one row for each |
| any | the same rule again, or a correction write with no old rule | unchanged |
| any | the task, project or chat messages behind a row are deleted | deleted |
| nothing | no user words | none |

The memory write happens as the call asks in every row above.

## Writers and readers

| Path | Effect |
| --- | --- |
| `executeMemoryToolForStep` (Coordinator and worker relays) | only writer; memory write and row in one transaction |
| `deleteTodo`, `deleteProject`, Coordinator chat rewind | delete the rows made from what they remove; a rewind removes the chat's rows made since the first removed message |
| `GET /api/teams/:id/chief/memory-corrections` | only reader: the latest 200 rows, no totals |
| Coordinator turn builder, steering, reused prompt; worker claim | write `step.memoryTrace` |

## Failures

| Failure | Behavior |
| --- | --- |
| Memory write refused (stale version, bad input) | error returned, no row |
| `repeats` matches no saved entry | 400 before any write, so the agent can read and copy it |
| `repeats` without `correction: true` | 400 |
| Row insert fails | transaction rolls back, the memory write is not applied |
| Turn reclaimed after a crash and the call replayed | no second row |

## Tests

`apps/server/test/memory-corrections.test.ts` covers each transition, writer and failure; `apps/server/test/coordinator/memory-correction-warm.test.ts` covers the attached index of a turn that reuses its prompt.

## Limits

The rows are a partial record. Corrections the agent never marks, and rules it does not point at, are missing. Whether a rule was pointed at correctly is the model's judgement: read `ownerWords` next to `pointedRule`.

- `inTurnIndex: false` does not mean the model never saw the rule: it may have been in chat history, a recalled line, an earlier prompt or a `memories` call. `true` does not mean the model read or applied it.
- A correction sent to a stopped task, and one handled by an automatic retry in a new thread, is not recorded.
- A task correction that arrives only through the Coordinator or another system message is not recorded. A message typed while a turn that then succeeded was running belongs to that turn.
- A worker answer typed in the thread is a user message and can be quoted; one relayed by the Coordinator is not.
- Design comments, and the note typed with them, are not recorded.
- A memory file rename, delete or fold edits some index versions in place, so a check made after such an edit in the same turn reads the edited text.
- A resumed daemon session may not be sent its system prompt again, while its trace lists the ids built at claim.
- A long turn is cut to 1,000 characters, newest first.
- A user who changes their mind about a saved fact looks the same as a correction when the agent points at the old line.
- Rebuilding a claimed turn's context replaces the trace.
- Messages that arrive from a messaging channel are not recorded: those turns carry no owner message ids.
- Text an external agent posts to a task through the MCP server is stored as a user message and can be recorded.
- A daemon-run Coordinator records the trace its claim built.
- Facts caught only by the compaction extraction are not corrections and make no row.
