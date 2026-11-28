# One WeChat message per task state change — plan, 2026-11-28

## User scenario

Someone who installed Cairn today connects WeChat in **Settings → Chat apps**, pairs his own account, and then leaves the Mac. He expects his phone to buzz when something he started needs him or finished, and not otherwise. What he meets instead, from the production log of the last seven days: a single finished task arrives as two messages twenty to ninety seconds apart, the second one opening with the word `Coordinator` and a bare task link; a turn he started from WeChat also receives the model's own closing narration (`已通过 notify_user…`); and messages he read on the Mac minutes earlier still land on the phone when the phone reconnects. The change is met at the moment a notification is routed to the chat: every message that reaches WeChat now opens with one line naming the task and what changed, one state change produces one message, and a notification already read on the Mac produces none.

Accounts and storage: it uses the existing WeChat connection row (`im_connection`), its paired sender, and the existing outbound effect queue (`external_effect`). No new account, key, or table. When it fails, the behaviour is the one it has today: a send that cannot be delivered stays queued and is retried when the session is back, and a message never surfaces twice.

## Scope

1. One text per Coordinator turn: at most one text message reaches the chat per turn, plus at most one question card per question. A turn that already spoke to the chat (`stepAlreadySentToIm`, already used by `turnFinished`) no longer sends its closing narration through `notice()`; a card is keyed by its question so it is sent once.
2. One message per task state change: an away notice for a task (`todo_done`, `schedule_run`, `plan_ready`, `build_review`, `coordinator_handoff`, `watchdog_flag`, `no_machine`, `quota_wait`, `model_fallback`) is admitted once per task and notification type inside a ten-minute window, and its first line names the task and what changed (`任务「X」已完成`).
3. Coordinator chatter is not a phone notification: a `chief_message` notification for a thread with no pending question is kept in the app and is not delivered to the chat while the owner is away. When the thread does have a pending question, that question goes to the chat once, with its option buttons, sharing one slot (`card:<threadId>:<requestId>`) with the copy the turn itself may already have sent.
4. Already-seen messages are not sent: an away message whose notification is read on the Mac before it is delivered sends nothing, checked when it is queued and again when it is sent.
5. Unchanged: an answer to a message the owner sent from the chat still goes back to that chat (`turnFinished` / `notice` for that turn's origin), a card tap still executes its proposal and acknowledges it, and pairing, stale-card, and send-error messages behave exactly as today.

## Edge cases

| Edge case | What the user sees | Proving test | Slice/Status |
|---|---|---|---|
| A scheduled task finishes while the owner is away from the Mac | Exactly one message, first line `任务「<title>」已完成` (or the type's own state word), body below it | `apps/server/test/notify-once.test.ts` | this change |
| A second notification for the same task and type arrives within ten minutes | Nothing new; the first message stands | `apps/server/test/notify-once.test.ts` | this change |
| The task notification went out, then the Coordinator posts a line about that same task in its thread | Nothing new on the phone: the thread line stays inside the app | `apps/server/test/notify-once.test.ts` | this change |
| The owner is away and a thread holds a question waiting for him | One message carrying the question and its option buttons, first line naming the thread and that it needs his answer; a tap answers it like any card | `apps/server/test/notify-once.test.ts` | this change |
| The turn already sent the question card into the chat, and the thread notification for the same question follows | One card, not two | `apps/server/test/im-core.test.ts` | this change |
| The owner reads the notification on the Mac before the queued message goes out | Nothing: the queued message is dropped as already seen | `apps/server/test/notify-once.test.ts` | this change |
| One turn sends a message and then the model's closing narration | One message; the narration is dropped | `apps/server/test/im-core.test.ts` | this change |
| The owner writes to the Coordinator in the chat and the turn answers | Exactly one answer in that chat, unaffected by this change | `apps/server/test/im-core.test.ts` | this change |
| The connection is offline when a notice is queued, then reconnects | At most one message, with the reason line and the already-seen check applied at send time | `apps/server/test/notify-once.test.ts` | this change |
| A notification that is not a task state change (mail, subscription) reaches the chat | Unchanged path and wording | `apps/server/test/notify-once.test.ts` | later: wechat-dedupe-mail |

## Out of scope

- Changing what the model writes: narration is dropped, not rewritten.
- Migrating or rewriting messages already queued in production before this lands.
- Desktop banners and phone push: their wording and routing stay as they are; only the chat delivery changes.
- A per-project digest or batching of several tasks into one message.

## Review

- Verdict: PASS
- Plan-SHA256: <pending>
- Author-Model: doubao-main-agent
- Reviewer: <pending>
- Reviewer-Model: anthropic/claude-sonnet-5-5
- Findings: <pending>
