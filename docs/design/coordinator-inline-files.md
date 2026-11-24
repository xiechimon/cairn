# Coordinator Inline File Staging & `attach_file`

**Date**: 2026-11-24
**Prior art**: `docs/research/personal-agents-inline-actions-2026-11-24.md` (on branch `agents-research` @ `727764467`), [`docs/research/per-command-confinement-2026-11-24.md`](../research/per-command-confinement-2026-11-24.md)

## Newcomer View

- **Where they meet it and why**: In the main Cairn Coordinator chat right after installing Cairn, the owner drops a file (such as a resume PDF) and asks *"export this as images and send them to me"*. The Coordinator converts it directly on the owner's computer in the same turn and replies with inline PNG previews, instead of creating a tracked coding task and worktree.
- **What they must already know**: Nothing beyond dropping a file in chat and asking in plain language.
- **Accounts, payments, and keys asked of them**: None beyond their already-configured model provider and the Cairn desktop/daemon already connected on their Mac.
- **Where their files are stored**:
  - Uploaded files live in Cairn's team attachment store (`<CAIRN_HOME>/attachments/<teamId>/<id>.<ext>`) and are staged on the owner's computer under the OS temp dir (`<os.tmpdir()>/cairn-uploads-<uid>/<safeThreadId>/<attachmentId>-<safeFileName>`, mode `0700` dirs / `0600` files).
  - Returned files from `attach_file` are saved in the same team attachment store and referenced in `chief_message` as `![caption](attachment:<teamId>/<id>.<ext>)`.
- **Where they get stuck / what they see when it fails**: If their Mac is offline, a file is missing, or the output exceeds 10 MiB, the Coordinator gets a plain failure reason from the tool and explains it directly in chat (no silent hang, no partial attachment row).

## Why

Prior art across 10 open-source personal agents (`personal-agents-inline-actions-2026-11-24.md`) showed 10/10 handle quick file conversions inline in the main chat turn rather than spawning a task/worktree. Cairn already has `user_computer_shell` and inline image rendering (`AttachmentChip`), but lacked (1) staging inbound uploads onto the owner's computer with a local path, (2) a Coordinator `attach_file` path back to chat, and (3) open non-credential confinement on the owner's computer.

## Scenario Table

| User Situation | What the User Sees | What Cairn Does | Wait & Cost |
|---|---|---|---|
| Drops `resume.pdf` in chat: *"export this as images and send them to me"* (Mac online) | Existing tool-call rows + inline PNG image(s) in the Coordinator reply, clickable to open lightbox. | Stages `resume.pdf` to `<tmpdir>/cairn-uploads-<uid>/<threadId>/<id>-resume.pdf`; Coordinator runs `user_computer_shell` to export PNGs and calls `attach_file` per PNG; server validates & writes attachment + appends `![name](attachment:<key>)` to the reply. | ~5–20 s; 1 turn, 0 runner/worktree startup. |
| Drops a file while their Mac is offline | Plain-language reply saying the Mac is not connected, so conversion / file attachment cannot run now. | Staging notes Mac offline in turn context; `user_computer_shell` and `attach_file` return `OWN_COMPUTER_NO_MAC`. | ~2 s; 1 turn. |
| Generated output file is missing or > 10 MiB | Plain-language failure explaining file not found or exceeds 10 MiB limit. | Daemon `handleAttachFile` checks existence, regular file, `0 < size <= 10 MiB`, refuses before upload; no orphan DB row. | Immediate tool error. |
| Prompt injection tries `attach_file({ path: "~/.ssh/id_ed25519" })` | Refused (`path is inside a protected directory`); no bytes leave the Mac. | Daemon checks `confinement.denied()` on both requested and `realpathSync` target + `O_NOFOLLOW` + inode verification before reading. | Immediate refusal. |
| Asks to edit a repo / open a PR | Normal task card (`open_thread`), unchanged. | Coordinator delegates repo/long work to a task thread. | Minutes (unchanged). |

---

## State, Wire Protocol & Tool Contract

### 1. Inbound Upload Staging (`stage_attachment` internal computer call)

- **Location on owner's computer**: `<stagingRoot>/<safeThreadId>/<safeAttachmentId>-<safeFileName>`, where `<stagingRoot> = join(realpathSync(os.tmpdir()), 'cairn-uploads-<uid>')`.
  - `<safeThreadId>` and `<safeAttachmentId>`: validated against `/^[A-Za-z0-9_-]{1,128}$/` (hashed fallback if ever outside).
  - `<safeFileName>`: `basename` with path separators, NUL, and control/format chars stripped; defaults to `attachment.<ext>` if empty or `.`/`..`.
  - Directory mode `0o700`, file mode `0o600`, written atomically (`O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW` temp file + `rename`).
