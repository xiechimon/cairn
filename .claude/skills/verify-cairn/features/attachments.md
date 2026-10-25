# Attachments (composer + new task, #310/#331)

Users attach files in the composer or the new-task dialog: click the toolbar `添加附件` button (`button[aria-label="添加附件"]`, a native multi-file trigger) -> pick files -> upload -> an attachment token is injected into the text (`![名](attachment:attachments/{teamId}/{id}.{ext})`) and goes with the message / task spec; the executing agent can read the attachment content. Spec source: r9 §3.1/§4 (todos.dev measured wire, three steps).

## Sub-features

- `attachment-button` the composer / new-task toolbar `添加附件` button (`button[aria-label="添加附件"]` + Paperclip icon) = a native `<input type=file multiple>` trigger.
- `attachment-upload-wire` file picked -> three-step upload (r9 §4): `POST /api/uploads/grant` (get the upload credential) -> a separate upload host (FormData PUT) -> returns the attachment id.
- `attachment-token-inject` after a successful upload the token `![名](attachment:attachments/{teamId}/{id}.{ext})` is injected into the composer draft / new-task spec (controlled state, the parent component's setDraft/setSpec).
- `attachment-submit` the token goes with the message / task spec and lands in the conversation message content / todo.spec.
- `attachment-executable` the executing agent can read attachments (the daemon-side attachment tool enters the worker vocabulary, remoteTools).
- `attachment-dirty-gate` after an attachment token is injected into the spec, the spec being non-empty carries the unsaved-gate dirty bit (#318 gate, wired by #310).

## How to get to it (user POV)

- The detail-page composer toolbar `添加附件` button (run / confirm surfaces).
- The new-task dialog toolbar `添加附件` button (lands in the spec textarea).
- Driving (`vp.mjs list attachments` lists all cases and usage):
  - `node .claude/skills/verify-cairn/scripts/vp.mjs drive attachments new-task-and-composer-upload`: upload an attachment in the new-task dialog; pass a todoId after `--` to add the composer path.
  - Cases judged stale and refusing to run without `--force` (the refusal prints the reason): `vp.mjs drive attachments clipboard-paste` (its dependency setup-review-seed.mjs creates the agent without machineId, 400 since ADR 0019).

## Driving it with verify-cairn

Preconditions:

1. `launch.mjs` brings the isolated stack up, `doctor.mjs` fully PASS.
2. Attachment upload needs the server's upload host reachable (grant -> upload -> token); live surface.
3. Execution-surface reading needs a daemon + worker step (the attachment tool is in the remoteTools vocabulary).

- **How to run.** `node <skill>/scripts/drive-attachments.mjs` runs only the new-task-dialog path (self-sufficient, no daemon/seed needed); `node <skill>/scripts/drive-attachments.mjs <todoId>` additionally runs the composer path (the todo must be in a composer-editable phase, the seed comes from `setup-review-seed.mjs`). Sample files are written into the evidence directory and archived with the PR, so the original bytes are available for comparison.
- **Clipboard-paste path (#729).** `node <skill>/scripts/drive-paste.mjs <todoId>` (todoId = a confirm-phase task produced by `setup-review-seed.mjs`): the canvas generates a real 24x24 PNG -> synthesizes a ClipboardEvent and pastes it into the detail composer (mid-caret line, line-break insertion + caret lands at the head of the line after the block) -> Enter = revision send -> the transcript thumbnail chip loads its pixels; then paste into the new-task dialog -> save -> the spec card chip; finally a real-keyboard probe (clipboard-write permission + ClipboardItem + Meta+V/Ctrl+V, the verdict is recorded in result.json, not hard-asserted). 14 checks: wire capture (grant 200 / upload 201 / revision 202) + two SQLite rows (message/spec two scopes, status=ready) + on-disk bytes === sample + readback consistent. Evidence precedent `docs/verify/729/`. Note: the synthesized paste name `pasted-image-<n>` increments per draft — the probe's path B must run before the real-keyboard path, otherwise the counter gets bumped (designed behavior, not a regression).
- **Upload path.** composer / new-task -> click `button[aria-label="添加附件"]` -> file selection (playwright `setInputFiles`) -> wait for the upload -> the draft/spec shows the `![名](attachment:...)` token.
- **Truth.** `POST /api/uploads/grant` returns the upload URL; upload host PUT 200; after submitting, the message content / todo.spec contains the attachment token; the SQLite attachment table has a row (#310 migration 0008); the on-disk `<attachmentsDir>/<storageKey>` bytes equal the uploaded sample; `GET /api/attachments/:id` reads back consistently. **Not covered**: the daemon execution surface reading attachments (the worker-step attachment tool) — needs a real daemon + worker step, the script does not drive that surface.

## Gotchas

- The attachment button is a **native file trigger** (`input[type=file]`), playwright uses `setInputFiles`, not click; after selection, onAttachment(files) delegates to the parent component for grant + upload + token injection.
- The upload is a three-step async (grant -> separate host PUT -> token), not a one-shot POST; the drive must wait for the token to land in the draft before asserting.
- Composer attachments need a live editable surface (controlled draft, the parent holds state); the fixture static div has no attachment wire.
- The token format `![名](attachment:attachments/{teamId}/{id}.{ext})` is a markdown-image-syntax variant — the execution/rendering surfaces parse it by the attachment: protocol, it is not a real URL.
- **Verification state (2026-09-28)**: this feature was verified by the #331 lane inside a worktree (integration attachments.test.ts, 588 lines + a lane verify run); the evidence was not preserved in the main repo when the worktree was deleted; a main-repo live re-probe is pending (needs the full orchestration of upload host + daemon worker step). The user path was verified from the merged code.
