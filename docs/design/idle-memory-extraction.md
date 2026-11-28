# Idle memory extraction and retained conversation history — 2026-11-28

## User scenario

A newcomer tells the Coordinator that a project ships on Thursdays, then leaves. Today, unless the chat grows long enough to compact or they explicitly ask the Coordinator to remember, a later turn can miss the rule. After ten quiet minutes, Cairn should save durable facts to the same Settings → Memory store used by compaction; the next turn can read them without any new setting, account, or key. The configured summary provider receives a bounded excerpt of new messages, existing memory, and the project list; no request is sent without a usable provider. This consumes summary tokens but does not hold the foreground turn. An old conversation, worker transcript, or turn diagnostic remains available without an age cutoff. The history itself is not sent again just to retain it.

Explicitly asking the Coordinator to remember already works but makes the user responsible for noticing every durable fact. A main-channel-only sweep misses project rules; applying the existing flush to each idle conversation covers both without a second extractor or memory store.

## Scope

1. Trigger the existing `createMemoryFlush` from the Coordinator tick after ten minutes without a user or assistant message. No archived, digest or memory threads, active chief steps, or pending Council input. Use the same provider route, prompt, curation, deduplication and team/project destinations as compaction, and send only the newest 400 unprocessed rows subject to the existing transcript character cap. Older messages remain readable.
2. `chief_thread.memoryFlushedMessageId` is the cursor and `memoryFlushedAt` records the last processed row's timestamp. Both are null at upgrade. Only successful idle extraction writes them, and only the sweep reads them. Resolve the ID to SQLite rowid and seek insertion order via `chief_message_thread_insert_idx` (`threadId` then the implicit rowid suffix); equal timestamps and late inserts with older timestamps do not skip a row. A missing anchor resumes from the retained tail window. The separate timestamp index determines idleness. There are at most two requests per server, one per thread, oldest activity first.
3. Before applying, the sweep checks that the conversation is still eligible, every captured message still exists, no newer eligible row arrived, and the live team and project memory documents still match what was observed at request start. Changed inputs discard the result; a subsequent attempt reads current state. Apply and cursor compare-and-set share one SQLite transaction; no transaction spans the provider call. A commit leaves both facts and cursor, while an unexpected write error or process exit before commit leaves neither. Empty valid output advances the cursor; a rejected entry is skipped by the existing tool. Nothing changes for the compaction caller. Provider errors and deadline expiry keep the cursor and back off 15 minutes in process; a restart can retry earlier. Close aborts pending results immediately; the request also has a three-minute deadline and receives the abort signal.
4. Retain live worker step session files and turn snapshots. Delete both automatic expiry paths, including the daily snapshot due event and its scheduling. Orphan worker files for deleted steps keep the existing grace. Retain the legacy snapshot column and write shape so an older executable can read and write an upgraded database without restoring an old database copy. The new server does not act on the old timestamp or show it in `inspect-run`; manually running an older release still gives that release's cleanup behavior. The migration is additive for message history and removes only the obsolete scheduler event, not any message or snapshot row. Snapshots keep the existing per-row size limit and team-deletion cascade.

## Edge cases

| Edge case | What the user sees | Proving test | Slice/Status |
|---|---|---|---|
| Team or project conversation goes idle; one resumes later | Durable facts appear in Settings’ backing store and next-turn memory for the right scope, with the transcript untouched | `apps/server/test/coordinator/idle-memory.test.ts` | this change |
| Not yet idle, pending or claimed turn, waiting for quota, pending input, archived or no provider | No background model request; foreground progress does not wait for extraction | `apps/server/test/coordinator/idle-memory.test.ts` | this change |
| Conversation resumes, or team/project memory changes while the request runs | Stale output does not save facts or advance the cursor | `apps/server/test/coordinator/idle-memory.test.ts` | this change |
| Same-timestamp message, empty output or a second unchanged sweep | New rows remain eligible, valid empty output moves the cursor, unchanged history is not resent | `apps/server/test/coordinator/idle-memory.test.ts` | this change |
| Many threads or a large unprocessed backlog | At most two requests in flight, oldest first; only the newest bounded excerpt leaves the server | `apps/server/test/coordinator/idle-memory.test.ts` | this change |
| Provider error (including quota), hung response or shutdown | No change to facts/history; error backs off, shutdown cancels without an error log | `apps/server/test/coordinator/idle-memory.test.ts` | this change |
| Crash or unexpected write failure before cursor commit | No partial apply or cursor movement; retained messages can be processed on retry | `apps/server/test/coordinator/idle-memory.test.ts` | this change |
| Live worker record older than 30 days | The record still downloads; only orphaned files retain the old grace | `apps/server/test/step-session-upload.test.ts` | this change |
| Snapshot exceeds the old age or team storage limit | The scheduler leaves it intact; `inspect-run` no longer reports a deletion deadline | `apps/server/test/coordinator-turn-snapshot.test.ts` and `apps/server/test/coordinator/turn-snapshot.test.ts` | this change |
| Upgrade, legacy read, or unrelated threads with large history | The migration preserves the old snapshot read/write shape, removes the obsolete event, and provides a thread-local cursor seek | `apps/server/test/coordinator-turn-snapshot.test.ts` | this change |

## Out of scope

- New settings or provider routes; compaction policy; content older than the first extraction window; explicit user deletion, rewind, team deletion, attachment orphan GC, memory version retention, and model-context projection. Database backup and restore procedures are unchanged. History already removed by an older release is not recoverable here.

## Review

- Verdict: PASS
- Plan-SHA256: aeffcd91ec4b6db1cd317a7be1886f4d5a3b11ee374e0263182ed0f4a308da39
- Author-Model: doubao-main-agent
- Reviewer: Pi confirm-only, 2026-11-28
- Reviewer-Model: openai-codex/gpt-6.2-sol
- Findings: Compared the manual and main-only alternatives; checked insertion ordering, team/project stale guards, rollback and shutdown, the actual cursor query plan, compatible snapshot reads, project memory delivery, and retention through the scheduler.
