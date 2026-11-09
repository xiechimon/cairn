# Where a thread's (agent task's) PR should live and how much to show: reference product survey

Date: 2026-11-06. Scope: research only; no code changed, no PR opened. Background: cairn #3181 (D109 S2, issue #3122) puts the PR in a pinned card at the top of the thread panel, adds a `PR #N ↗` link in the thread header, and the tasks panel has its own PR list; the only reference cited is Claude Desktop's changes panel. The owner asked whether this placement is right.

Labeling convention: `实测` = an interface I operated or saw myself this round, or source code I read myself; `推断` = derived from `实测`, re-checkable; `猜测` = everything else.

Screenshots are under `thread-pr-placement-2026-11-06/` (subfolders per product). Some third-party screenshots were withheld from the repository because they showed private account content; each is replaced below by a one-line text description.

## 0. Coverage and gaps (read this first)

| Product | How far it went | What is missing |
|---|---|---|
| Cursor cloud agent (cursor.com/agents, in the owner's signed-in Chrome) | `实测`: list rows + one thread page with a merged PR | No instance of CI running/failed/ready (the owner's account only has Merged agents and agents without a PR); narrow screen not tested |
| Amp (ampcode.com, signed in) | `实测`: the thread page's Changes panel and the Ship dialog (I clicked cancel, nothing submitted) | The account has no thread with a PR; Ship's prompt is "push to origin/main", not open a PR, so the PR state cannot be reached; narrow screen not tested |
| t3code (0.1.7, an existing instance on 127.0.0.1:3773 on this machine, not started by me; I toggled the panel switch once and restored it) | `实测`: the right-hand card of a draft thread; **source code** (pingdotgg/t3code main, paths below) read in full for the thread-PR model | No real thread with a real PR, so real CI-state UI was not captured, only described from source; narrow screen not tested |
| Claude Desktop Code page | Official docs text (code.claude.com/docs/en/desktop) | This session cannot screenshot the desktop app itself, so visuals are not tested (`猜测`-level). The docs give location and menus but not CI state names |
| Codex cloud (chatgpt.com/codex) | `实测`: Codex home, one thread page (no PR) | The owner's account has no cloud task/PR; demonstrating it needs a new cloud task that opens a PR (a write operation that consumes quota), not done this round; states not tested |
| Conductor | Not done | Linux machine here; Conductor is macOS only; cannot run |
| Narrow screen / phone (all external products) | Not done | Resizing the browser window on this machine did not change the viewport (screenshot width unchanged), so it could not be tested |

The cheapest way to close these gaps is to open one real small PR in each of Cursor and Codex (this changes the owner's GitHub). I did not, because that needs explicit permission first.

## 1. Per-product notes

### 1.1 Cursor cloud agent (`实测` + partly `推断`)

Screenshots: `cursor/01-agent-list-merged-badge.jpg`, `cursor/02-merged-agent-changes-pane.jpg`. Both screenshots were withheld from the repository because they showed private agent and thread titles, a real name, an avatar and the plan tier. What they showed:
- `cursor/01-agent-list-merged-badge.jpg` (withheld): the agent list, where each row has a thumbnail carrying the PR status badge (`Branch` for no PR, a purple `Merged` for a merged PR, with `8 files +62 −46` in the top-left corner).
- `cursor/02-merged-agent-changes-pane.jpg` (withheld): a merged agent's thread page with the conversation on the left and the `Changes` tab on the right, whose top shows the `Merged` badge, the branch and `View PR`, then `Diff | Review | Commits 1`.

- **List** (`实测`): each row has a thumbnail on the left, and the PR status badge sits inside that thumbnail: no PR shows `Branch`, merged shows a purple `Merged`, with `8 files +62 −46` overlaid in the top-left. PR status is a first-class part of the list row; you do not need to open the thread.
- **Thread page** (`实测`): two columns. The left is the conversation; the right is a tabbed panel: `Changes | Desktop | Terminal | Files | +`. The top of the `Changes` tab is the PR header: a `Merged` badge · `cursor/<branch> → main` · a `View PR` button on the right; below it the PR title and `7 of 7`; below that the sub-tabs `Diff | Review | Commits 1`.
- **Inside the conversation** (`实测`): the agent's message text itself says `PR: #8`, the merge commit and the deploy status (this is text the agent wrote, not a product-generated event); under the message there is a `5 Files Changed` file list and a `Review` entry point.
- **Always visible / needs a click**: PR status is always visible in the list; on the thread page the PR header is inside the right-hand Changes tab, so it is not visible when that tab is not selected (`推断`: the right column defaults to Changes, and it was open when I entered). Diff, review and commits are behind a click.
- **Scrolling** (`实测`): the right column scrolls on its own; the PR header is at the top of the right column and scrolls with that column's content; scrolling the conversation does not affect the right column (I only scrolled the page shown in the screenshot and did not specifically verify the right column's position while the conversation scrolls; this item is `推断` from "two columns scroll independently").
- **State presentation**: no PR = `Branch` badge (`实测`); merged (`实测`); CI running/failed/ready (not tested).
- **Narrow screen**: not tested.

