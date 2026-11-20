# Design surface: preview, comment on, mark up, version, export and share the pages a task makes

Status: one scope, building (ian, 2026-11-20). The owner overruled the phased plan of the first draft (a5ccfe8bd): everything below ships together, there is no phase 2. Borrow Open Design's implementation (Apache-2.0) consistently instead of keeping home-made halves; its file viewer covers the non-HTML file types. Prior art: [`open-design-2026-11-20.md`](../research/open-design-2026-11-20.md) (source read at `nexu-io/open-design@07258801b9e4ae80553816bb1606af7aa9a63dff`); the running pilot (`ghcr.io/nexu-io/od`, `127.0.0.1:7456`) was walked through every feature named here, screenshots kept local under `/tmp/dogfood/design-surface/`.

Owner decisions (ian, 2026-11-20) that override the first draft:

1. No phases: preview, comments, mark-up, versions, viewports, export and share ship together, and the file-type rule for the other file types ships with them.
2. Take Open Design's code, not a rewrite. Borrowed code lives in its own directories with `LICENSE`, `NOTICE.md` and one SPDX line per file, restyled with Cairn tokens and components.
3. The left side is the Coordinator conversation. The owner talks to the Coordinator; comments on a page are forwarded to the task whose agent built it.
4. Preview network: as Open Design does it (see Security).
5. Images open in the side panel through the borrowed image viewer; the image dialog goes.
6. Previews are served by Cairn itself, so a page keeps opening after the task that made it stops; no preview depends on a task's own dev server.

Tags: **verified** = read in source at the named commit or run live; **derived** = follows from verified facts; **guess** = the rest.

## Newcomer

Someone who installed Cairn today asks the Coordinator: `做一个定价页，三档套餐`. The task it starts finishes with a page; the Coordinator's chat shows a card with a thumbnail, `pricing.html` and `v1`. Clicking it opens the design view: the Coordinator conversation stays on the left, the page runs on the right at full size. Above the page they switch between desktop, tablet and phone widths, turn on `评论` and click any element to leave a note, turn on `标注` to draw boxes, strokes and text over the page, open `版本` to see every version and switch back to an older one, `导出` the page as HTML, PNG, PDF or ZIP, and `分享` a link that opens the page for anyone who can reach this Cairn. Notes are sent with their next message to the Coordinator, which hands them to the task that built the page; the task's next version shows on the right with the notes still pinned.

- Why it is there: today a task's page shows in a 380px frame inside a report dialog, a page with scripts is not previewed at all, and a code task that builds a page hands out its own dev-server link (`http://127.0.0.1:<port>/`) that stops opening when the task ends. Feedback on a page means describing the element in prose.
- What they must already know: how to talk to the Coordinator. Nothing about Open Design; it is not installed or shown.
- Accounts, payments, keys: none. Comments, marks, versions, export and share make no model call of their own; sending comments is one Coordinator message plus one task message, billed like any turn.
- Where it stores what they give: page versions are attachment files already stored by the Cairn server; comments, versions and share links are three tables in the server database; a mark-up is a PNG attachment. Nothing leaves the machine that runs the server, except the page itself when its own code loads fonts, images or scripts from the internet (Security), and a shared link when the owner gives it to someone.
- Where they get stuck: a page over 2 MiB (deliverables) or 10 MiB (attached by a code task) is not kept, so no card appears and the reply says it was skipped; a comment whose element is gone in a newer version is listed as `这一版没找到`; a failed save or send keeps the text and says it did not go through; a shared link only opens for people who can reach this Cairn server (same machine, the tailnet, or a remote-access URL).

## Why

Measured in the code (verified, this worktree):

- A page deliverable opens only inside `ResearchReportDialog` (`apps/web/src/chief/research-report.tsx`), where `MadeFiles` renders it in `PageFrame` at 380px (`apps/web/src/board/made-files.tsx`). `PageFrame` uses `sandbox=""` and a CSP without scripts, so a page with any script is not previewed.
- A code task has no way to publish a page: `attach_file` stores a `.html` as a `text/plain` chat attachment (`apps/server/src/services/agent-attachments.ts`), and `/api/attachments/:id` serves every attachment with `content-security-policy: sandbox; default-src 'none'` (`apps/server/src/routes-uploads.ts`), so the agent starts a dev server and replies with its port.
- An `.html` attachment opened from chat shows as source text (`TEXT_EXTS` in `apps/web/src/board/file-pane.ts`).
- Images open in two places: `FilePreviewPanel` or the `AttachmentPreview` dialog capped at 384px (`apps/web/src/overlay/attachment-preview.tsx`). The owner calls the dialog the small window that looks bad.
- No video player exists; Office files and logs leave the app for the system browser (`apps/desktop/src/main.ts` `setWindowOpenHandler`).

