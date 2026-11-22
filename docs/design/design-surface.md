# Design surface: preview, comment on, mark up, version, export and share the pages a task makes

Status: building (ian, 2026-11-20). Every phase is planned below with its scope and acceptance and is built in this lane, one after another; none is left for later. Borrow Open Design's implementation (Apache-2.0) consistently instead of keeping home-made halves; its file viewer covers the non-HTML file types. Prior art: [`open-design-2026-11-20.md`](../research/open-design-2026-11-20.md) (source read at `nexu-io/open-design@07258801b9e4ae80553816bb1606af7aa9a63dff`); the running pilot (`ghcr.io/nexu-io/od`, `127.0.0.1:7456`) was walked through every feature named here, screenshots kept local under `/tmp/dogfood/design-surface/`.

Owner decisions (ian, 2026-11-20) that override the first draft:

1. Phases are planned up front (all of them, each with scope and acceptance, see Phases) and executed one after another in the same lane; nothing is deferred.
2. Take Open Design's code, not a rewrite. Borrowed code lives in its own directories with `LICENSE`, `NOTICE.md` and one SPDX line per file, restyled with Cairn tokens and components.
3. The left side is the Coordinator conversation. The owner talks to the Coordinator; comments on a page are forwarded to the task whose agent built it.
4. Preview network: pages have network access (fonts, images, APIs), as in Open Design (see Security).
5. Finished files (images, video, docx, pdf, pptx, xlsx and every other non-HTML type) open in a floating lightbox over the app with a pager across the message's files, through the borrowed viewers; the side panel is only for the design view while a page is being iterated (ian, 2026-11-20, superseding the side-panel file view). Tiles show a type glyph with the conventional office accent and the first lines when they are cheap to read.
6. Previews are served by Cairn itself, so a page keeps opening after the task that made it stops; no preview depends on a task's own dev server.

Tags: **verified** = read in source at the named commit or run live; **derived** = follows from verified facts; **guess** = the rest.

## Newcomer

Someone who installed Cairn today asks the Coordinator: `做一个定价页，三档套餐`. The task it starts finishes with a page; the Coordinator's chat shows a card with a thumbnail, `pricing.html` and `v1`. Clicking it opens the design view: the Coordinator conversation stays on the left, the page runs on the right at full size. Above the page they switch between desktop, tablet and phone widths, turn on `评论` and click any element to leave a note, turn on `标注` to draw boxes, strokes and text over the page, open `版本` to see every version and switch back to an older one, `导出` the page as HTML, PNG, PDF or ZIP, and `分享` a link that opens the page for anyone who can reach this Cairn. Notes are sent with their next message to the Coordinator, which hands them to the task that built the page; the task's next version shows on the right with the notes still pinned.

- Why it is there: today a task's page shows in a 380px frame inside a report dialog, a page with scripts is not previewed at all, and a code task that builds a page hands out its own dev-server link (`http://127.0.0.1:<port>/`) that stops opening when the task ends. Feedback on a page means describing the element in prose.
- What they must already know: how to talk to the Coordinator. Nothing about Open Design; it is not installed or shown.
- Accounts, payments, keys: none. Comments, marks, versions, export and share make no model call of their own; sending comments is one Coordinator message plus one task message, billed like any turn.
- Where it stores what they give: page versions are attachment files already stored by the Cairn server; comments, versions and share links are three tables in the server database; a mark-up is a PNG attachment. Nothing leaves the machine that runs the server, except the page itself when its own code loads fonts, images or scripts from the internet (Security), and a shared link when the owner gives it to someone.
- Where they get stuck: a page over 2 MiB (deliverables) or 10 MiB (attached by a code task) is not kept, so no card appears and the reply says it was skipped; a comment whose element is gone in a newer version is listed as `这一版没找到`; a failed save or send keeps the text and says it did not go through; a share link needs a public address, which comes from the user's own relay ([remote-reach](remote-reach.md) phase 2a, a self-hosted VPS relay; a Cloudflare-managed one later); until a relay is configured, `分享` exports a self-contained HTML file instead and says that a link needs a relay.

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
- **Lightbox** (`FileLightbox`, full window over the app): read. Every non-HTML type opens here through the borrowed Open Design viewer for its kind, with a pager across the message's files.
- **Design view** (Coordinator chat left, design right): iterate on a page.
- **External app**: a type Cairn cannot render; the viewer offers download and, on the Mac app, `用默认应用打开`.