### 1.2 Amp (`实测`)

Screenshots: `amp/01-thread-changes-panel-no-pr.jpg`, `amp/02-ship-dialog.jpg`.

- The right half of the thread page is a permanent `Changes` panel; its top bar has three buttons, `Ship`, `Review`, `Restack`, and a branch icon at the top right. With no changes the panel shows the empty state `No Changes`.
- `Ship` opens a confirmation dialog whose content is a prompt to the agent ("Ship all committed and uncommitted changes to origin/main… run the full test suite…"), with `Edit Prompt` and a hint that holding the click skips the confirmation. So Amp's Ship hands "commit, rebase, push" to the agent as a single prompt; it is not a GitHub PR object (`推断`: based on the dialog content; I did not click Ship).
- The thread page header has no PR link; in the left list a thread row has only a status dot (yellow) and an `Error` label, with no PR information (`实测`).
- **Always visible / needs a click**: the panel and the three actions are always there; everything else is behind a click.
- **PR states**: I did not see a PR as a stateful object in Amp (this account produced no PR; `推断` that Amp is centered on "changes + actions" rather than "PR + CI", not certain).
- **Narrow screen**: not tested.

### 1.3 t3code (source `实测` + one UI screenshot)

Screenshot: `t3code/01-draft-thread-right-card.jpg` (a draft thread; floating card at the top right: machine, Open in VS Code, `Add project script`, branch `master`). Source paths (repository pingdotgg/t3code, main, read this round):

- `apps/web/src/components/pullRequest/ThreadPullRequestsPanel.tsx`
- `apps/web/src/components/chat/RightPanelSurfaceContent.tsx` (`case "pull-requests": return <ThreadPullRequestsPanel .../>`)
- `apps/web/src/components/chat/ThreadDetailsPanel.tsx`, `apps/web/src/components/GitActionsControl.tsx`
- `apps/web/src/components/chat/ChatHeader.tsx` (zero matches for `PullRequest`/`Checks`: the header does not carry the PR)
- `apps/web/src/components/pullRequest/PullRequestChecksPopover.tsx`, `useThreadLinkedPullRequest.ts`, `PullRequestThreadLinks.tsx`

