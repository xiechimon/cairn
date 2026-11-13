# Coordinator project channels: one conversation and one context per project

Status: proposed 2026-11-13 by the owner's choice of option C2 in the channel thread; awaiting review. Supersedes section 2.3 of `duet-shaped-clients.md` ("a channel is a lens").

## Problem

A project channel is a filtered view of the one Coordinator thread. What the owner sends in the cairn channel also appears in the Coordinator channel, and every project shares one model context. The owner wants each project channel to be its own conversation (2026-11-13).

## Prior art

| Product | Separation | What crosses the boundary | Source |
| --- | --- | --- | --- |
| Claude Projects | Each project has its own chats and memory | Account memory is read inside a project; other projects' memory is not | support.claude.com 11817273, 9519177 (Read) |
| ChatGPT Projects | Optional project-only memory | With it, chats see only the same project's chats | help.openai.com 10169521 (Read) |
| Grok Bot | One conversation and memory per Bot | A few owner facts; shared files and group chats | docs.x.ai/grok-bot (Read) |
| Claude Duet | Separate channels | "they share the same memory"; mechanism not documented | support.claude.com 17631495 (Read) |
| cairn today | One thread, client-side filter | Everything | `streamForProject` in `home-c.tsx` |

This design follows Claude Projects: separate conversation and context per project, team memory plus that project's memory, nothing from other projects unless the Coordinator looks it up.

## Model

- A Coordinator thread gains a scope: `chief_thread.projectId` is `null` for the main channel and a project id for a project channel. The column exists; no row sets it today.
- At most one active thread per (Coordinator, scope). The unique index `chief_thread_coordinator_unique` changes from `(chiefId)` to `(chiefId, coalesce(projectId, ''))`, same `where`. The digest thread is unchanged.
- Each thread keeps its own model session (`sessionId`), turn queue and `activeRun`, as threads already do. Two channels can run turns at the same time.
- The system prompt of a thread injects team memory plus its project's memory: `buildChiefSystemPrompt` passes the thread's `projectId` to `injectMemoryDocuments`, which already layers both. Memory tools default to the thread's scope. The prompt says that a rule meant for every project is saved at team scope.
- A new read-only tool, `channel_messages`, lists or searches another channel's recent messages, so a project channel can check the main channel and the reverse. It never writes.

## Paths that read or write the thread or its messages

| Path | Today | After |
| --- | --- | --- |
| Owner sends in a project channel (`POST /chief/threads`, `POST /conversations/:id/messages`) | Main thread, row tagged with `projectId` | Find or create that project's thread; the row lands there |
| Owner sends in the main channel | Main thread | Unchanged |
| `coordinatorThreadRow` | Finds or creates the one thread | Takes a scope; finds or creates the thread for it |
| `create_todo` from a channel | Watch on the calling thread | Unchanged, so a task's reports return to the channel that created it |
| Thread reports and wakes (`insertThreadReport`, `notifyWatchers`) | To the watching thread | Unchanged; plus one mirror line in the main channel when a project-channel task reaches needs-you or done |
| Questions to the owner (`chief-questions.ts`) | On the asking thread | Unchanged; the Tasks panel already lists them across threads |
| Daily report, digest, mail and job-application rows | Main thread | Unchanged (team-level) |
| Rewind, withdraw, stop, steer | Per thread | Unchanged; they act on the channel's own thread |
| `GET /conversations/:id/messages` | Main thread, filtered on the client | Each channel loads its own thread; `streamForProject` is deleted |
| Web channel switch | Same thread, new filter | Switches the active thread; outbox, drafts and unread already key on thread id |
| Project archived or deleted | Rows stay tagged | Archive its thread (`archivedAt`); sends answer 409 as for archived projects today |

## Existing history

The main thread keeps all 8,000+ rows, including the 779 tagged cairn. Project channels start empty; the project's memory (37 cairn entries today) carries what the Coordinator knows. No rows move: moving them would break the main session's transcript. A project channel can read old tagged rows through `channel_messages` when it needs them.

## Failure behavior

- Two first sends race to create a project thread: the unique index lets one insert win; the other reads it back (`onConflictDoNothing`, as `coordinatorThreadRow` does now).
- A project thread's turn fails: only that channel shows the error and outage banner; others keep running.
- Mirror line: written in the same transaction as the project-channel report, so both land or neither does, and the existing report path handles the failure.
- The owner states a team-wide rule in a project channel and the Coordinator saves it at project scope: other channels miss it. Mitigation is the prompt rule above and `channel_messages`; enforced team limits (autonomy pause, merge gates) are server state and unaffected.

## Cost

Each active channel carries its own system prompt and session. Idle channels cost nothing. Open question for review: whether to cap concurrent channel turns per team (proposal: no cap at first, measure).

## PR order

1. Server: scoped threads, index migration, prompt memory scope, mirror line, tests per table row above.
2. Web: one thread per channel, delete `streamForProject`, empty state for a new channel.
3. `channel_messages` tool.
4. Update `apps/web/DESIGN.md` (Coordinator chat) to describe separate channels.