| Type | Inline | Click opens | Viewer (borrowed) |
|---|---|---|---|
| html (deliverable or attached by a task) | card: thumbnail, name, `vN`, open-comment count | design view | `HtmlPreview` with the comment, mark-up and snapshot bridges |
| md | chat markdown or card | lightbox | `MarkdownViewer` (rendered, source toggle) |
| image (png, jpg, gif, webp, avif) | thumbnail chip | lightbox | `ImageViewer` |
| svg | thumbnail chip | lightbox | `SvgViewer` (preview, source) |
| video (mp4, webm, mov) | chip | lightbox | `VideoViewer` |
| audio (mp3, wav, m4a) | chip | lightbox | `AudioViewer` |
| pdf | chip | lightbox | browser PDF frame (see Borrowed code, deviations) |
| docx, pptx, xlsx | chip with type and size | lightbox | `DocumentPreviewViewer` over the server text extraction |
| text, code, json, log, diff | chip; tool output stays collapsed in the transcript | lightbox | `TextViewer` with line numbers; diffs and code highlighted |
| other (zip, binary) | chip | lightbox with download | `BinaryViewer` |

## Scope

1. **Preview**: a page runs in the design view at full size, scripts on, in Open Design's sandbox (Security). Pages come from two sources: deliverable pages of info tasks (today) and `.html` files any task attaches with `attach_file` (new). Both become versions.
2. **Served by Cairn**: every version has a stable Cairn URL; the design view, `在浏览器打开`, export and share all read it. The task's dev server is never linked. The worker prompt tells agents to attach a single self-contained `.html` and to put `data-od-id` on meaningful elements (Open Design's anchor contract) instead of handing out a dev-server URL.
3. **Comments**: comment mode, hover outline, click opens a popover naming the element with its size, colors and font (Open Design's inspect rows) and a note box; `保存` keeps it pending, `发送` sends it at once. Pending comments show as chips above the Coordinator composer and ride the next message. A comment list in the design pane shows every comment of the page with its pin, status and anchor state; open ones can be edited or deleted, any can be resolved or reopened.
4. **Mark-up**: mark mode draws boxes, strokes and text over the page (Open Design's `PreviewDrawOverlay`), with undo and redo; saving bakes the marks over a snapshot of the page into a PNG that becomes a comment with that image attached.
5. **Versions**: every published or attached page is a version; the list shows each with time and source; picking one shows it read-only; `切回这个版本` appends it as a new version; each can be downloaded.
6. **Viewports**: desktop (fills the pane), tablet 820x1180, phone 390x844, scaled to fit.
7. **Export**: HTML (the version file), ZIP (page plus Open Design's handoff and manifest files), PNG (snapshot of the page), PDF (the browser's print of the Cairn-served page).
8. **Share**: with a relay configured, create a public link for one page, served through the relay at `<relay origin>/s/<token>`; it always serves the page's current version; revoke turns it off. Without a relay, `分享` downloads the page as one self-contained HTML file (the HTML export) and the popover says `生成链接需要先配置中继（远程访问）`, linking to the remote-access settings.
9. **The file-type rule** above, with the image dialog and the report dialog's 380px frame removed.

## Phases

Each phase lands on `main` on its own and ends in a check run on a `verify-cairn` live stack; the next starts when it is green.

| Phase | Scope | Acceptance |
|---|---|---|
| 1. Data and serving | Shared contract; the three tables and the W8 backfill; W1 and W1b; R1, R2, R3 (Cairn-served page, sandbox header, `?print=1`); R5 document text; the worker prompt line | Server tests for W1, W1b, W8, R3 header and R5; an attached `.html` from a finished task opens at its R3 URL after the task stops |
| 2. File viewer | The borrowed viewers (image, video, audio, SVG, text with JSON formatting, code with lines and diff colouring, Markdown, document text for docx/pptx/xlsx, PDF frame, binary) in `FileLightbox`, type-glyph tiles with first-line previews; the image dialog and the side-panel file view removed | Each sample type (md, png, pdf, mp4, diff, log, docx, pptx, xlsx) shows in the lightbox, light and dark, next to the Open Design screenshot of the same file; image before/after |
| 3. Design view | `view=design` with the Coordinator chat left; toolbar, page picker, reload, source toggle, viewports, versions list and restore (W2), open in browser; entry points from the task's page card and the attachment chip; the report dialog's 380px frame removed | A two-version page: v1 and v2 switch, restore makes v3, each viewport fits, compared with Open Design |
| 4. Comments | Comment bridge, hover outline, popover with inspect rows, save and send, chips above the composer, comment list with anchor state; W3 to W6 | Save, edit, delete, resolve; sending puts the notes in the Coordinator message and the task message once, live |
| 5. Mark-up | Draw overlay, undo and redo, snapshot bake into a `design` PNG, mark comment | A boxed and annotated mark shows as a comment with its PNG, and the task message carries it |
| 6. Export | HTML, ZIP with handoff and manifest, PNG snapshot, PDF through print | Each file downloads and opens |
| 7. Share | W7, R6, `shareOrigin` read from `CAIRN_RELAY_ORIGIN`, which the relay setup of [remote-reach](remote-reach.md) phase 2a writes (no relay exists yet, so it is `null` today); without a relay the HTML export plus the relay message | Without a relay: the file downloads and the message shows; with a relay origin set: the link serves the current version through it and stops after `停止分享` |

## Layout

- Route: `/app?view=design&thread=<todoId>&page=<name>` (`page`, not the file lightbox's `file`) (`THREAD_PARAM`, `VIEW_PARAM` in `apps/web/src/board/thread-copy.ts`). Back returns to the previous view.
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
| Share, relay configured | A relay link and `复制`; later `停止分享` | W7 creates or revokes a share row; the relay forwards `/s/:token` to R6 | None |
| Share, no relay | The HTML file downloads; the popover says a link needs a relay | Nothing stored | None |
| Someone opens a revoked or unknown link | `链接已失效` page | R6 answers 404 | None |
| The page loads a CDN font or script | It renders with it | The artifact CSP does not restrict fonts, scripts, images or API calls | Network fetches by the page |
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

Deviations, each decided here: PDF keeps the browser's own viewer in a frame (upstream extracts text with `pdftotext`, which a Mac does not have; the frame shows the real pages). The 20,759-line `FileViewer.tsx` is split per viewer and its `HtmlViewer` (12,000 lines of edit mode, decks, collaboration and live artifacts) is not taken; the design pane composes the borrowed bridges itself. Share uses a Cairn link through the user's own relay instead of Open Design's cloud account.

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
| W3b save mark image | attachment | `POST /api/todos/:id/design/marks` | Body is the baked PNG (base64, at most 5 MiB, PNG signature checked, team quota applies); inserts a `design` attachment owned by the caller |
| W4 edit, resolve, reopen | comment | `PATCH /api/todos/:id/design/comments/:commentId` | Allowed transitions only, else 409 |
| W5 delete | comment | `DELETE /api/todos/:id/design/comments/:commentId` | `open` only, else 409 |
| W6 send | Coordinator message, task message, comments | the Coordinator send route (`POST /api/conversations/:id/messages`) with new optional `designCommentIds` | Loads the rows (same team, `open`, one todo), renders the comment block, delivers it to the task thread with `messageThreadAsUser` as the Coordinator (client id `design:<clientMessageId>`), then in one transaction stores the owner's Coordinator message with the block and a `已转给任务` line appended and flips the rows to `sent` with `messageId`. Both steps coalesce on their client ids, so a retry after any failure sends each message once |
| W7 share | share row | `POST` and `DELETE /api/todos/:id/design/:fileName/share` | Create returns the live row or inserts one; delete sets `revokedAt` |
| W8 migration | versions | one Drizzle migration | For every deliverables message and `.html` message attachment, oldest first, insert versions with the W1 rule |
| R1 pages | read | `GET /api/todos/:id/design` | Pages with current version, version count, open comment count, live share token, and `shareOrigin`: the configured relay's public origin or `null` |
| R2 versions | read | `GET /api/todos/:id/design/:fileName/versions` | By `seq` descending |
| R3 page content | read | `GET /api/design/versions/:versionId/page` | The version's HTML with the sandbox, artifact policy and `frame-ancestors 'none'` in the CSP response header; `?print=1` adds `allow-modals` and a `print()` call; same auth as attachments |
| R4 comments | read | `GET /api/todos/:id/design/:fileName/comments` | All statuses |
| R5 document text | read | `GET /api/attachments/:id/document-preview` | Borrowed docx, pptx, xlsx extraction |
| R6 shared page | read, public | `GET /s/:token` (`apps/server/src/routes-design-share.ts`, a listed security surface) | Live token: current version's HTML under the R3 CSP; else 404 page |
| R7 todo record | read | the todo deliverables join | Adds current `seq` per page for the card |

Attachment garbage collection reads `design_version.attachmentId` and `design_comment.markAttachmentId` as references, so a version file or mark is never reaped while its row exists. No other code reads or writes the three tables.

### Failure behavior

- W1, W1b insert fails: the surrounding transaction fails as it does today; nothing half-published.
- W2 on an archived todo or a foreign version: 409 or 404; the pane keeps the old view and says so.
- W3 to W5, W7 network failure: the pin, chip or link returns to its previous state with a toast; typed text stays.
- W6 failure: a failed task delivery writes nothing; a failure after it leaves the task message delivered and the rows `open`, and the retry (same `clientMessageId`) replays the delivery and stores the Coordinator message once; chips and composer text stay until success. A comment already `sent` by a concurrent send makes the request 409 and the chips refresh. A task that refuses messages (pending question, archived) makes the request 409 with that reason.
- Attachment missing: the version row stays; the pane shows `这一版的文件已经不在了`, versions still usable.
- Bridge never answers: comment and mark modes say `这个页面不支持点选评论`; viewports and versions still work.

### Security

The page runs in an iframe with `sandbox="allow-scripts allow-forms allow-downloads"` (Open Design's `HTML_PREVIEW_SANDBOX`) and no `allow-same-origin`. Its opaque origin prevents direct access to the Cairn window, cookies and storage; the sandbox also denies top navigation and popups. The preview inserts a CSP meta tag before artifact content with `base-uri 'none'; object-src 'none'`. These directives deny replacement base URLs and loads via `object` or `embed` without changing the approved access to fonts, images, scripts and APIs (owner decision 4).

Served URLs (R3, R6) send the same artifact policy, the sandbox and `frame-ancestors 'none'` as a `Content-Security-Policy` response header. They can open directly but cannot be framed; the board still fetches the source and builds its own sandboxed `srcdoc`. Only the `?print=1` variant adds `allow-modals` so the page can open the print dialog. HTML and ZIP downloads keep the original artifact source.

The parent accepts bridge messages only from the frame's own window and validates every field. R6 is unauthenticated, serves only a live token's current page, and is listed in the `externalEntryAuth` security surfaces.

## Tests

User-visible only: W1 and W1b (a second page with new content makes v2, the same content makes none), W2 (restore makes v3), W3 to W5 (save, edit, delete; a sent comment refuses delete), W6 (send puts the notes in the Coordinator message and the task message, and a retried `clientMessageId` sends once), W7 and R6 (a shared link serves the current version with the sandbox header and stops after revoke), W8 (an old deliverables message yields v1), R5 (a docx yields its paragraphs).

## Out of scope

Edit mode (direct manipulation of the page), present mode, side-by-side version diff, comments on images, PDFs or slides, agent-set comment status, real-time multi-user comments, and running Open Design itself.
