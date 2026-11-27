# Artifact panel: every file a task makes opens beside the chat, versioned and commentable

Status: building (ian approved the `artifact-kinds-3` prototype on 2026-11-24, with two corrections listed below). This extends [design-surface.md](design-surface.md): its tables, routes and send path stay the one implementation; this file names what changes. Prior art: [`open-design-2026-11-20.md`](../research/open-design-2026-11-20.md) §1.2 (comment capture, `data-od-id` anchors, four-state drift ladder, comment attachments with a hard-scope instruction) and the claude.ai walk of 2026-11-24 (artifact cards, a tabbed side panel, per-kind toolbars, comment mode as a toolbar toggle).

Owner decisions (ian, 2026-11-24):

1. Build the prototype: chat on the left, one panel on the right with a tab per opened artifact, a per-kind toolbar, version history and export.
2. `评论` is one toggle button showing the open count (`评论 2`); turning it on also opens the comment list beside the artifact. No split button, no separate chevron.
3. Images and video show inline in chat at prose width (image fit; video with poster and play, playing inline). Clicking opens the item in the artifact panel at fit size with zoom (images) or the full player (video). No lightbox.

## Newcomer

Someone who installed Cairn today asks the Coordinator `把 resume 里的简历导出成 PDF 给我`. The task compiles the PDF and attaches it; the Coordinator's reply shows a card `林舟 简历 · 文件 · PDF · 2 页`. Clicking it opens the panel on the right with the PDF at page width. They press `评论`, drag a box around a paragraph, type `把这段经历挪到前面`, and `保存`; the list beside the PDF shows it as `待处理`. `发给 Coordinator (1)` sends it: a compact bubble `批注 1 条 · 林舟 简历 第 1 版` appears in chat, the comment turns `处理中`, the Coordinator hands it to the task, the task attaches the new PDF, a second card `第 2 版` appears, and the comment turns `已改` with its pin on the moved paragraph. If the paragraph no longer exists in version 2 the comment says `已失效` and offers `重新指位置`.

- Why it is there: today an HTML page opens in a design view, an image or video in a floating lightbox, a document in a side panel, and nothing else can be commented on. A PDF, slide deck, sheet or whiteboard has no way to say "this part, change it" except prose.
- What they must already know: how to talk to the Coordinator.
- Accounts, payments, keys: none. Comments make no model call; sending them is one Coordinator turn and one task turn.
- Where it stores what they give: files stay attachment rows; versions and comments are the existing `design_version` and `design_comment` tables on the Cairn server; a whiteboard the user edits by hand is saved as a new attachment and version.
- Where they get stuck: a file over the attachment cap (10 MiB) is not kept and the reply says so; a type Cairn cannot render opens a file row with download; a comment whose spot is gone in the new version shows `已失效`; a failed save or send keeps the text and says it did not go through.

## Kinds

Kind follows the file name (`artifactKindOf` in `packages/shared/src/records/artifact.ts`), one table, one place:

| Kind | Files | Viewer | Toolbar (left to right after the name) | Comment target |
|---|---|---|---|---|
| document | md | rendered Markdown, mermaid fences drawn | preview / source | element (block with generated `data-cairn-id`) |
| page | html | sandboxed frame (design-surface bridges) | preview / source, viewport | element (`data-od-id`, then selector) |
| slides | html whose root is `<html data-slides>`, one `<section class="slide">` per slide (`apps/web/src/board/artifact/slide-deck.ts`) | one 1920×1080 slide, the shared deck pager, present ([`html-slides-viewer.md`](html-slides-viewer.md)) | pager, present | element inside the slide, plus slide index |
| design | svg | fit, zoom | preview / source, zoom | element (svg `id` / `data-cairn-id`) or region |
| diagram | mmd | mermaid render | preview / source | element (node id) |
| whiteboard | excalidraw | Excalidraw (read-only until `编辑`) | edit toggle | shape ids, or region |
| code | py, ts, js, go, … | lines with Shiki colours | copy | line range |
| sheet | csv, tsv | table with header row | preview / source | cell range |
| pdf | pdf | pdf.js pages with text layer | page count, fit width / fit page / 100% | region on a page |
| docx | docx | docx-preview paginated | fit | region on a page |
| image | png, jpg, gif, webp, avif | fit, zoom | zoom | region |
| video | mp4, webm, mov | player | none | timestamp |
| other | anything else | file row with download | none | none |

Libraries (all lazy chunks loaded on first open of that kind; bundle sizes reported in the landing wrap-up): `pdfjs-dist`, `docx-preview`, `papaparse`, `mermaid`, `@excalidraw/excalidraw`. Each is the established library for its format; none is hand-written.

## Data model changes

This changes persisted state and the Coordinator message wire, so this section is the one-page design AGENTS.md asks for.

### Tables

`design_version` (unchanged columns): now versions every artifact kind, not only html. `source` gains `user` (a whiteboard saved from the panel).

`design_comment`, two new nullable columns (migration `0252_artifact_comments`):

