# One WeChat message per task state change — plan, 2026-11-28

## User scenario

Someone who installed Cairn today connects WeChat in **Settings → Chat apps**, pairs his own account, and then leaves the Mac. He expects his phone to buzz when something he started needs him or finished, and not otherwise. What he meets instead, from the production log of the last seven days: a single finished task arrives as two messages twenty to ninety seconds apart, the second one opening with the word `Coordinator` and a bare task link; a turn he started from WeChat also receives the model's own closing narration (`已通过 notify_user…`); and messages he read on the Mac minutes earlier still land on the phone when the phone reconnects. The change is met at the moment a notification is routed to the chat: every message that reaches WeChat now opens with one line naming the task and what changed, one task state change produces one message, a Coordinator line that only restates a task already announced is folded into that message, and a notification already read on the Mac produces none.

Accounts and storage: it uses the existing WeChat connection row (`im_connection`), its paired sender, and the existing outbound effect queue (`external_effect`). No new account, key, or table. When it fails, the behaviour is the one it has today: a send that cannot be delivered stays queued and is retried when the session is back, and a message never surfaces twice.

## Scope

1. A Coordinator turn speaks once to the chat: the auto-published closing narration (the thread notification raised when a turn ends) is dropped when that turn already sent a message to the chat; two explicit messages the model sends in one turn both arrive, in order. A question card stays allowed next to the turn's own text.
2. One message per task state change: an away message is admitted once per task and notification type inside a ten-minute sliding window, measured against the messages actually sent; a repeat of the same type is folded only when it carries the same snippet, so a state that reports new text still reaches the chat. Its first line names the task and what changed, from a fixed state word per type (`todo_done`, `todo_failed`, `schedule_run`, `build_review`, `plan_ready`, `coordinator_handoff`, `watchdog_flag`, `no_machine`, `quota_wait`, `model_fallback`); a type without a state word, such as `marked_unread`, falls back to `任务「X」有新消息`, and the body below the first line is the notification's own snippet. A Coordinator line that links a task already announced inside the window is folded into that one message, in either order; it never folds a later state change of that task, and two different Coordinator lines in the same thread both arrive. The outbound effect stays keyed by its delivery id, so re-dispatching the same delivery (desktop fallback, promote retry, crash replay) sends once.
3. A thread notification that carries a pending question goes to the chat as the question card, with its option buttons, once per question (`card:<threadId>:<requestId>`); it is only treated as the question when its own text is that question, so an unrelated Coordinator line in the same thread is never replaced by an older pending card. The turn path and the away path are exclusive: a thread with a live chat turn is answered in that turn and never routed away, so the card cannot be sent by both.
4. Already-seen messages are not sent: routing skips a notification read on the Mac, and the send path re-reads the notification and sends nothing when it was read after queueing. A folded message keeps the notification id it was queued for; the notification row is per task (or per thread), so marking it read cancels the queued chat message even when a later notification was folded into it.
5. Unchanged: an answer to a message the owner sent from the chat still goes back to that chat exactly once, a card tap still executes its proposal and acknowledges it, pairing, stale-card and send-error messages behave exactly as today, mail keeps its `skipAwayDispatch`, and the web-push fallback keeps its own path and wording. No new delivery status or target value is introduced.

## Edge cases