Key points (all `实测`, from source text):
- The PR is **a surface in the right panel** (a tab), alongside preview, diff, side-chat and others; one thread can attach **multiple** PRs (`thread.pullRequests`, `visibleThreadPullRequests`, `resolveThreadPullRequestChains`; a comment mentions that a stack or sweep can link hundreds of PRs, so the list is virtualized).
- Each PR is one row: a status icon (open/draft/merged/mergeability), the `#number`, the title, a small checks-status icon (`ChecksGlyph`, the tooltip gives the state name), a review-verdict icon, added/removed line counts, and a watching eye icon. Hovering the `#number` tells the origin: `Created from this thread` / `Linked by the agent` / `Linked by you` / `Found in the stack`.
- Empty-state copy when there is no PR: `No linked pull requests` ("Pull requests the agent opens from this thread land here. Link one yourself from a URL or a number."), with a `Link pull request` button.
- **Watching**: the in-row tooltip states that while watching, the agent is woken when "checks finish, someone comments or the branch…", i.e. the PR's live state **drives agent turns** rather than only being displayed.
- A summary is pinned at the bottom of the panel: `{n} open · {m} linked · synced {time}` plus a `Link` button.
- The commit/push/open-PR actions live in `GitActionsControl` (inside `ThreadDetailsPanel`); after a PR is opened a toast says `Created …`.
- Always visible / needs a click: the right panel is open by default (a floating card in the screenshot); the PR tab has to be switched to; the header has no PR. Scrolling: the panel scrolls independently (`推断`, from the list's own scroll container `overscroll-contain`). Narrow screen: not tested.
- Real visuals of each PR state: not tested.

### 1.4 Claude Desktop Code page (docs text; visuals not tested)

Source: code.claude.com/docs/en/desktop (read this round).
- After a PR is opened, it appears in the **`Changes` card of the session details panel**, and the card shows CI check status; when the conversation area is wide enough the panel sits beside the chat, and can be toggled with `Hide session rail` / `Show session rail`. (`实测`: docs text)
- In the older layout, the session **status bar** has a `CI` button that you click once a PR exists. (`实测`: docs text)
- The `+12 -1` line count in the `Changes` card opens the diff; the `⋮` menu next to the PR title holds `Auto-fix` and `Merge when ready`. (`实测`: docs text)
- The docs do not name the CI states and do not describe narrow-screen behavior. (`实测`: the absence itself)
- I cannot see how the PR bar and CI/auto-fix actually look in this session (no desktop screenshot tool). **If the owner wants to check, take a screenshot yourself of a session with a PR on the Code page.**

### 1.5 Codex cloud (`实测`: no-PR state; other states not tested)

Screenshots: `codex/01-home.jpg`, `codex/02-chat-outputs-card.jpg`. Both screenshots were withheld from the repository because they showed private thread titles and account details. What they showed:
- `codex/01-home.jpg` (withheld): the Codex home page with the left `Codex` sidebar, `New chat` and the `Recents` thread list (cloud thread rows have a cloud icon on the right), and the `Cloud` and `Default environment` selectors above the input box.
- `codex/02-chat-outputs-card.jpg` (withheld): a local thread page with no PR, showing the `Outputs` card at the top right and `Share` in the header.

- Home: the left `Codex` sidebar, below it `New chat` and the `Recents` thread list (cloud thread rows have a cloud icon on the right). Above the input box are the `Cloud` and `Default environment` selectors.
- Thread page (local thread, no PR): top right there is an `Outputs` card ("Create an output" plus button), at the top right of the input box, not scrolling with the conversation (`实测` only that this is its position in the screenshot; whether it scrolls was not tested). The header has `Share`.
- The official docs (learn.chatgpt.com/docs/cloud) only say "review changes and test results, request follow-ups, commit or open a PR", with no detail on PR/CI placement (`实测`: the absence).
- The owner's account has no cloud task/PR, so PR states are not tested. `猜测`: the Outputs card is the thread's right-hand container for "artifacts" and a PR probably lands there, but I did not see it, so it is not used as evidence.

### 1.6 Conductor

Not done; reason in section 0.

## 2. Product x state table

A "—" in a cell means it was not observed; the parentheses give the strength of evidence.

| State | Cursor cloud agent | Amp | t3code | Claude Desktop | Codex cloud | cairn #3181 |
|---|---|---|---|---|---|---|
| No PR | List thumbnail `Branch` (`实测`) | Changes panel `No Changes` / Ship button (`实测`) | Right panel PR tab empty state `No linked pull requests` + `Link pull request` (source, `实测`) | Docs silent (—) | Thread has no PR card, `Outputs` card at top right (`实测`) | No card, and no PR link in the header either; the header keeps only `Needs you · just now` (`cairn/thread-pr-none-light.png`, `实测`) |
| Open + CI running | — (not tested) | — (not tested) | Inline checks icon, tooltip with state name (source, `实测`) | Changes card shows CI status (docs `实测`, visuals not tested) | — | Top card `Checks running` + `6/9` (`cairn/thread-pr-ci-running-light.png`, `实测`) |
| CI failed | — | — | Same, the icon changes with state (source, `实测`) | `Auto-fix` in the ⋮ menu (docs) | — | Top card `Checks failed` + `2 failed: lint, e2e (1)` (`cairn/thread-pr-ci-failed-light.png`, `实测`) |
| Ready (mergeable) | — | — | The row status icon includes mergeability (source, `实测`) | `Merge when ready` in the ⋮ menu (docs) | — | Top card (a matching screenshot exists, see `docs/verify/3122/fixture/`) |
| Merged | List thumbnail purple `Merged` + thread right-column header `Merged` badge + `View PR` (`实测`) | — | Row status merged (source, `实测`) | Docs mention auto-archive after merge/close, no visuals (docs) | — | Top card `merged` (`cairn/thread-pr-merged-light.png`, `实测`) |

## 3. Where each product puts the PR (summary, to find the majority pattern)

| Location type | Cursor | Amp | t3code | Claude Desktop | Codex | cairn #3181 |
|---|---|---|---|---|---|---|
| Thread header | No (header has only title + repo, `实测`) | No (`实测`) | No (source, `实测`) | Older layout has a `CI` button in the status bar (docs) | No (`实测`) | Yes: `PR #N ↗` link + status row |
| Pinned card above the conversation | No | No | No | No | No | **Yes** (`ThreadPrPanel` between Head and ThreadBody) |
| Right panel / tab | **Yes**: `Changes` tab header | **Yes**: `Changes` panel | **Yes**: `pull-requests` surface | **Yes**: the session details `Changes` card | Probably the `Outputs` card (not verified) | No (Changes is a main-area switch view, `ChangesButton`) |
| Inline event in the conversation | Only text the agent wrote itself | No | No (none seen, `实测`) | Unknown | Unknown | No |
| Bottom bar | No | No | No | No | No | No |
| List row | **Yes**: thumbnail badge + line counts | No (status dot only) | Thread sidebar not tested | Unknown | Unknown | Yes: tasks panel PR list |

## 4. Majority pattern (`推断`)

1. **The PR lives where the changes live: a right-hand panel beside the conversation, titled Changes.** Of the 5 products, Cursor, Amp, t3code and Claude Desktop (4) clearly have this structure (Codex probably, not verified). PR status is the **header/card** of the Changes panel, not something above the conversation. (`推断`, basis: the table in section 3)
2. **No product pins the PR above the conversation.** All 4 external products are "No". cairn #3181's pinned top card has **no precedent** in this set. (`推断`; with one caveat: Claude Desktop's older layout puts `CI` in the session status bar, which sits between the header and a pinned card and is the closest precedent.)
3. **The header does not carry the PR.** None of the 4 clear products has it in the header (except the older Claude Desktop status bar button). The `PR #N ↗` link in cairn's header is the minority. (`推断`)
4. **List rows should carry PR status.** Cursor's thumbnail badge is the most direct approach: `Branch`/`Merged` + `8 files +62 −46`. (`实测`, one example)
5. **PR status is more than display.** t3code's watching lets PR/CI events wake the agent; Claude Desktop puts `Auto-fix` and `Merge when ready` in the PR's ⋮ menu. Actions sit next to the PR object. (`实测`: source and docs)
6. Collapse level: status (icon/badge) is always visible; diff, review, commits and actions need a click. (`推断`, from the structure of Cursor and t3code)

## 5. Comparison with cairn #3181

Screenshots: `cairn/thread-pr-ci-running-light.png`, `cairn/thread-pr-ci-failed-light.png`, `cairn/thread-pr-merged-light.png`, `cairn/thread-pr-none-light.png`, `cairn/thread-pr-ci-running-375.png`, `cairn/pr-list-light.png` (taken from `docs/verify/3122/fixture/` on branch `web/d109-s2-pr-panel`).

cairn's current state as observed (`实测`):
- A card at the top of the thread panel (below the header, above the messages): a truncated title, `#42 · Checks failed · +120 −14`, a second line `2 failed: lint, e2e (1)`, a `6/9` progress, an expand arrow and `⋯`. The header additionally has a `PR #42 ↗` link.
- Code (`apps/web/src/board/side-chat.tsx`, around line 419): `ThreadPrPanel` sits between `Head` and `ThreadBody` as a sibling, and the message scroll area does not contain it; so it **does not scroll with the messages** (`推断`, from the component structure; scrolling was not actually verified).
- At 375 width: the card stays two lines, the title keeps truncating, and `⋯` is on the right (`cairn/thread-pr-ci-running-375.png`, `实测`). This is the only product with narrow-screen evidence in this survey.
- cairn also has a `Changes` button that switches the main area to the changes view (`ChangesButton`); this is the same concept as Cursor's Changes tab: in cairn the PR and the changes are in **two separate places**.

Differences:
- Majority pattern: the PR header is in the Changes panel, in the same place as the diff. cairn: the PR is pinned above the conversation and the diff is in another view.
- Majority pattern: no PR in the header. cairn: the header has `PR #N ↗`, which duplicates the `#42` in the top card (`实测`: visible in both screenshots).
- On lists: Cursor's list rows carry status directly; cairn's PR list is in the tasks panel as a separate list.

## 6. Recommendation (`推断`, with basis; not "the only right answer")

**Conclusion: keep an always-visible one-line status, but do not keep a full-height pinned card plus a duplicate header link; move the PR's details and actions to the same place as Changes.** Concretely:

1. **Keep**: the thread always has a very small PR status entry (badge + `#N` + CI x/y). Basis: Cursor's list thumbnail badge and Claude Desktop's older status bar `CI` both show that "status always visible" is wanted; cairn threads are mostly long-running agents, and a CI failure needs to be seen quickly. (`推断`; because agent threads are long, this is my judgment about cairn's situation, not directly proven by any reference product)
2. **Change**: compress the current **two-line pinned card** to **one line**: `#42 · Checks failed 6/9 · +120 −14` + `⋯`. Put the second line (`2 failed: lint, e2e (1)`) in an expand area after a click. Basis: in the majority pattern "details are behind a click" (section 4, item 6); in `cairn/thread-pr-ci-failed-light.png` the second line gets truncated. (`推断`)
3. **Change**: delete the `PR #N ↗` link in the header and keep a single external link inside the status row. Basis: none of the 4 external products has it in the header, and `#42` appears twice in cairn's two screenshots. (`推断`)
4. **Move**: long term, fold PR details, the checks list, review and actions (auto-fix, merge) into a PR header at the top of the `Changes` view, like Cursor's `Merged · branch → main · View PR` plus the `Diff | Review | Commits` sub-tabs. That puts the PR and the diff in the same place, which matches the majority pattern. This is a bigger change; I suggest it as the next step after #3181, not as a blocker for #3181. (`推断`)
5. **Add**: a status badge on list rows (Cursor's approach), so the tasks list shows at a glance which PRs are waiting on someone. cairn already has a PR list and only lacks the badge in the thumbnail slot; this is incremental. (`推断`)
6. **Evaluate later**: t3code's "watching wakes the agent" and Claude Desktop's `Auto-fix` both wire PR events into agent turns; if cairn wants this it needs its own design and is not a placement question. (`推断`, a pointer only)

**Uncertain parts (`猜测`)**:
- The majority pattern rests on only 4 products, without Codex and Conductor; I have no external observation of CI running/failed, so the exact information content of the "one-line status" (whether to include `6/9` and failing items) has no external precedent and is my judgment.
- There is no observation of any external product on a phone-width screen, so the narrow-screen approach cannot be borrowed; I can only use cairn's own 375 screenshot to judge that the card itself is usable.

## 7. For the owner to decide / optional follow-up tests

- Whether I may open one real small PR in each of Cursor and Codex to fill in the CI running/failed/ready states (this produces a PR and a cloud task in a GitHub repository of the owner).
- Claude Desktop's PR bar: the owner needs to take a screenshot on the Code page of a session with a PR (one running, one failed); this session cannot see the desktop app.
- Whether #3181 merges after the small changes in section 6 items 2 and 3, with item 4 as a separate follow-up.
