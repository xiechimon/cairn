# Design surface: preview, comment on and version the pages a task makes

Status: product design for owner review, no code yet (ian, 2026-11-20). Owner input: borrow Open Design's code (Apache-2.0) instead of embedding the product; phase 1 is HTML preview, click-an-element-to-comment, version history and viewport switching; chat on the left, design on the right; and one rule for which file opens in which surface. Prior art: [`open-design-2026-11-20.md`](../research/open-design-2026-11-20.md) (source read at `nexu-io/open-design@07258801b9e4ae80553816bb1606af7aa9a63dff`). This design adds a walk of the running pilot (`ghcr.io/nexu-io/od:0.27.1` on `127.0.0.1:7456`, 2026-11-20) through the four phase-1 features; screenshots stay local under `/tmp/dogfood/design-surface/od-*.png` and are not committed.

Tags: **verified** = read in source at the named commit or run live this session; **derived** = follows from verified facts and can be rechecked; **guess** = the rest.

## Newcomer

Someone who installed Cairn today asks a task for a page: `做一个定价页，三档套餐`. When the task finishes, the reply carries a card with a thumbnail, the file name and `v1`. Clicking it opens the design view: the task's conversation stays on the left, the page runs on the right at full size. Above the page they can switch between desktop, tablet and phone widths, turn on `评论` and click any element to leave a note, and open `版本` to see every version the task produced and switch back to an older one. Notes go to the task as one message; the agent's next version shows up on the right with the notes pinned where they were.

- Why it is there: today a page a task makes shows in a 380px-tall frame inside a report dialog, or not at all when it has scripts (see "Where Cairn opens files today"). Feedback on a page means describing the element in prose.
- What they must already know: how to send a message to a task. Nothing about Open Design; it is not installed or shown.
- Accounts, payments, keys: none. Comments and versions add no model call of their own; sending comments starts the same agent turn any message starts, billed like any turn.
- Where it stores what they give: the page versions are the deliverable attachments Cairn already stores on the server (`attachment` rows with `scope = 'deliverable'`); comments and the version list are two new tables in the same server database. Nothing leaves the machine that runs the Cairn server.
- Where they get stuck or what they see on failure: a page larger than 2 MiB is not collected (the existing `DELIVERABLE_LIMITS.maxPageBytes`), so no card appears and the reply lists it under skipped files; a page that loads remote scripts, fonts or images renders without them, with one line saying the preview is offline; a comment whose element is gone in a newer version is listed with `这一版没找到` instead of a wrong pin; a failed send leaves the comments unsent with a retry toast.

## Why

The owner does not know which file opens in which form, and pages open in a small window. Measured in the code (verified, this worktree):

- A page deliverable opens only inside `ResearchReportDialog` (`apps/web/src/chief/research-report.tsx`, a `DialogShell` at `--settings-w` x `--settings-h`), where `MadeFiles` renders it in `PageFrame` at `h-95` (380px, 300px on phones) (`apps/web/src/board/made-files.tsx`).
- `PageFrame` uses `sandbox=""` and a CSP without scripts, so a page with any script is not previewed at all: the row says `含脚本，下载后打开`. Prototypes with key switching, tabs or menus are exactly the pages that need review.
- An `.html` attachment opened from chat goes to `FilePreviewPanel`, which classifies `html` as text (`TEXT_EXTS` in `apps/web/src/board/file-pane.ts`) and shows its source.
- Images open in two different places: `FilePreviewPanel` when the home page provides `OpenFileContext`, otherwise the `AttachmentPreview` dialog (`apps/web/src/overlay/attachment-preview.tsx`) capped at `max-h-96` (384px).
- Every other attachment link uses `target="_blank"`; in the Mac app `setWindowOpenHandler` hands any `http(s)` URL to `shell.openExternal` (`apps/desktop/src/main.ts:288`), so a log or a slides file leaves the app for the system browser (verified). Whether that browser session is signed in to the local server is not checked (guess: often not).

## Where Cairn opens files today