| Edge case | What the user sees | Proving test | Slice/Status |
|---|---|---|---|
| A scheduled task finishes while the owner is away from the Mac | Exactly one message, first line `任务「<title>」计划运行结束` (or the type's own state word), body below it | `apps/server/test/notify-once.test.ts` | this change |
| A second notification for the same task and type carries the same text inside ten minutes | Nothing new; the first message stands | `apps/server/test/notify-once.test.ts` | this change |
| The same state reports new text inside the window (a re-run, a second review pass) | A second message naming the state | `apps/server/test/notify-once.test.ts` | this change |
| A different state of the same task arrives inside the window | A second message naming the new state | `apps/server/test/notify-once.test.ts` | this change |
| The task notification went out, then the Coordinator posts a line linking that same task | Nothing new on the phone: the line stays inside the app | `apps/server/test/notify-once.test.ts` | this change |
| A Coordinator line links a task, then that task changes state inside the window | The state message still arrives; the line does not swallow it | `apps/server/test/notify-once.test.ts` | this change |
| Two different Coordinator lines arrive in one thread inside the window | Both arrive | `apps/server/test/notify-once.test.ts` | this change |
| The same delivery is re-dispatched (desktop fallback, promote retry, crash replay) | One message | `apps/server/test/notify-once.test.ts` | this change |
| The Coordinator posts a line about a task with no notification inside the window | One message whose first line names the task and says it has news | `apps/server/test/notify-once.test.ts` | this change |
| The owner is away and a thread holds a question waiting for him | One message carrying the question and its option buttons, first line naming the thread and that it needs his answer; a tap answers it like any card | `apps/server/test/notify-once.test.ts` | this change |
| The turn already sent the question card into the chat, and the thread notification for the same question follows | One card, not two (the turn path owns the thread; away routing never runs for it) | `apps/server/test/im-core.test.ts` | this change |
| The owner reads the notification on the Mac before the queued message goes out | Nothing: the send re-reads the notification and skips it | `apps/server/test/notify-once.test.ts` | this change |
| The task is read on the Mac while its message is queued and a later notification is folded into it | Nothing is sent; reading the task cancels the queued message | `apps/server/test/notify-once.test.ts` | this change |
| One turn sends an explicit message and then the auto closing narration | One message; the narration is dropped | `apps/server/test/im-core.test.ts` | this change |
| One turn sends two explicit messages | Both arrive, in order | `apps/server/test/im-core.test.ts` | this change |
| The connection is offline when a notice is queued, then reconnects | At most one message, with the reason line, after reconnect | `apps/server/test/notify-once.test.ts` | this change |
| The owner writes to the Coordinator in the chat and the turn answers | Exactly one answer in that chat | `apps/server/test/notify-once.test.ts` | this change |
| A mail notification is handed to the Coordinator | Unchanged: it keeps `skipAwayDispatch` and does not reach the chat | `apps/server/test/notify-once.test.ts` | later: wechat-dedupe-mail |

## Out of scope

- Changing what the model writes: narration is dropped, not rewritten.
- Migrating or rewriting messages already queued in production before this lands.
- Desktop banners and phone push: their wording and routing stay as they are; only the chat delivery changes.
- A per-project digest or batching of several tasks into one message.
- Translating the chat copy: these strings are generated on the server next to the existing IM copy in `im/core.ts`, the same way `TURN_FAILED_TEXT` is; `t()` covers web UI strings, whose wording does not change here.

## Review

- Verdict: BLOCK
- Plan-SHA256: 56cc14a311b694857adb9e1241f91e201a80a5c523b7bf83de423ea9695a67ac
- Author-Model: doubao-main-agent
- Reviewer: pi-review plan, fresh context
- Reviewer-Model: anthropic/claude-opus-5-5
- Findings: 12 findings (3 blocking, 6 should-fix, 3 notes) on the first body: (1) dropping every notice after the turn's first message swallowed a real second answer, (2) the chief_message gate also removed the web-push fallback for users without WeChat, (3) the Coordinator's `notify_user` from a background turn was removed entirely, (4) no send-time already-read check and a hollow proving test, (5) the claimed shared card slot was not shared, (6) a fixed time bucket both duplicated at boundaries and swallowed real state changes of the same type, (7) a collapsed message carried only the first notification's delivery id, (8) unmapped and mail types were mislabelled and the body/headline rewrite went undocumented, (9) two edge rows had no red test, plus notes on the missing `todo_failed`, hard-coded Chinese, and the readers of the newly introduced states. All were fixed in one round: the narration is identified by the turn-end flag instead of by ordinal, the Coordinator channel and web-push fallback are untouched, restatements are folded by task with a sliding window and a same-text test, the send path re-reads the notification, the folded message keeps its notification id so reading cancels it, no new delivery state is introduced, and every edge row names a red test. The second fix-check left only finding 9: the chat-origin row had no new test, which this commit adds (`notify-once.test.ts`, "an answer to a chat-originated turn reaches that chat once and its narration is not repeated"); the wrapper's two-check cap stopped before a third confirmation. The head review of the landing diff returned CONCERNS with three should-fix items and two notes, all fixed in the same commit: the `notice` payload type now carries `snippet` (the typecheck failure), a Coordinator line no longer folds a later state change and two different lines both arrive, the outbound effect is keyed by its delivery id again so a re-dispatch sends once, a pending card is only attached when the notification is that question, and the unindexed window lookup is recorded as accepted at current volume.
- Fix-check: PASS
- Fix-check-Plan-SHA256: f2bcb6816c758f2218478f3cbbc8352a282c31bff12b198e7362d9b24f6f4c4f
