# Done versus verified in the thread status area

Date: 2026-11-10. Question: Cairn labels a finished task `已完成，未验证` or `已验证` from the latest verify-gate verdict on the judged head or patch. Should that split stay, before turning it off so a finished task just looks finished?

Checkout note: this note was read against an earlier checkout. On `origin/main` `6a7bea079` the same words also replace the stored done-row `🎉 任务已完成` in the transcript mapper. The recommendation is unchanged: one finished word, and the verify gate stays.

Marks: **measured** means read or run first-hand this session. **inferred** means derived from that and recheckable. **guessed** means the rest. A blocked source stays in the table.

Domain row: Chat / agent product UX. Designated sources: claude.ai, Claude desktop Code tab, t3code, Cursor, Amp.

## How this was read

| Source | Pin | How read | Operated? |
|---|---|---|---|
| Cairn | this checkout | `status-words.ts`, `thread-copy.ts`, `verified.ts`, consumers below | n/a |
| t3code | `pingdotgg/t3code` `580503ed302bf81dd8bf074b4084a0ae000c410a` (2026-11-10, `fix(web): custom snooze footer stays inside the dialog`) | `gh api` raw `apps/web/src/components/Sidebar.logic.ts`, `ThreadStatusIndicators.tsx`, `Sidebar.logic.test.ts` | blocked: no local `t3` process; [app.t3.codes](https://app.t3.codes) returned "No computer connected" |
| Claude desktop Code tab | installed app `4.23118.0` (`/usr/lib/claude-desktop`, process running) | official [desktop](https://code.claude.com/docs/en/desktop) and [projects](https://code.claude.com/docs/en/claude-projects) pages via `agent-reach web read`; strings in `app.asar` | blocked: process up, no Hyprland client, no computer-use tool in this session |
| claude.ai | public pages 2026-11-10 | [help center](https://support.claude.com/en/articles/8230524-delete-or-rename-a-conversation); `agent-reach web read` of https://claude.ai | blocked: login wall ("Sign in or create an account"), Chrome was on Cairn and was not driven |
| Cursor | docs fetched 2026-11-10 | [Agents Window](https://cursor.com/docs/agent/agents-window), [IDE release notes](https://cursor.com/docs/release-notes/ide), [changelog 0.48](https://cursor.com/changelog/0-48-x) | blocked: `cursor` binary present, no window |
| Amp | manual fetched 2026-11-10 | [Threads](https://ampcode.com/docs/threads), [Linux app](https://ampcode.com/docs/apps/linux), [Windows app](https://ampcode.com/docs/apps/windows), [Spaces](https://ampcode.com/docs/spaces) | not run; manual is the designated source |

Cursor staff posts on forum.cursor.com are extra first-party text, not docs.cursor.com. They are marked when used.

## What Cairn shows in this area

The split is not a sidebar pill. The live sidebar lists projects and a waiting count, not threads. `SidebarThreadRow` is gallery-only and shows a tone glyph, not these words. (**measured** `apps/web/src/board/sidebar.tsx`, `apps/web/src/components/shell/sidebar-project.tsx`)

| Surface | What a finished task says | Link |
|---|---|---|
| Side-chat status line | `已验证` or `已完成，未验证`, unless `quotaWait` replaces it with `等额度` | `apps/web/src/board/side-chat.tsx` `StatusLine` |
| Project home and work-panel thread row | same split, as the row reason (`验证通过。` / `完成了，还没有验证结论。`), under a group already labeled `已完成` | `thread-copy.ts`, `project-home.tsx`, `work-panel.tsx` |
| Needs-you cards | finished tasks are not listed; the card uses `threadCopy` only for needs-you and failed | `needs-you.ts`, `home-c.tsx` |
| Coordinator transcript marker | `任务 #{n} {title}：已验证` or `：已完成，未验证` | `chief-message-rows.tsx` via `reportStatusWord` |
| Phase chip elsewhere | `已完成`, with no verified branch | `phase.ts` `PHASE_UI.done` |

Backend: a `done` or `closed` todo with a `latestBuildId` gets `verified: buildVerified(...)`. A chief thread-report for `done` gets the same boolean. `buildVerified` is true only when the latest `verify` verdict passed and its head or patch digest still matches `gateState`. (**measured** `apps/server/src/services/verified.ts`, `todos.ts`, `chief.ts`)

`threadStatus` already treats `done` and `closed` as one bucket, `done`. The verified bit never changes the tone (`resolved`). It only changes the words. (**measured** `thread-copy.ts`)

## Comparison

| Source | How completion / status is shown in this area | Trade-off | Link |
|---|---|---|---|
| claude.ai chat | Conversation rows are titles. Documented row actions are rename and delete. No completion pill, no verified word. Full list is "Chats and tasks". | A chat has no run to verify, so the row stays quiet. Task outcome, when Dispatch is used, comes back as a message and a notification, not a second done label on the row. | https://support.claude.com/en/articles/8230524-delete-or-rename-a-conversation ; https://support.claude.com/en/articles/13947068-assign-tasks-from-anywhere-in-claude-cowork . Operate blocked: login wall |
| Claude desktop Code tab | Sidebar session row uses dots, not a verified/unverified word. Installed app text: unread is a blue dot; "needs input" and "failed" are sidebar dots; "Mark as completed" acknowledges those dots so the row reads as completed, and the dot returns if the session needs attention again. Internal classifier maps a session to `awaiting_permission`, `running`, `failed`, `needs_input`, or `idle`. Official docs: OS notification when a session finishes and you are not viewing it; earlier layout filters by Status including Archived. Project Overview, in the Code tab and at claude.ai/code, groups threads as Ready for review, Waiting on you, Working, Landing, Idle (finished, not waiting), Resolved (marked done). PR check status is a Changes card, not the session word. | Attention stays on the row until you acknowledge it. Proof of the work (CI, review, merge) is a different card. Idle is one finished state. | https://code.claude.com/docs/en/desktop ; https://code.claude.com/docs/en/claude-projects#see-what-needs-you-in-overview ; `app.asar` tool strings at the "needs input" / "Mark as completed" description. Window not operated |
| t3code | `resolveThreadStatusPill` labels: Working, Connecting, Completed, Failed, Pending Approval, Awaiting Input, Guest Request, Waiting, Plan Ready. Completed is returned only from `hasUnseenCompletion` (latest run `completedAt` after `lastVisitedAt`). A settled run with no visit watermark returns null, not Completed. Failed is also unseen-only. A seen, settled thread has no pill. The pill renders on the sidebar row (`ThreadStatusLabel` / `ThreadRowLeadingStatus`), as a dot plus a label from `md` up. No verified or unverified label in that function. | The pill means "look here", not "this work is proven". A finished thread you have opened looks like an ordinary row. You cannot tell verified from unverified from the row, because that split does not exist. | https://github.com/pingdotgg/t3code/blob/580503ed302bf81dd8bf074b4084a0ae000c410a/apps/web/src/components/Sidebar.logic.ts ; [ThreadStatusIndicators.tsx](https://github.com/pingdotgg/t3code/blob/580503ed302bf81dd8bf074b4084a0ae000c410a/apps/web/src/components/ThreadStatusIndicators.tsx). Running app blocked |
| Cursor | Official docs for this area do not define a verified/unverified completion word. Changelog: an orange dot on a chat tab that is awaiting input. Release notes: chat status line says "Waiting for approval" or "Waiting for response" when a subagent needs you; unread badges clear when the chat is focused; sidebar rows are one line and can show last updated. Agents Window docs describe the workspace, not status words. Staff posts, not the docs: gray dot = finished and opened, blue = finished unread, yellow/orange = waiting on you; local agents that error can still look finished; cloud agents that error get a red dot. | The row answers "do I need to look", not "did the gate pass". Proof sits on the PR and diffs. The docs gap means the dot legend is staff commentary, and the app was not opened here to confirm it. | https://cursor.com/docs/agent/agents-window ; https://cursor.com/changelog/0-48-x ; https://cursor.com/docs/release-notes/ide ; staff: https://forum.cursor.com/t/badge-status-dots-are-unnecessary/171691 . App blocked |
| Amp | Sidebar lists threads by pin, project, inactive, snoozed, archived. Completion signal in that list is an unread dot, including "threads that finished and are waiting for your next message". Tray and jump-list dots are working, unread, waiting for you, or failed. Mark as Unread restores the dot. No verified/unverified label in those pages. Ship, test, and CI follow live in the thread (Changes pane, CI row), and a Space chart counts Shipped / Archived / Open, or Done when the host cannot see landings. Activity has a Status filter; the pages read do not list its option labels. | The sidebar stays a work queue. Landing and test results are not a second done word on the row. | https://ampcode.com/docs/threads ; https://ampcode.com/docs/apps/linux ; https://ampcode.com/docs/apps/windows ; https://ampcode.com/docs/spaces |
| Cairn | Finished is two words, driven by `verified`, on the status line, the thread-row reason, and the coordinator marker. The group header and the phase chip already say `已完成`. | The row argues with itself: the group says finished, the reason says not verified. A missed or stale verify verdict looks like unfinished work. | this checkout, files above |

No designated source splits "finished" into verified and unverified in the sidebar row, status pill, or conversation completion marker. (**inferred** from the rows above; the unoperated apps could still show a label the docs omit, which is why those rows say blocked)

## Other status-label differences versus t3code, same area

Not the whole product. Only the sidebar row, status pill, status line, and the completion marker in the conversation.

| t3code | Cairn, same area | Note |
|---|---|---|
| Working vs Connecting vs Waiting | one word, `运行中`, for queued, planning, and building. `等额度` replaces the status line while a quota wait is set | t3 Waiting is a blocked run or background work, not a quota chip. Cairn does not say Connecting |
| Pending Approval, Awaiting Input, Plan Ready, Guest Request | one word, `待你决定`, for confirm, review, and an open question. Reasons differ (`计划已就绪，批准后开工。` / `已就绪，等你审阅。` / `在问你一个问题。`) | `审阅中` exists in `STATUS_WORDS` and is used only on the coordinator report for phase `review`, not on the thread status line |
| Completed only while unseen, then no pill | a permanent finished word, and that word is split | the difference the user asked to remove |
| Failed only while unseen | `失败` stays, with reason `失败了，打开它重试。` | t3 drops the Failed pill after the failure is seen (`hasUnseenFailure`) |
| `limited` is a sidebar status for a usage-limit stop, not a pill label in `resolveThreadStatusPill` | `等额度` is the status-line word | both surface a limit; only Cairn overwrites the finished/running word with it |
| Guest Request | no guest-request word | out of scope for this change |
| Seen settled row: no status text | project-home and work-panel rows always show a reason under `已完成` | hiding the reason would be a second change; the ask is one finished look, not a blank row |
| no cancelled-versus-done split in the pill | `done` and `closed` share the verified branch today, while `PHASE_UI.closed` is `已取消` | removing the branch should not leave a cancelled thread saying it finished |

## Pattern that fits

Keep one finished word. Put proof somewhere that is already about proof.

t3code's pill is an unseen-completion flag, not a quality grade. Claude's Code-tab row goes idle or "reads as completed" after you acknowledge needs-input or failed; Project Overview's finished groups are Idle and Resolved. Amp's row dot means unread or waiting, and Ship / CI stay in the thread. Cursor's documented signals in this area are awaiting-input and unread, not a verify verdict.

Cairn already has that shape one layer up: the `已完成` group, the `resolved` tone, and `PHASE_UI.done.chip`. The verify gate still judges a head or patch for shipping. That result does not belong in the status word. A stale or missing verdict currently makes a finished task look unfinished. (**inferred**)

Do not copy t3code's disappearing Completed pill. Cairn's finished tasks stay in an `已完成` group, so the row needs one stable word. Do not copy a gray-dot legend either: the live sidebar does not list threads.

## Recommendation

Turn the split off in the status projection. Leave the verify gate itself alone.

1. Frontend copy. In `threadCopy`, `done` returns `{ state: '已完成', reason: '任务已完成，发送消息即可继续。' }` (the reason already used by the status menu). Do not branch on `todo.verified`. In the same function, `closed` should use `已取消`, not a finished word, because `PHASE_UI` already says that and the shared branch is what mislabels it. `reportStatusWord` for `phase: 'done'` returns `已完成` and ignores `verified`. Delete `doneUnverified` and `verified` from `STATUS_WORDS` once nothing reads them, and delete the matching `en.ts` keys `已完成，未验证` and `已验证`.
2. Backend projection. Stop attaching `verified` on the todo wire (`todos.ts`) and on the chief thread-report (`chief.ts`). Stop calling `buildVerified` from those two sites. Keep `buildVerified` and the verify verdict tables: they still answer whether a judged head or patch passed, for the gate, not for this label. Leave the optional `verified` fields on the shared todo and thread-report schemas so old payloads still parse; new writers omit them.
3. Tests that lock the split: `apps/server/test/chief-thread-report.test.ts`, `apps/web/e2e/chief-thread-report.spec.ts`, and any thread-copy fixture that expects the two words. Assert one finished word, and assert a done report no longer carries `verified`.
4. Do not change needs-you ranking, the `已完成` group, the `resolved` tone, the quota-wait override, or the verify gate's pass/fail behavior.

Surfaces that change: side-chat status line, project-home and work-panel row reason, coordinator thread-report marker. The live sidebar does not show this word today.

## Claims

- **measured** Cairn's two words and the `buildVerified` head/patch match: files cited above.
- **measured** t3code pill set and unseen-only Completed: `Sidebar.logic.ts` `resolveThreadStatusPill` and the tests "does not manufacture completed state without a client visit marker" and "shows completed when there is an unseen completion".
- **measured** Claude desktop asar, app `4.23118.0`: sidebar dots for unread (blue), needs input, and failed; "Mark as completed" makes the row read as completed. Not confirmed on a visible window.
- **measured** Claude Code docs Overview groups Idle and Resolved, and the help-center chat row actions. Login wall and missing window recorded above.
- **measured** Amp manual dots: working, unread, waiting for you, failed. No verified word on the pages read.
- **measured** Cursor changelog orange awaiting-input dot and release-note status-line wording. App not opened.
- **inferred** None of these products grade a finished row as verified versus unverified. Unoperated UIs could still hide a label the docs omit.
- **inferred** One stable `已完成` matches Cairn's existing group and phase chip better than t3code's disappearing pill.
- **guessed** Cursor's gray/blue/yellow dot legend still matches the current app. Staff posts say so; this session did not open Cursor.
- **guessed** Amp Activity's Status filter options. The manual names the filter and does not list the options on the pages read.