## The rule: file type to surface

Pick the surface by what the user does next:

- **Inline in chat**: glance. A card, chip or collapsed row, never a scrolling viewer.
- **Side panel** (`SidePanel` beside the chat, `FilePreviewPanel`): read. Every non-HTML type opens here through the borrowed Open Design viewer for its kind.
- **Design view** (Coordinator chat left, design right): iterate on a page.
- **External app**: a type Cairn cannot render; the viewer offers download and, on the Mac app, `用默认应用打开`.
- Never a modal dialog for content.

| Type | Inline | Click opens | Viewer (borrowed) |
|---|---|---|---|
| html (deliverable or attached by a task) | card: thumbnail, name, `vN`, open-comment count | design view | `HtmlPreview` with the comment, mark-up and snapshot bridges |
| md | chat markdown or card | side panel | `MarkdownViewer` (rendered, source toggle) |
| image (png, jpg, gif, webp, avif) | thumbnail chip | side panel | `ImageViewer` |
| svg | thumbnail chip | side panel | `SvgViewer` (preview, source) |
| video (mp4, webm, mov) | chip | side panel | `VideoViewer` |
| audio (mp3, wav, m4a) | chip | side panel | `AudioViewer` |
| pdf | chip | side panel | browser PDF frame (see Borrowed code, deviations) |
| docx, pptx, xlsx | chip with type and size | side panel | `DocumentPreviewViewer` over the server text extraction |
| text, code, json, log, diff | chip; tool output stays collapsed in the transcript | side panel | `TextViewer` with line numbers; diffs and code highlighted |
| other (zip, binary) | chip | side panel with download | `BinaryViewer` |

## Scope

