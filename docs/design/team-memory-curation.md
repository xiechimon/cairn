# Team memory curation

Approved by ian on 2026-11-19 (Coordinator context design, section 4.8 "team memory").

## Problem

The Coordinator wrote team memory whenever it judged a fact "clearly useful later". The team
`MEMORY.md` grew duplicates, stale rules that contradict the system prompt, one-off facts and
project facts, and every line is injected into the system prompt on every turn.

## States

- Team `MEMORY.md` (the `agent_memory` core row with `projectId = null`): the text the model reads.
  Unchanged format: one `- title：content` line per entry.
- `team_memory_entry`: one row per live line of the team index, keyed by `(teamId, line)`, with
  `sourceMessageId`, `source`, `writtenAt` and `lastUsedAt`. A line edited in place is a new entry;
  a removed line drops its row.

## Write paths

| Path | Rule enforced in code |
| --- | --- |
| `update_memory` on team `MEMORY.md` (Coordinator, worker, settings PATCH, memory-edit turn) | Rejected with 400 when the new text is over 2,000 characters and longer than before ("merge or delete old entries first"); shrinking an over-cap index is always allowed. Rejected with 400 when an added line names a listed, unarchived project other than the research project, pointing at that project's scope. Successful writes sync `team_memory_entry`, recording the turn's last user message id as the source. |
| Compaction memory flush | The model sees numbered team entries and answers with `replaces` (entries a new one supersedes) and `used` (entries the conversation relied on). Before saving new entries: `used` entries get `lastUsedAt = now`; `replaces` entries and entries unused for 90 days are removed, at most 25% of the entries per run, conflicts first. New entries naming a project are routed to that project's memory. A new entry that would push team memory over the cap is skipped. |

The "one month test" and the write rules live in the Coordinator's `update_memory` description and
the flush prompt, not in the system prompt; the system prompt's memory section only says to write
when the user says "remember" or corrects the Coordinator.

## Failure behaviour

- Cap or project rejection: the tool call fails with the reason; nothing is written.
- Flush curation failure throws inside the flush, which the compaction already treats as a
  non-blocking flush failure.
- Entries that existed before this change get `writtenAt = lastUsedAt` set to the time they are
  first synced, so nothing retires for 90 days after rollout.

## Existing memory

A one-off review of the existing team memory under these rules is proposed to its owner and written back
only after he confirms it.