- **Who writes it**: The owner's connected local daemon (`apps/daemon/src/computer/staging.ts`), triggered by the server when a Coordinator turn's prompt contains `attachment:<teamId>/<id>.<ext>` tokens and `ownComputerTarget(deps, threadRow, 'user_computer_shell')` resolves to an online local Mac.
  - Server pushes a `ComputerCall` (`tool: 'stage_attachment'`, `params: { threadId, attachmentId, fileName }`, 30 s deadline) over `MachineWakeHub.pushComputer`.
  - Daemon fetches raw binary bytes via `GET /api/machine/computer/:callId/attachment` (authenticated by machine bearer token; server authorizes strictly against the live `computer_call` row owned by that machine and the `attachment` row's `teamId` + `status = 'ready'`).
  - Daemon writes the staged file and finishes the call with `done` `{ text: JSON.stringify({ path, sizeBytes }) }`.
  - Server appends a `<staged_uploads>` note to the Coordinator turn context naming each staged file's name, MIME, size, and local path (or a plain note if Mac is offline or staging failed).
  - On Linux `bwrap`, `host-shell-confinement.ts` bind-mounts `<stagingRoot>` (`--bind <stagingRoot> <stagingRoot>`) after `--tmpfs /tmp` when `<stagingRoot>` exists under `/tmp` or `/var/tmp`, so `user_computer_shell` can read staged uploads and write outputs there.
- **Who cleans it**:
  - Daemon sweeps `<stagingRoot>` on startup and every 24 h (`sweepStagedUploads`, removing per-thread directories with mtime older than 72 h, matching `STEP_ATTACHMENTS_TTL_MS`).
  - OS temp cleanup also reaps `<os.tmpdir()>` on reboot.

### 2. Outbound `attach_file` Tool Contract

- **Offer condition**: `when_owner_thread_and_team_has_mac` — identical to `user_computer_shell` (owner thread + team has a local machine with `capabilities.ownComputerShell === true`). Offered in `coordinatorToolDefs({ ownComputer: true })` and routed through `isCoordinatorComputerTool`.
- **Parameters**:
  - `path` (string, required, 1–4096 chars, no NUL): absolute or `~/`-prefixed path on the owner's computer (may be in `<tmpdir>`, `$HOME`, or any non-denied location).
  - `caption` (string, optional, max 2000 chars): display name/label for the attachment token; defaults to the file basename.
- **Limits & MIME**:
  - Size cap: `1 <= sizeBytes <= ATTACHMENT_MAX_BYTES` (`10 MiB`).
  - Allowed types & content verification: reuses `attachmentMime(fileName, bytes)` + `validateAttachmentUpload()` + `writeAttachmentFile()` from `apps/server/src/services/agent-attachments.ts` and `attachments.ts` (PNG, JPEG, GIF, WebP, PDF verified by magic bytes; UTF-8 text/JSON/XML verified for encoding & syntax; plus allowed office/archive/media types in `ATTACHMENT_TYPES` when magic bytes do not contradict extension? Single path: reuse `attachmentMime` for images/PDF/text/JSON/XML, and allow `ATTACHMENT_TYPES` download extensions like `zip`/`docx`/`xlsx`/`pptx` via `resolveAttachmentMime` only when not an image/PDF/text mismatch — actually keeping `attachmentMime` exact for image/PDF/JSON/XML/UTF-8 text matches worker `attach_file` with zero drift, and explicitly rejects spoofed extensions or binary control bytes!).
- **Wire & storage flow**:
  1. Server checks claimed `chief` step, `refuseRestrictedTurnTool` (blocks untrusted mail/report turns), `ownComputerTarget(deps, threadRow, 'user_computer_shell')` (owner check + connected local Mac).
  2. Server validates `path` and `caption`, creates `computer_call` (`tool: 'attach_file'`, `replaySafe: false`), pushes `ComputerCall` to the Mac daemon.
  3. Daemon (`handleAttachFile`) expands `~`, resolves `realpathSync`, verifies `!confinement.denied(requested)` and `!confinement.denied(resolved)`, opens with `O_RDONLY | O_NOFOLLOW | O_NONBLOCK`, verifies `fstat` regular file + matching `dev`/`ino` + `!confinement.denied(openedPath)` + `0 < size <= 10 MiB`, reads exact bytes, and uploads raw binary to `POST /api/machine/computer/:callId/attachment` (headers `x-cairn-filename`, optional `x-cairn-caption`, body limit `ATTACHMENT_MAX_BYTES + 64 KiB`).
  4. Server route validates machine auth + live `computer_call` (`tool === 'attach_file'`, `state IN ('dispatched', 'running')`, `step.status === 'claimed'`), runs `attachCoordinatorFile(deps, stepRow, threadRow, { fileName, caption, bytes })`:
     - Calls `attachmentMime` + `validateAttachmentUpload` + `writeAttachmentFile`.
     - In one DB transaction: inserts `attachment` row (`status: 'ready'`, `scope: 'message'`, `todoId: null`, `createdBy: 'step:<stepId>'`) and upserts `chief_message` row `id = attachment-output-<stepId>` (`role: 'assistant'`, content `![caption](attachment:<key>)` appended with `\n` for multiple attachments), then publishes via `convHub.publishMessage`. On DB error, unlinks the written file.
     - Returns `{ id, key, token, sha256 }` to daemon.
  5. Daemon sends `done` frame with `JSON.stringify({ id, key, token, sha256 })`.
  6. Coordinator receives tool result; web UI renders the existing tool-call pill (`attach_file <path>`) and inline image/chip from `chief_message` via existing `ChatMarkdown` + `AttachmentChip`.

### 3. All Read / Write Paths

| Path | Reader / Writer | Persisted State Touched |
|---|---|---|
| `POST /api/uploads/grant` + `POST /api/uploads/upload` | Web composer -> Server | Writes `attachment` row + file in `attachmentsDir` |
| `stageTurnAttachments()` (`coordinator/index.ts`, `machine-claim.ts`) | Server -> Mac daemon | Creates `computer_call` (`stage_attachment`); writes `<tmpdir>/cairn-uploads-<uid>/<threadId>/<id>-<name>` |
| `GET /api/machine/computer/:callId/attachment` | Mac daemon <- Server | Reads `computer_call` + `attachment` + file from `attachmentsDir` |
| `sweepStagedUploads()` (`apps/daemon/src/machine-loop.ts`) | Mac daemon | Deletes expired `<tmpdir>/cairn-uploads-<uid>/<threadId>` dirs (> 72 h) |
| `attach_file` tool (`machine-relay.ts` -> `machine-computer.ts` -> `dispatch.ts`) | Coordinator -> Server -> Mac daemon | Creates `computer_call` (`attach_file`); reads file on Mac |
| `POST /api/machine/computer/:callId/attachment` -> `attachCoordinatorFile()` | Mac daemon -> Server | Writes file in `attachmentsDir`, inserts `attachment` row, upserts `chief_message` (`attachment-output-<stepId>`) |
| `GET /api/attachments/:id` | Web UI <- Server | Reads `attachment` row + file from `attachmentsDir` (`inline` for images/PDF) |
| `sweepAttachmentBatches()` (`attachment-gc.ts`) | Server GC | Reads `chief_message` to retain referenced attachments |

### 4. Failure Modes & One Test Per Path

| # | Path / Failure Mode | Expected Behavior | Test |
|---|---|---|---|
| 1 | Happy path: stage uploaded PDF on Mac | Written to `<tmpdir>/cairn-uploads-<uid>/<threadId>/<id>-<name>` (`0700`/`0600`), staged path injected in turn context | `coordinator-inline-files.test.ts` (staging happy path) |
| 2 | Happy path: `attach_file` PNG on Mac -> chat reply | Attachment row created, file stored, `chief_message` updated with `![caption](attachment:<key>)`, returns `{ id, key, token, sha256 }` | `coordinator-inline-files.test.ts` (attach_file happy path) |
| 3 | Multi-file `attach_file` in same turn | Both tokens appended on separate lines in `attachment-output-<stepId>` | `coordinator-inline-files.test.ts` (multi-file append) |
| 4 | Machine offline during staging or `attach_file` | Staging adds offline note (turn continues); `attach_file` returns plain `OWN_COMPUTER_NO_MAC` refusal | `coordinator-inline-files.test.ts` (machine offline) |
| 5 | Non-owner thread calls `attach_file` / staging | Refused (`OWN_COMPUTER_NOT_OWNER`), never reaches daemon | `coordinator-inline-files.test.ts` (non-owner refusal) |
| 6 | Untrusted (mail) turn calls `attach_file` | Refused with 403 (`mail turn cannot call attach_file`) | `coordinator-inline-files.test.ts` (untrusted turn refusal) |
| 7 | File missing on Mac | Daemon refuses with `file not found` (`delivery: 'not_delivered'`); no DB row | `computer-attach-file.test.ts` (missing file) |
| 8 | Path is directory / symlink to denied credential path | Daemon refuses (`path is not a regular file` / `path is inside a protected directory`) before reading | `computer-attach-file.test.ts` (directory + credential symlink) |
| 9 | File empty or > 10 MiB (`ATTACHMENT_MAX_BYTES`) | Daemon refuses (`file is empty` / `file exceeds the 10 MiB attachment limit`) before upload | `computer-attach-file.test.ts` (size cap) |
| 10 | Unsupported extension or magic-byte MIME mismatch | Server rejects with 400 (`attach_file content does not match...` / `file extension not allowed`); daemon surfaces error; no DB row or stray file | `coordinator-inline-files.test.ts` (MIME mismatch) |
| 11 | Upload HTTP failure (5xx / network error / call expired) | Daemon finishes call with error frame (`delivery: 'unknown'`); server rolls back any partial file; Coordinator receives plain failure line | `computer-attach-file.test.ts` (upload fails) |
| 12 | Staged upload cleanup (`sweepStagedUploads`) & filename sanitization | Strips parent-traversal path segments to a safe filename; removes dirs older than TTL while keeping fresh ones | `computer-attach-file.test.ts` (staging sanitization + TTL sweep) |
| 13 | Coordinator reading installed skills (`skills(skillId, path)`) | Always core-loaded; reads `SKILL.md` and sibling reference files from `skillsDir` via `resolveLocalSkill` + `readSkillFile`, rejecting missing skills and `..`/symlink traversal with 404 | `coordinator-inline-files.test.ts` (skills core-loaded + read + traversal) |