1. **Preview**: a page runs in the design view at full size, scripts on, in Open Design's sandbox (Security). Pages come from two sources: deliverable pages of info tasks (today) and `.html` files any task attaches with `attach_file` (new). Both become versions.
2. **Served by Cairn**: every version has a stable Cairn URL; the design view, `在浏览器打开`, export and share all read it. The task's dev server is never linked. The worker prompt tells agents to attach a single self-contained `.html` and to put `data-od-id` on meaningful elements (Open Design's anchor contract) instead of handing out a dev-server URL.
3. **Comments**: comment mode, hover outline, click opens a popover naming the element with its size, colors and font (Open Design's inspect rows) and a note box; `保存` keeps it pending, `发送` sends it at once. Pending comments show as chips above the Coordinator composer and ride the next message. A comment list in the design pane shows every comment of the page with its pin, status and anchor state; open ones can be edited or deleted, any can be resolved or reopened.
4. **Mark-up**: mark mode draws boxes, strokes and text over the page (Open Design's `PreviewDrawOverlay`), with undo and redo; saving bakes the marks over a snapshot of the page into a PNG that becomes a comment with that image attached.
5. **Versions**: every published or attached page is a version; the list shows each with time and source; picking one shows it read-only; `切回这个版本` appends it as a new version; each can be downloaded.
6. **Viewports**: desktop (fills the pane), tablet 820x1180, phone 390x844, scaled to fit.
7. **Export**: HTML (the version file), ZIP (page plus Open Design's handoff and manifest files), PNG (snapshot of the page), PDF (the browser's print of the Cairn-served page).
8. **Share**: create a public link for one page; it always serves the page's current version; revoke turns it off. The link works for anyone who can reach the server.
9. **The file-type rule** above, with the image dialog and the report dialog's 380px frame removed.

## Layout

- Route: `/app?view=design&thread=<todoId>&file=<name>` (`THREAD_PARAM`, `VIEW_PARAM` in `apps/web/src/board/thread-copy.ts`). Back returns to the previous view.
- Left: the Coordinator conversation and composer as on the home page, at the docked width bounds. Pending comment chips sit above the composer.
- Right: a toolbar laid out like Open Design's (left: file picker when the task made several pages, reload, preview/source toggle, viewport menu; right: comment, mark-up, comment count, versions, export, share, `⋯` with open in browser and download), then the canvas.
- Below 1100px the halves become one pane with a `对话` / `设计` switch in the head; at 390px the toolbar keeps viewport, comment and versions and moves the rest into `⋯`.

## Scenarios

| Situation | What the user sees | What the system does | Wait and cost |
|---|---|---|---|
| A task finishes with `pricing.html` | Coordinator chat shows a card: thumbnail, `pricing.html`, `v1` | W1 or W1b inserts version 1 in the same transaction as the file | None |
| A code task attaches `index.html` | Same card | W1b inserts a version for the attachment | None |
| Clicks the card | Design view, page at full width, scripts running | R3 fetches the version, the client injects the bridges and renders it in a sandboxed `srcdoc` frame | One fetch, at most 10 MiB |
| Picks `手机` | Page at 390x844 centred, scaled if needed | Resizes the frame | Instant |
| Comment mode, clicks the Pro button | Popover: `button`, size, colors, font, note box, `保存` and `发送` | Bridge posts the target; nothing stored | Instant |
| Saves two comments | Two numbered pins; two chips above the composer; send reads `发送（含 2 条评论）` | W3 twice, status `open` | Instant |
| Sends | Their message in the Coordinator chat with both notes listed; the task's thread gets the notes with file, version, element and text | W6: one transaction stores the Coordinator message, delivers the comment block to the task, flips both rows to `sent`; then the Coordinator turn starts | One Coordinator turn and one task turn |
| Mark mode, draws a box, types a note, saves | A pin with a thumbnail of the marked page | W3 with the PNG uploaded first as a design attachment | One upload, under 5 MiB |
| Task publishes v2 | Card `v2`; the right side switches to v2 when the user is on the current version, else a `有新版本 v2` line | Version 2 inserted; pins re-located by `data-od-id`, then selector, text and position | None |
| A pinned element is gone in v2 | The comment shows `在 v1 上提的，这一版没找到` | Anchor resolution returns `lost`; nothing written | None |
| Opens `版本`, picks v1 | Read-only v1, banner `正在看 v1`, `切回这个版本` and `回到当前` | R3 for v1 | One fetch |
| Switches back to v1 | v3 appears, labelled `从 v1 恢复` | W2 appends a `restore` version | No model cost |
| Export PNG | A PNG download of what the frame shows | Snapshot bridge renders the page to a canvas | Under a second |
| Export PDF | The browser's print dialog for the page | Opens the Cairn-served page with `?print=1`; its injected script calls `print()` | None |
| Share | A link and `复制`; later `停止分享` | W7 creates or revokes a share row; R6 serves it | None |
| Someone opens a revoked or unknown link | `链接已失效` page | R6 answers 404 | None |
| The page loads a CDN font or script | It renders with it | No CSP network limit on the frame (Security) | Network fetches by the page |
| Server unreachable | Last loaded version stays; save or send says it did not go through and keeps the text | Writes fail | None |
| Task archived | Design view opens read-only; comment, mark-up, restore hidden | Writes refused with 409 | None |
| Old task from before this ships | Its page cards open with one version | W8 migration inserts versions from existing deliverables and html attachments | One-time migration |

## Borrowed code

Pinned at `nexu-io/open-design@07258801b9e4ae80553816bb1606af7aa9a63dff`, Apache-2.0 (root `LICENSE`; the repo ships no `NOTICE`). Cairn is Apache-2.0 too.

Web, `apps/web/src/vendor-open-design/` (with `LICENSE` and `NOTICE.md` naming every upstream path and "modified by Cairn"):

| Piece | Upstream | Change |
|---|---|---|
| Comment bridge | `apps/web/src/runtime/comment-bridge.ts`, `packages/contracts/src/runtime/annotated-selector.ts` | Accept `data-od-id`, `data-screen-label` and `data-cairn-id`; unannotated elements fall back to a structural selector (upstream ignores them); posts computed style for the inspect rows; pod and stroke modes dropped |
| Sandbox shim | `packages/contracts/src/runtime/preview-guards.ts` `buildPreviewSandboxShim` | As is: in-memory storage and history guards for the opaque-origin frame |
| Snapshot bridge | `apps/web/src/runtime/srcdoc.ts` `injectSnapshotBridge`, `apps/web/src/runtime/exports.ts` `requestPreviewSnapshot` | As is |
| Body-close injection | `srcdoc.ts` `injectBeforeBodyEnd` | Last real `</body>` search instead of the 890-line tokenizer |
| Anchor resolution | `apps/web/src/comments/anchor.ts` | Team identity and pod members dropped; the four states map to `anchored`, `moved` (`reanchored`, `stale`) and `lost` |
| Viewport presets | `apps/web/src/components/FileViewer.tsx` `PREVIEW_VIEWPORT_PRESETS` | As is |
| Mark-up overlay | `apps/web/src/components/PreviewDrawOverlay.tsx` | Box, pen and text tools, undo, redo and the bake; its dock UI replaced with Cairn components |
| ZIP writer, export helpers | `apps/web/src/runtime/zip.ts`, `exports.ts` (`exportAsZip`, `buildDesignHandoffContent`, `buildDesignManifestContent`, `downloadImageDataUrl`) | Desktop host paths dropped |
| File viewers | `FileViewer.tsx` `ImageViewer`, `SvgViewer`, `VideoViewer`, `AudioViewer`, `TextViewer` with `CodeWithLines`, `MarkdownViewer` (preview and source), `DocumentPreviewViewer`, `BinaryViewer`, `kindFor` from `apps/daemon/src/projects.ts` | One file per viewer; editing, collaboration and analytics dropped; toolbars use Cairn buttons |

Server, `apps/server/src/vendor-open-design/`: `document-preview.ts` from `apps/daemon/src/document-preview.ts` (docx, pptx, xlsx text extraction), reading the archive with Node's `zlib` instead of JSZip so the lockfile does not change.

Deviations, each decided here: PDF keeps the browser's own viewer in a frame (upstream extracts text with `pdftotext`, which a Mac does not have; the frame shows the real pages). The 20,759-line `FileViewer.tsx` is split per viewer and its `HtmlViewer` (12,000 lines of edit mode, decks, collaboration and live artifacts) is not taken; the design pane composes the borrowed bridges itself. Share uses a Cairn link instead of Open Design's cloud account.

Each borrowed file carries one line `// SPDX-License-Identifier: Apache-2.0. Modified by Cairn from nexu-io/open-design@07258801 <path>`; Apache-2.0 section 4(b) asks for it, so it is listed in `scripts/comment-discipline-allowlist.json` as a legal notice.

## Data model

This changes persisted state, the Coordinator message wire and adds a public route, so this is the one-page design CLAUDE.md asks for.

### Tables

`design_version`: one row per version of one page of one task.

| Column | Meaning |
|---|---|
| `id` | record id |
| `teamId`, `todoId` | owner; cascade on todo delete |
| `fileName` | page name |
| `seq` | 1, 2, 3 per (`todoId`, `fileName`); unique |
| `attachmentId` | the content: an `attachment` row (`deliverable`, `message` or a restore of either) |
| `sha256` | from the attachment; an identical digest makes no new version |
| `source` | `agent` or `restore` |
| `restoredFromVersionId` | `restore` only |
| `createdBy`, `createdAt` | step or user |

Current version = highest `seq`; there is no mutable pointer.

`design_comment`:

| Column | Meaning |
|---|---|
| `id`, `teamId`, `todoId`, `fileName` | owner and page |
| `versionId` | the version the user was looking at |
| `pin` | 1, 2, 3 per (`todoId`, `fileName`); never reused |
| `elementId`, `selector`, `label`, `text`, `htmlHint` | target from the bridge; `text` at most 160 chars, `htmlHint` 180 |
| `position`, `viewport` | rect when made (JSON) and the preset |
| `style` | inspect values (JSON) |
| `note` | at most 2000 chars |
| `markAttachmentId` | the baked mark-up PNG, mark comments only |
| `status` | `open`, `sent`, `resolved` |
| `messageId` | the Coordinator message that carried it |
| `createdBy`, `createdAt`, `updatedAt` | |

`design_share`: `id`, `teamId`, `todoId`, `fileName`, `token` (32 random bytes, base64url; unique), `createdBy`, `createdAt`, `revokedAt`. At most one live row per (`todoId`, `fileName`).

Mark-up PNGs are `attachment` rows with the new scope `design`, so the existing quota, garbage collection and route apply.

### States and transitions

Version: inserted, never updated; deleted only by the todo cascade.

Comment:

| From | Event | To |
|---|---|---|
| (none) | `保存` | `open` |
| (none) | `发送` in the popover | `sent` (W6 with this one comment) |
| `open` | sent with the next Coordinator message | `sent` |
| `open` | edit note | `open` |
| `open` | delete | row deleted |
| `open`, `sent` | resolve | `resolved` |
| `resolved` | reopen | `open` |

A `sent` comment cannot be deleted; the message that carried it is in the transcript. Agents never change comment status.

Share: (none) → live on create; live → revoked on stop; create on a page with a live row returns that row.

Anchor state (`anchored`, `moved`, `lost`) is computed on each render, never stored.

### Every path that reads or writes the state

| Path | Kind | Where | Behavior |
|---|---|---|---|
| W1 publish | versions | `publishDeliverables` (`apps/server/src/services/machine-deliverables.ts`) | Per accepted `page` item: insert `seq = max + 1` unless `sha256` equals the current version's; same transaction |
| W1b attach | version | `attachWorkerFile` (`apps/server/src/services/agent-attachments.ts`) | A `.html` attachment inserts a version with the W1 rule in the attachment's transaction |
| W2 restore | version | `POST /api/todos/:id/design/versions/:versionId/restore` | Appends a `restore` row on the old row's attachment; publishes the todo |
| W3 save comment | comment | `POST /api/todos/:id/design/comments` | Version must belong to the todo; a mark attachment must be the caller's `design` attachment; inserts `open` |
| W4 edit, resolve, reopen | comment | `PATCH /api/todos/:id/design/comments/:commentId` | Allowed transitions only, else 409 |
| W5 delete | comment | `DELETE /api/todos/:id/design/comments/:commentId` | `open` only, else 409 |
| W6 send | Coordinator message, task message, comments | the Coordinator send route (`POST /api/conversations/:id/messages`) with new optional `designCommentIds` | Loads the rows (same team, `open`, one todo), renders the comment block, stores the owner's Coordinator message with the block appended, delivers the block to the task thread the way `message_thread` does, flips rows to `sent` with `messageId`; one transaction inside the existing `clientMessageId` coalescing, so a retry sends once |
| W7 share | share row | `POST` and `DELETE /api/todos/:id/design/:fileName/share` | Create returns the live row or inserts one; delete sets `revokedAt` |
| W8 migration | versions | one Drizzle migration | For every deliverables message and `.html` message attachment, oldest first, insert versions with the W1 rule |
| R1 pages | read | `GET /api/todos/:id/design` | Pages with current version, version count, open comment count, live share token |
| R2 versions | read | `GET /api/todos/:id/design/:fileName/versions` | By `seq` descending |
| R3 page content | read | `GET /api/design/versions/:versionId/page` | The version's HTML with `content-security-policy: sandbox allow-scripts allow-forms allow-downloads`; `?print=1` adds `allow-modals` and a `print()` call; same auth as attachments |
| R4 comments | read | `GET /api/todos/:id/design/:fileName/comments` | All statuses |
| R5 document text | read | `GET /api/attachments/:id/document-preview` | Borrowed docx, pptx, xlsx extraction |
| R6 shared page | read, public | `GET /s/:token` | Live token: current version's HTML under the R3 CSP; else 404 page |
| R7 todo record | read | the todo deliverables join | Adds current `seq` per page for the card |

No other code reads or writes the three tables.

### Failure behavior

- W1, W1b insert fails: the surrounding transaction fails as it does today; nothing half-published.
- W2 on an archived todo or a foreign version: 409 or 404; the pane keeps the old view and says so.
- W3 to W5, W7 network failure: the pin, chip or link returns to its previous state with a toast; typed text stays.
- W6 failure: the Coordinator message, the task message and the status flips roll back together; chips and composer text stay. A comment already `sent` by a concurrent send makes the request 409 and the chips refresh. A task that refuses messages (pending question, archived) makes the request 409 with that reason.
- Attachment missing: the version row stays; the pane shows `这一版的文件已经不在了`, versions still usable.
- Bridge never answers: comment and mark modes say `这个页面不支持点选评论`; viewports and versions still work.

### Security

As Open Design does it: the page runs in an iframe with `sandbox="allow-scripts allow-forms allow-downloads"` (upstream's `HTML_PREVIEW_SANDBOX`) and no `allow-same-origin`, so it has an opaque origin: no Cairn cookies, storage or API access, no access to the Cairn window, no top navigation and no popups. There is no CSP on network: the page may load fonts, images and scripts from the internet, as the page would in any browser. Served URLs (R3, R6) carry the same sandbox as a `content-security-policy` header, so opening one directly in a tab is equally isolated (upstream does this for its raw routes); only the `?print=1` variant adds `allow-modals` so the page can open the print dialog. The parent accepts bridge messages only from the frame's own window and validates every field. R6 is a new unauthenticated route: it reads only a live token's current page, takes a constant-time lookup by unique token, and lists in the `externalEntryAuth` security surfaces; the change runs `/security-review`.

## Tests

User-visible only: W1 and W1b (a second page with new content makes v2, the same content makes none), W2 (restore makes v3), W3 to W5 (save, edit, delete; a sent comment refuses delete), W6 (send puts the notes in the Coordinator message and the task message, and a retried `clientMessageId` sends once), W7 and R6 (a shared link serves the current version with the sandbox header and stops after revoke), W8 (an old deliverables message yields v1), R5 (a docx yields its paragraphs).

## Out of scope

Edit mode (direct manipulation of the page), present mode, side-by-side version diff, comments on images, PDFs or slides, agent-set comment status, real-time multi-user comments, and running Open Design itself.