| Column | Meaning |
|---|---|
| `anchor` | JSON, kind-specific target for non-DOM kinds: `{type:'region', page?, rect}` (rect normalized 0..1 to the page, slide or image), `{type:'lines', from, to}`, `{type:'cells', r1, c1, r2, c2}`, `{type:'time', seconds}`, `{type:'shapes', ids}`, plus `slide` for an element inside a slide. `null` for an element comment, which keeps using `elementId`, `selector`, `text`, `htmlHint`, `position` |
| `sentAt` | when the comment went to the Coordinator; `null` while `open` |

`selector` may be empty when `anchor` is set (the target is the anchor).

### Comment states

Stored `status` stays `open` / `sent` / `resolved` with the design-surface transitions. What the user sees is derived, one selector (`artifactCommentState` in `packages/shared/src/records/artifact.ts`):

| Shown | Rule |
|---|---|
| Pending | `open` |
| In progress | `sent` and no version of the file is newer than `sentAt` |
| Changed | `resolved`, or `sent` with a newer version where the anchor resolves |
| Stale | `sent` with a newer version where the anchor does not resolve |

"Newer version" is a server-computed field on the record, `handledSeq`: the first version `seq` created after `sentAt`, or `null`. Anchor resolution runs in the browser on the version being viewed (design-surface's ladder for elements; text search for regions on PDF/DOCX; line text for code; header and row key for cells; shape id for whiteboards; image and video regions always resolve). `重新指位置` on an `已失效` comment moves its anchor to a new spot and reopens it (`PATCH` with a new target, status back to `open`, `sentAt` cleared).

### Paths that read or write

| Path | Change |
|---|---|
| W1 publish, W1b attach | `recordDesignVersion` takes every artifact kind (`isArtifactName`), not only html |
| W3 save comment | body takes `anchor`; anchor kind must fit the file kind, else 400 |
| W4 patch | adds `retarget` (new target + anchor) allowed from `sent` or `resolved`, sets `open` and clears `sentAt` |
| W6 send | sets `sentAt`; the Coordinator message is the user's text (may be empty) plus the compact summary `批注 N 条 · <file> 第 v 版` with one `① note` / `「quote」` pair per comment (`renderArtifactCommentSummary`), which the chat shows as the user bubble; the task message keeps the full block with targets, rendered per anchor type (`第 2 页的选区` / `第 12–14 行` / `B3:D5` / `0:42`). No new message wire field |
| W8b migration | backfills versions for existing non-html deliverables and task attachments, oldest first, W1 rule |
| attach_file | also takes DOCX/XLSX/PPTX (zip magic), MP4/MOV (ftyp) and WebM (EBML), extension and bytes must agree; the attachment-key extension pattern grows to 10 characters (`excalidraw`) in one shared source, `ATTACHMENT_KEY_SOURCE`, which GC, chat parsing and token parsing all read |
| W9 save whiteboard | `POST /api/todos/:id/design/:fileName/versions` with the edited scene JSON (at most 10 MiB, must parse as an Excalidraw scene); writes an attachment and a `user` version in one transaction |
| R1 pages | lists every artifact of the task with `kind` |
| R4 comments | adds `anchor`, `sentAt`, `handledSeq` |
| R8 artifact of attachment | `GET /api/attachments/:id/artifact` → `{ todoId, fileName, kind, versionSeq, versionCount, openComments }` or 404; the chat card reads it |

Nothing else reads or writes these columns. Agents never change comment status.

### Failure behavior

- W3, W4, W9 network failure: the pin, edit or drawing stays, a toast says it did not save, the text is kept.
- W6 failure: as design-surface (retry with the same client message id sends once); the batch button stays enabled with its count.
- A version file missing: the tab says `这一版的文件已经不在了`; history still lists it.
- A viewer library fails to load (offline chunk): the tab shows the file row with download and `这个文件暂时打不开`.
- Anchor cannot be resolved on an older version being viewed: the pin is hidden, the list row stays.

## Layout

- Route: `?artifact=<attachmentId>` opens the panel on that file (the tab list is client state, restored per Coordinator thread from session storage). Replaces `view=design&page=` and the lightbox's `file=`; old links redirect.
- At 1100px and wider: chat column `clamp(440px, 46%, 760px)`, panel the rest; the sidebar collapses while the panel is open. Narrower: the panel covers the chat with a back control.
- Panel head: tabs (kind icon + name, close on hover and on the active tab, overflow menu), then `新开` is not offered (Cairn has no blank artifacts), full screen, close.
- Toolbar: name with `· EXT` and a menu (rename is not offered; copy link, download, open in browser where it applies), kind controls, `评论 N` toggle, history, export.
- Comment mode: a tinted strip `点一个元素加批注，或按住拖出一块区域` with `Esc 退出`; the list column on the right (`全部 / 未改 / 已改`), and `发给 Coordinator (N)` at its foot when N open comments exist.

## Tests

User-visible only: a PDF attached twice makes v1 and v2 (W1b); a region comment on a PDF saves with its anchor (W3); sending marks `sentAt` and the Coordinator message carries the compact summary (W6); a new version after sending makes `handledSeq` (R4); retarget reopens (W4); a whiteboard save makes a `user` version (W9); the backfill gives an old PDF one version (W8b). Web: clicking a chat card opens the panel tab; `评论` shows its count and opens the list; an image in chat opens in the panel; a stale comment shows `已失效`.
