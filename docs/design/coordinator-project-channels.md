# Coordinator project channels: one conversation and one context per project

Status: accepted by the owner on 2026-11-13, including the D58 reversal and the model-written channel greeting. Supersedes section 2.3 of `duet-shaped-clients.md` ("a channel is a lens").

## Problem

A project channel is a filtered view of the one Coordinator thread. What the owner sends in the cairn channel also appears in the Coordinator channel, and every project shares one model context. The owner wants each project channel to be its own conversation (2026-11-13).

Other symptoms of the shared thread, seen on 2026-11-13: a turn error from an unrelated main-channel test (`no_model`) turned the status mark red in the cairn channel, and when the newest 100 rows held none of a project's rows the channel showed the home greeting instead of its history, because the greeting layout has no history loader.

## History

Per-project Coordinator threads existed from #2500 and #2510 (2026-11-01) and were merged into one thread a day later by #2547 under owner decision D58, "one global Coordinator, with projects as filters and context" (#2532). This design reverses the "projects only filter" half of D58 at the owner's request. It keeps the other half: there is still one Coordinator, with one identity, one set of tools and one team memory, and the main channel stays its entry. The owner confirms the reversal by approving this document.

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
| `coordinatorThreadRow` | Finds or creates the one thread | Takes a scope; finds or creates the thread for it; a new project thread enqueues its greeting turn |
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

## Empty channel

A channel is only a conversation (owner, 2026-11-13). A channel with no messages shows no home greeting, date line or counts; those belong to the main channel's home.

The first message is a model turn, following OpenClaw's session reset prompt (`src/auto-reply/reply/session-reset-prompt.ts`: read the startup context, then "greet the user in your configured persona … Keep it to 1-3 sentences and ask what they want to do"). Hermes Agent answers `/new` with a fixed ephemeral reply and Letta seeds a fixed message sequence; neither can say anything about the project, which is why this design uses the model.

- When the project thread is created, the server enqueues one greeting turn on it. The prompt has team and project memory and the project's open tasks; the Coordinator greets the owner by display name in one to three sentences, names anything in the project that waits on the owner, and asks what they want to do. The reply is stored as an ordinary Coordinator message.
- It runs once per thread, at creation, never on later opens.
- The owner's request comes first: if the owner sends before the greeting turn starts, the greeting turn is dropped and the owner's message is answered instead.
- While the turn runs, the channel shows the usual typing state. If the turn fails or no model is configured, the client shows a fixed bubble instead, worded like "Owner, what would you like to do in cairn?" through `t()`, and no error mark.
- The composer is focused from the start.

## Failure behavior

- Two first sends race to create a project thread: the unique index lets one insert win; the other reads it back (`onConflictDoNothing`, as `coordinatorThreadRow` does now).
- A project thread's turn fails: only that channel shows the error and outage banner; others keep running.
- Mirror line: written in the same transaction as the project-channel report, so both land or neither does, and the existing report path handles the failure.
- The owner states a team-wide rule in a project channel and the Coordinator saves it at project scope: other channels miss it. Mitigation is the prompt rule above and `channel_messages`; enforced team limits (autonomy pause, merge gates) are server state and unaffected.

## Cost

Each active channel carries its own system prompt and session. Idle channels cost nothing. Open question for review: whether to cap concurrent channel turns per team (proposal: no cap at first, measure).

## PR order

1. Server: scoped threads, index migration, prompt memory scope, mirror line, greeting turn, tests per table row above.
2. Web: one thread per channel, delete `streamForProject`, greeting fallback for a new channel.
3. `channel_messages` tool.
4. Update `apps/web/DESIGN.md` (Coordinator chat) to describe separate channels.
