# Surfacing pending agent questions without blocking the conversation (2026-11-08)

Question: the Coordinator home stacks a `待你决定 N` card list (and an expanded question card) above the composer. How do agent and inbox products surface "waiting on you" items so they never sit on top of the main conversation, and which pattern fits cairn? Labels: measured (operated or read first-hand this pass), inferred (derived from measured), guess (the rest).

## How this was studied

| Source | Status |
|---|---|
| claude.ai/code in the owner's signed-in Mac Chrome, 2026-11-08 | Operated read-only: home, one Coordinator-style project and one waiting thread opened. Nothing answered. measured |
| Claude desktop app, Code tab | Not reachable from this machine; claude.ai/code shows a "Links like this one open in the Claude desktop app" toast, so the web view is the same surface. inferred |
| Codex web (`chatgpt.com/codex`, `/codex/cloud`, `/codex/tasks`) | All redirect into ChatGPT's new Work mode; the Codex view shows only a composer and no task list for this account. Partially observed. measured |
| Linear inbox (`linear.app/<workspace>/inbox`) | Operated read-only. measured |
| GitHub notifications (`github.com/notifications`) | Operated read-only. measured |
| Cursor agents (`cursor.com/agents`) | Blocked: an onboarding questionnaire ("Tell us about your role") gates the page; answering it changes the account, so it was not touched. Docs (`cursor.com/docs/cloud-agent`) read instead; they do not describe a waiting-on-you surface. |
| Amp manual (`ampcode.com/docs/threads`) | Read. measured |
| t3code source (`github.com/pingdotgg/t3code` at `ade473018d32003658b7d38693e083ee2e314bd8`) | Read `apps/web/src/components/Sidebar.logic.ts` and `apps/web/src/components/chat/TimelinePendingApprovalRow.tsx`. measured |

Screenshots were taken but stay outside the repository, because they show the owner's private account content.

## Comparison

| Source | Where pending items live | In the main conversation? | Clicks to answer | Count / urgency | Dismiss / snooze | Link |
|---|---|---|---|---|---|---|
| claude.ai/code project view | A right-side `Threads` panel grouped by status: `Ready for review · 1`, `Waiting on you · 3`, `Idle · 1`, `Resolved · 4`. Each row: status icon, thread title, an em-dash one-line ask, date. The header toggle for the panel carries a blue dot; its accessible name is "Threads 3 threads waiting on you". measured | The project chat only mentions a thread as an inline chip "<thread title> — Needs attention"; no stacked block above the composer. The project's own tool permission request does render as an inline card in the chat (Deny / Always allow), because it blocks that conversation itself. measured | 1: clicking a waiting row opens that thread in the right pane with its own composer ("Steer this…"); the project chat stays where it was. measured | Count in the group header, dot on the header toggle, sidebar row dot for running sessions. measured | Groups collapse; reorder per group ("Reorder Waiting on you"). measured | https://claude.ai/code |
| ChatGPT Work / Codex | Rail home icon has a blue dot; sidebar row "Your dot" with a count badge (8). Work home lists proactive suggestions under the composer (e.g. a PR whose CI passed but awaits review), each dismissable ("Dismiss suggestion"). measured | No. Suggestions sit below an empty composer on the start screen, not inside a running conversation. measured | Not measured (did not open). | Dot + numeric badge in sidebar. measured | Per-suggestion dismiss. measured | https://chatgpt.com |
| Linear inbox | Dedicated `Inbox` with a count (2 = unread only) in the sidebar; list-detail split; unread rows have a dot and bold title; each row states why ("requested your review", "2 more checks failed"). measured | No; it is its own page. measured | 1 to open the detail in the right pane, then act there. inferred | Sidebar count of unread; detail empty state "2 unread notifications". measured | Context menu: Mark as unread (U), Delete (⌫), Snooze (H), Favorite. measured | https://linear.app |
| GitHub notifications | Header inbox icon with a dot (no number); full page with `Inbox 3`, filters (`Review requested 2`, `Assigned`, `Mentioned`), reason column ("author", "ci activity"). measured | No. measured | Hover a row reveals Done, Unsubscribe, Save; 1 click to clear. measured | Dot in header, counts per filter. measured | Done / Saved views. measured | https://github.com/notifications |
| Amp | Sidebar threads with unread dots; Activity feed with a Status filter. "While a snoozed thread waits for you to approve a tool or answer a question, it shows in the sidebar; once you answer, it is snoozed again." Snooze Until I'm Needed. Apps notify "when a thread is ready for your next message". measured (docs) | Not described as such; the question lives in its thread. inferred | Open the thread from the sidebar, answer in its composer. inferred | Unread dot; Mark as Unread brings it back. measured (docs) | Snooze (until needed / tomorrow / custom), Archive. measured (docs) | https://ampcode.com/docs/threads |
| t3code | Sidebar status pill per thread from `resolveThreadStatusPill`: `Pending Approval` (amber) wins over `Awaiting Input` (indigo), then `Working` (sky, pulsing), `Waiting`, `Failed`. measured | The approval is a compact timeline row (`TimelinePendingApprovalRow`) inside that thread, with inline actions; nothing floats over another thread's chat. measured | Open thread, then 1 click on the inline action. inferred | Coloured dot + label, one per thread; urgency by fixed priority. measured | Not seen in the read files. | https://github.com/pingdotgg/t3code/blob/ade473018d32003658b7d38693e083ee2e314bd8/apps/web/src/components/Sidebar.logic.ts |
| Cursor agents | Blocked by onboarding gate at https://cursor.com/agents; docs do not cover it. | n/a | n/a | n/a | n/a | https://cursor.com/docs/cloud-agent |
| cairn today | `待你决定 N` stacked cards (title, `在问你一个问题。`, `回复`, `查看 thread`, `还有 N 件`) plus an expanded question card above the composer. | Yes: it occupies the bottom of the Coordinator chat and pushes it up. | 1 (`回复`) | Count in the block header. | None. | `apps/web/src/board/needs-you-tray.tsx` (before this change) |