| # | Place | Code | Opens | Form |
|---|---|---|---|---|
| 1 | File side panel | `board/file-preview-panel.tsx`, `board/file-pane.ts` | md (rendered, source toggle), text and code (line numbers, 5000-line cap), images, PDF (iframe), html as source text, other: download | `SidePanel`, 420px, resizable to 60% |
| 2 | Image dialog | `overlay/attachment-preview.tsx`, used by `chief/sent-attachments.tsx` (fallback), `detail/chat-markdown.tsx`, `overlay/composer-attachments.tsx` | images | `DialogShell size="l"`, image max 384px tall |
| 3 | Report dialog | `chief/research-report.tsx` (`ResearchReportDialog`), opened from the report card in chat and from a made card (`board/work-panel.tsx` `MadeReport`) | report markdown plus `MadeFiles` | modal at settings size |
| 4 | Page frame | `board/made-files.tsx` `PageFrame` | first page deliverable, scripts off | 380px inline frame inside #3 |
| 5 | Made card thumbnail | `board/made-carousel.tsx` with `PageThumb` | page at 800x600 scaled, or `todo.previewUrl` image | card in the results panel |
| 6 | Attachment chip | `detail/attachment-chip.tsx` | images: handler (#1 or #2); other files: new tab | inline chip, `target="_blank"` |
| 7 | Attachment tile | `components/composer-attachment-tile.tsx` | preview handler or new tab | tile |
| 8 | Links in messages | `detail/segments.tsx` anchors | any URL | new tab, external in the Mac app |
| 9 | Diffs | `board/side-chat.tsx` changes section with `DiffFileBody` (`detail/docpane.tsx`); `board/thread-pr-panel.tsx` scrolls to it; PR links go to GitHub | per-file hunks | inline in the task panel |
| 10 | Tool output and logs | `components/chat/trace-steps.tsx` `TraceOutput` | command output | expandable rows in the transcript |
| 11 | Gallery frames | `design/screens.tsx`, `design/product-pages.tsx` | dev gallery only | out of scope |

No video player exists (no `<video>` outside the gallery, verified).

## The rule: file type to surface

Pick the surface by what the user does next, not by the file type alone:

- **Inline in chat**: glance. Confirm it exists and what it is, without leaving the conversation. Always a card, chip or collapsed row, never a scrolling viewer.
- **Side panel** (`SidePanel`, beside the chat): read. Linear content read while the conversation stays visible.
- **Design view** (chat left, design right): iterate. Visual feedback, comparing versions, checking widths.
- **External app**: work with a format Cairn cannot render faithfully, or one the user wants to keep editing. On the Mac app this means the OS default app for a downloaded copy; on the web, a download.
- Never a modal dialog for content. Dialogs are for confirmations and forms; the dialogs in rows 2 and 3 above are what the owner calls the small window.

| Type | Inline in chat | Click opens | External app when | Change from today |
|---|---|---|---|---|
| html (page deliverable or `.html` attachment) | card: thumbnail, name, `vN`, open-comment count | design view | never by default; `⋯` offers `在浏览器打开` and download | html is no longer text in the side panel; the 380px frame and the report dialog wrapper go |
| md (report, `.md` file) | first lines and title as a card; short assistant replies stay as chat markdown | side panel, rendered, source toggle | never | reports leave the dialog for the side panel |
| image (png, jpg, gif, webp, svg) | thumbnail chip | side panel image view, fit to width, zoom by panel resize | never | the image dialog is removed; one path through `OpenFileContext` |
| video (mp4, webm, mov) | poster frame chip with duration | side panel `<video controls>` | codec the app's Chromium cannot play: download and open in the default app | new |
| pdf | chip with page count | side panel iframe (today's viewer) | user picks `⋯` > `用默认应用打开` | none |
| diff | changed-file list with +/- counts in the task panel (today) | per-file hunks in the side panel (today) | review on GitHub from the PR row (today) | none |
| log (tool output, `.log` attachment) | last lines, collapsed (today's `TraceOutput`) | side panel text view with line numbers | past the 5000-line cap: download | `.log` attachments stop opening a browser tab |
| pptx, docx, xlsx, zip, other | chip with type and size | external app | always | the Mac app opens the downloaded file with the default app instead of handing a URL to the browser |

Only the html row is phase 1's design view. The other rows are small changes to existing components; whether they ship with phase 1 is open question 3.

## Phase 1 scope

1. HTML preview: a page deliverable runs in the design view at full size, scripts on, network off.
2. Click-an-element comment: comment mode, element highlight, popover note, save or send now; pending comments ride the next message.
3. Version history: every published page is a version; view an older one read-only; switch back by appending it as a new version.
4. Viewport switching: desktop (fills the pane), tablet 820x1180, phone 390x844, scaled to fit the pane when larger.

Layout, from the mock (`/tmp/dogfood/design-surface/mock.html`, screenshots `mock-*.png`):

- Route: the home shell's query parameters, like every other pane: `/app?thread=<todoId>&view=design&file=<name>` (`THREAD_PARAM`, `VIEW_PARAM` in `board/thread-copy.ts`). Back returns to the docked thread.
- Left: the task thread, the same transcript and composer the docked task panel uses (`board/side-chat.tsx`), at the docked width bounds (440 to 600px, `components/side-panel-width.ts`). The Coordinator conversation and sidebar are hidden while the design view is open.
- Right: a 44px toolbar (file picker when the task made several pages, `vN` tag, viewport segmented control, `评论`, `版本`, comment count, `⋯`), then the canvas.
- Below 1100px the two halves become one pane with a `对话` / `设计` segmented switch in the head (mock shots 08 and 09); R1 applies at 390px.

## Scenarios

| Situation | What the user sees | What the system does | Wait and cost |
|---|---|---|---|
| A task finishes with `pricing.html` | Reply with a card: thumbnail, `pricing.html`, `v1` | Step completion publishes the deliverable (today) and inserts version 1 in the same transaction | None beyond the task |
| Clicks the card | Design view; page at full width, scripts running | Reads the version's attachment (`/api/attachments/:id`), injects the bridge, renders in a sandboxed `srcdoc` iframe | One fetch of up to 2 MiB |
| Picks `手机` | Page at 390x844 centred, scaled if the pane is shorter | Resizes the iframe; the page reflows | Instant |
| Turns on `评论`, hovers, clicks the Pro button | Outline follows the pointer; popover names `button · 升级到 Pro` with a note box, `保存` and `发给 agent` | Bridge posts the target (selector, text, rect, html hint) to the parent; nothing stored yet | Instant |
| Saves two comments | Two numbered pins on the page; two chips above the composer; send button reads `发送（含 2 条评论）` | Inserts two `design_comment` rows, status `open` | Instant |
| Sends | One user message in the thread with both notes listed under the file and version | `POST /api/todos/:id/messages` with `designCommentIds`; the server renders the comment block into the message and flips both rows to `sent` in one transaction | One agent turn, minutes; tokens by the task's routing rule |
| Sends while the agent is still running | Message shows as queued, like any message sent mid-turn | Existing queue and steer path; rows flip to `sent` when the message is accepted | Delivered after the current turn |
| Agent publishes v2 | New card `v2` in the reply; the right side switches to v2 if the user is on the current version, otherwise a `有新版本 v2` line | Version 2 inserted at step completion; pins re-located on v2 by selector, then text | None |
| A pinned element no longer exists in v2 | The pin moves to the comment list as `在 v1 上提的，这一版没找到` | Anchor resolution returns `lost`; nothing is written | None |
| Opens `版本`, picks v1 | Read-only v1 with a banner `正在看 v1` and `切回这个版本` / `回到当前` | Reads v1's attachment | One fetch |
| Switches back to v1 | v3 appears at once, labelled `从 v1 恢复`; a note in the thread says the next change starts from it | Inserts version 3 pointing at v1's attachment (`source = 'restore'`); no agent turn | No model cost |
| Next message after a restore | Normal send | The message carries `design: { file, versionId }`; the agent is told which version the owner is looking at and gets its attachment when it differs from the workspace copy | Same as any turn |
| The page fetches data or loads a CDN font | Page renders with fallbacks; toolbar line `预览不联网` | CSP blocks network; the bridge reports blocked loads | None |
| Page over 2 MiB | No card; reply lists it under skipped files (today's copy) | Not collected, so no version | None |
| Server unreachable | Design view shows the last loaded version; saving or sending says it did not go through and keeps the text | Writes fail; the composer's offline state applies | None |
| Task archived | Design view opens read-only; comment and restore hidden | Writes are refused like other archived-task writes | None |
| Old task from before this ships | Its page cards open the design view with one version | A migration inserts version rows from existing deliverables messages, oldest first | One-time migration |

## Components

Existing Cairn pieces (reuse, `DESIGN.md` V10):

| Need | Cairn component | Change |
|---|---|---|
| Left conversation | `board/side-chat.tsx` (`SideChat`), `detail/transcript.tsx`, `detail/composer.tsx` | Mount in the design layout; composer shows pending comment chips |
| Pending comment chips | `components/composer-attachment-tile.tsx` (chip form) | New kind `comment` with number and first words |
| Page card in chat | `board/made-carousel.tsx` `MadeCard` with `PageThumb` (`board/made-files.tsx`) | Adds `vN` and open-comment count; click opens the design view instead of the report dialog |
| Page frame | `PageFrame` in `board/made-files.tsx` | Becomes `DesignFrame`: `sandbox="allow-scripts"` (no `allow-same-origin`), CSP allows inline scripts, keeps `connect-src 'none'`, injects the bridge; `PageThumb` stays inert. The 380px inline frame in `MadeFiles` is removed |
| Viewport switch | `components/segmented.tsx` | Three options |
| Comment popover, version list | `components/ui/popover.tsx`, `components/list-card.tsx`, `components/ui/textarea.tsx`, `components/ui/button.tsx`, `components/icon-tooltip.tsx` | None |
| Read-only banner, empty and error states | `components/empty-state.tsx`, `components/notice-banner.tsx` | None |
| Side surfaces of the rule | `board/file-preview-panel.tsx` | Add video view; route images and reports here; drop html from `TEXT_EXTS` |
| External app on the Mac | `apps/desktop/src/main.ts`, `desktop-shell.ts` | Download then `shell.openPath` for the external rows instead of `openExternal` on an attachment URL |

New pieces: `DesignView` (layout and toolbar), `DesignFrame` (frame plus bridge host), `CommentLayer` (pins over the frame, positions from bridge messages), `VersionList`, the two tables and their routes.

Open Design pieces to borrow (pinned at `07258801b9e4ae80553816bb1606af7aa9a63dff`, Apache-2.0, root `LICENSE`; the repo ships no `NOTICE` file, verified):

| Piece | Upstream file | Size | How we take it |
|---|---|---|---|
| Comment bridge script | `apps/web/src/runtime/comment-bridge.ts` (`injectCommentBridge`) | 33 lines | Copy and modify: keep picker mode, target posting, hover and scroll messages; drop pod and stroke modes; accept `data-cairn-id` and `data-od-id`, else fall back to a structural selector (upstream returns nothing for unannotated elements); check `event.source` on the parent side |
| Selector and identity helpers | `packages/contracts/src/runtime/annotated-selector.ts`, `packages/contracts/src/runtime/comment-identity-helpers.ts` | 19 and 31 lines | Copy the annotated-selector helper; skip the identity helpers (team comment ids) |
| Body-close injection point | `packages/contracts/src/runtime/html-injection-points.ts` (`findRealTagOffset`) | 890 lines | Do not copy; a 10-line `</body>` search covers our single-file pages |
| Comment target contract | `packages/contracts/src/api/comments.ts` (`PreviewCommentTarget`, statuses) | field names | Adopt the field subset `elementId`, `selector`, `label`, `text`, `position`, `htmlHint`; our own zod schema in `packages/shared` |
| Anchor drift | `apps/web/src/comments/anchor.ts` | 134 lines | Rewrite as three states (`anchored`, `moved`, `lost`); upstream's four-state ladder with fuzzy position matching is more than single-user review needs |
| Viewport presets | `apps/web/src/components/FileViewer.tsx` lines 500-522 | data | Same three presets |
| Comment-to-prompt block | `apps/daemon/src/runtimes/chat-prompt-inputs.ts` (`renderCommentAttachmentHint`) | idea | Rewrite: list each comment's file, version, element, current text and note, with the instruction to change only those elements and report anything else as a follow-up |
| Version semantics | `apps/daemon/src/project-file-versions.ts` | 781 lines | Semantics only: append-only, restore appends a copy with `restoreFromVersionId`, identical digest makes no new version. Storage is ours (database rows over existing attachments), not their `.file-versions/manifest.json` |
| Not taken | `FileViewer.tsx` (20,759 lines), `PreviewDrawOverlay.tsx` (mark mode), `runtime/srcdoc.ts` (4,433 lines, edit bridge), the collab relay | | Out of scope; too coupled to their app |

License handling: copied and modified files live in `apps/web/src/design-surface/vendor-open-design/` with a copy of Apache-2.0 and a `NOTICE.md` naming each upstream path, the pinned commit and "modified by Cairn" (the `ops/langfuse/code-eval-runner/NOTICE.md` pattern). Apache-2.0 section 4(b) asks modified files to carry a notice, so each copied file gets one SPDX line naming the upstream; that line is a legal notice, not commentary, and goes into `scripts/comment-discipline-allowlist.json` with that reason. Cairn is Apache-2.0 too, so no relicensing question arises. Rewrites from reading their code carry no notice.

## Data model

This changes persisted state and the thread message wire, so this section is the one-page design CLAUDE.md asks for.

### Tables

`design_version`: one row per published or restored version of one page of one task.

| Column | Meaning |
|---|---|
| `id` | uuid |
| `teamId`, `todoId` | owner; cascade on todo delete |
| `fileName` | page name as published (unique per task within one deliverables set already) |
| `seq` | 1, 2, 3 per (`todoId`, `fileName`); unique |
| `attachmentId` | content; an existing `attachment` row with `scope = 'deliverable'` |
| `sha256` | copied from the attachment, for the no-change check |
| `source` | `agent` or `restore` |
| `buildId`, `stepId` | the run that produced it (`agent` only) |
| `restoredFromVersionId` | `restore` only |
| `createdBy`, `createdAt` | user id for `restore`, the step for `agent` |

Current version = the highest `seq`. No mutable current pointer exists, so there is nothing to race on.

`design_comment`:

| Column | Meaning |
|---|---|
| `id`, `teamId`, `todoId`, `fileName` | owner and page |
| `versionId` | the version the user was looking at |
| `pin` | 1, 2, 3 per (`todoId`, `fileName`); never reused |
| `elementId`, `selector`, `label`, `text`, `htmlHint` | target from the bridge; `text` at most 160 chars, `htmlHint` at most 180 |
| `rect`, `viewport` | position when made, and in which preset |
| `note` | the user's words, at most 2000 chars |
| `status` | `open`, `sent`, `resolved` |
| `messageId` | the thread message that carried it (`sent`) |
| `createdBy`, `createdAt`, `updatedAt` | |

Anchor state (`anchored`, `moved`, `lost`) is computed on each render and never stored.

### States and transitions

Version: inserted, never updated or deleted except by the todo cascade.

Comment:

| From | Event | To | Who |
|---|---|---|---|
| (none) | save in popover | `open` | user |
| (none) | `发给 agent` in popover | `sent` | user, in the send transaction |
| `open` | send the next message with it attached | `sent` | user, in the send transaction |
| `open` | edit note | `open` | user |
| `open` | remove chip or delete | row deleted | user |
| `open`, `sent` | mark resolved | `resolved` | user |
| `resolved` | reopen | `open` | user |

A `sent` comment cannot be deleted: the message that carried it is in the transcript. The agent never changes comment status in phase 1; seeing its new version is the user's signal.

### Every path that reads or writes the state

| Path | Kind | Where | Behavior |
|---|---|---|---|
| W1 publish | write versions | `publishDeliverables` (`apps/server/src/services/machine-deliverables.ts`), same transaction as the deliverables message | For each accepted `page` item: insert `seq = max + 1` unless `sha256` equals the current version's |
| W2 restore | write version | `POST /api/todos/:id/design/versions/:versionId/restore` | Insert a `restore` row pointing at the old row's attachment; publish a thread event so both the panel and other open clients update |
| W3 save comment | write | `POST /api/todos/:id/design/comments` | Validate the version belongs to the todo; insert `open` |
| W4 edit, resolve, reopen | write | `PATCH /api/todos/:id/design/comments/:commentId` | Allowed transitions only; otherwise 409 |
| W5 delete | write | `DELETE /api/todos/:id/design/comments/:commentId` | `open` only; otherwise 409 |
| W6 send | write message and comments | `POST /api/todos/:id/messages` (`messageThreadAsUser`, `apps/server/src/services/thread-message.ts`) with new optional `designCommentIds` and `design: { fileName, versionId }` | Loads the rows, checks todo and `open`, renders the comment block into the message, flips rows to `sent` with `messageId`, all inside the existing `clientMessageId` coalescing so a retried send never sends twice |
| W7 migration | write versions | one Drizzle migration | For each deliverables message, oldest first, insert versions for its `page` items with the W1 rule |
| R1 list pages | read | `GET /api/todos/:id/design` | Pages with current `seq`, version count, open comment count; feeds the card and the file picker |
| R2 versions | read | `GET /api/todos/:id/design/:fileName/versions` | Rows by `seq` descending |
| R3 content | read | existing `GET /api/attachments/:id` | Unchanged route and auth |
| R4 comments | read | `GET /api/todos/:id/design/:fileName/comments` | All statuses; the client resolves anchors |
| R5 prompt | read | the step prompt builder for the next turn | Reads the message content only; comments are already rendered into it |
| R6 todo record | read | `todos.ts` deliverables join | Adds current `seq` per page for the card |

No other code reads or writes the two tables.

### Failure behavior

- W1 insert fails: the step-completion transaction fails as a deliverables write failure does today; nothing half-published.
- W2 on an archived todo or a version of another todo: 409 or 404; the panel keeps the old view and says so (C24).
- W3 to W5 network failure: the pin or chip goes back to its previous state with a toast (C24); the popover keeps the typed note.
- W6 failure: the message and the status flips roll back together; chips stay; the composer keeps the text. A comment already `sent` by a concurrent send makes the request 409 and the client refreshes the chips.
- Two restores at once: SQLite serializes writes; each gets its own `seq`.
- Attachment missing (expired or deleted): the version row stays; the design view shows `这一版的文件已经不在了` with the version list still usable.
- Bridge never answers (page replaced `document`, crashed or blocked script): comment mode shows `这个页面不支持点选评论`; viewport and versions still work.

### Security

The page runs in an iframe with `sandbox="allow-scripts"` and no `allow-same-origin`, so it has an opaque origin: no cookies, no storage, no access to the Cairn window; the CSP meta keeps `default-src 'none'`, adds `script-src 'unsafe-inline'`, keeps `connect-src`, `form-action` and `frame-src` at `'none'`; no top navigation or popups. The parent accepts bridge messages only when `event.source` is the frame's window and validates every field against the zod schema. No new route serves HTML; content comes through the existing attachment route. The new routes write only rows owned by the caller's team. None of the paths is in the `merge-gate-paths.json` security lists; the change still gets `/security-review` because it turns scripts on for agent-written HTML.

## Tests

One per path, user-visible where possible (memory: fewer tests): W1 (a second publish with new content makes v2, the same content makes none), W2 (restore makes v3 and the view switches in the same frame), W3 to W5 (one e2e: save, edit, delete a chip; a `sent` comment refuses delete), W6 (send carries both notes into the message and a retried `clientMessageId` sends once), W7 (an old deliverables message yields v1), the anchor states (one spec moving an element between versions), the sandbox (a page that reads `document.cookie` and calls `fetch` gets nothing), and R1 at 390px (`DESIGN.md` R1).

## Out of scope

Mark and draw mode, edit mode, export (PDF, image, zip, standalone HTML), share links, present mode, screenshot-to-chat, multi-file tabs beyond the file picker, side-by-side version diff, comments on images, PDFs or slides, agent-set comment status, real-time multi-user comments, network access inside the preview, and running Open Design itself.

## Open questions for ian

1. Left side: the task's own thread (recommended: comments must land in the conversation of the agent that edits the page) or the Coordinator conversation?
2. Should the generating agent be told to add `data-cairn-id` to elements? Recommended: not in phase 1; the bridge's selector and text fallback works on any page, and the lost-pin rate decides later.
3. Ship the rule's non-HTML rows (images and reports to the side panel, video player, external app on the Mac) in phase 1? Recommended: yes, as separate small commits; they remove the small windows the owner named.
4. Network off in the preview: keep it off (recommended; it matches today's CSP and keeps agent-written pages from calling out), or allow images and fonts from `https:`?