## Pattern that fits cairn

No product that was operated puts other threads' questions on top of a conversation. Every one keeps them in a side surface (sidebar status, side panel group, inbox page) and leaves the main chat clean. measured. The closest analogue to cairn's Coordinator is claude.ai/code's project view, which is the same shape (a coordinating chat that spawns threads): a status-grouped `Waiting on you · N` list in a toggleable side panel, a dot on the header toggle, one-line asks per row, and answering opens the thread beside the chat. measured. A question that blocks the current conversation itself is the only thing rendered inline (the permission card). measured.

Shared traits worth keeping: a count, a one-line "what is asked", the reason, an answer path of one or two clicks, and a way to put items away (Linear Snooze, GitHub Done, Amp Snooze Until I'm Needed). measured.

## Recommendation: three prototype directions

| Direction | Borrows from | Why |
|---|---|---|
| (a) No block in the chat. Sidebar thread rows carry a status dot/pill for "waiting on you"; the Coordinator title gets a count chip (`待你决定 7`) that filters or scrolls the sidebar to those threads. Answer = click the sidebar row, reply in the thread. | t3code sidebar status pill (priority approval > input), Amp sidebar + unread dot, claude.ai/code sidebar dot | Zero chat footprint; matches how every measured product keeps pending items out of the conversation. Cost: the answer happens in the thread, so 2 clicks and a context switch. |
| (b) One collapsed single-line strip (e.g. `7 件待你决定 · 最早：… ›`) in the header area, expanding into an overlay list that does not reflow the chat. | claude.ai/code group header `Waiting on you · 3` with collapse chevron; ChatGPT Work's dismissable suggestion rows | Keeps awareness in the chat view with a fixed one-line cost; expansion overlays instead of pushing. Weakest research support: no measured product shows a strip inside the chat. |
| (c) Header inbox button with a dot/count opening a popover or side panel grouped `待你决定 · 7`, rows with title + one-line ask, answerable inline (reply field per row) or open the thread in a side pane; per-row snooze/done. | claude.ai/code `Threads` panel (header toggle with dot, `Waiting on you · N` group, thread opens in side pane), Linear inbox (snooze), GitHub notifications (header dot, Done) | Strongest measured match to cairn's Coordinator-and-threads shape; answer in 1-2 clicks without leaving the Coordinator chat. |

Recommended: (c), with (a)'s sidebar dots as the always-on ambient signal. inferred from the claude.ai/code project view, which ships both at once.

Code areas: `apps/web/src/board/needs-you.ts`, `apps/web/src/board/home-c.tsx`, `apps/web/src/chief/chief-question-card.tsx`, `apps/web/src/board/sidebar-thread-groups.tsx`, `apps/web/src/board/app-sidebar.tsx`.

## Second pass: the claude.ai/code row, measured

Measured with computed styles on the `Threads` panel rows at 1470 px; the waiting group was empty at the time, so the shared row layout was read on resolved rows. measured

| Item | claude.ai/code | cairn token used |
|---|---|---|
| Row | full panel width (8 px inset), 10/13/10/10 padding, radius 8 px, 2 px between rows, icon-text gap 12 px | `rounded-(--radius-control) py-2.5 pl-2.5 gap-3`, list `gap-0.5 px-2` |
| Title and time | 14 px / 400; time 13 px at 60 % ink, right-aligned | `text-ui text-foreground`, `text-meta text-content-tertiary tabular-nums` |
| Hover | `rgba(0,0,0,.03)` across the whole row including the trailing slot, no shadow, no transition; the date swaps for an action icon | `hover:bg-(--menu-hover)` on the row container that also holds the open-thread button |
| Open | the pane switches to the thread with its own composer | the row expands in place with the band kept; the open-thread button still opens the side chat |
| Reply box | radius 14 px, no border, hairline shadow, no focus ring | `rounded-(--radius-composer) shadow-(--shadow-composer)`, focus `shadow-(--shadow-composer-focus)`, ring removed |

## Outcome

The owner picked (c) with (a)'s sidebar group and title chip. The shipped inbox is a side panel opened from the `待你决定 N` chip next to the title; each row shows the thread's actual pending question (or its one-line report when it has none), offers the question's options as one-click answers, and replies through the thread's own message path. The stacked tray is removed. The Coordinator's own pending question stays docked above the composer, because it blocks that conversation itself, the same split claude.ai/code makes for its permission card. inferred
