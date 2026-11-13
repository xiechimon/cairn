# Attachment upload limits

Owner decision: accept 0-byte files and common office and data files; text and images preview inline, everything else is offered for download. Validation is decided by an extension allowlist, never by the client's MIME alone.

## Pipeline (before this change)

| Stage | Where | Constraint |
|---|---|---|
| Picker | `apps/web/src/chief/composer-surface.tsx`, `apps/web/src/detail/composer.tsx` (`accept`) | `text/*,image/*,json,pdf,xml` |
| Paste, drop, pick | `apps/web/src/overlay/attachment-paste.ts` into `attachFile` in `apps/web/src/api/attachments.ts` | name valid, size 1..10 MiB, browser MIME in prefix list (empty MIME rejected) |
| Error copy | `attachmentFailureTitle` in `attachment-paste.ts`, English entries in `apps/web/src/i18n/en.ts` | size, type, generic failure |
| Shared constants | `packages/shared/src/attachment-token.ts` | `ATTACHMENT_MAX_BYTES` = 10 MiB, token line format, inline image exts |
| Grant | `POST /api/uploads/grant` in `apps/server/src/routes-uploads.ts`; `validateAttachmentUpload` in `apps/server/src/services/attachments.ts` | zod `size > 0`, size <= 10 MiB, MIME prefix list, extension allowlist, file name rules, team quota |
| Grant token | `apps/server/src/lib/attachments-token.ts` (security surface) | signs size, MIME, key, scope, exp; only checks `typeof sizeBytes === 'number'` |
| Commit | `POST /api/uploads/upload`, `uploadFile` | grant signature, team, size equals grant, MIME equals grant, extension equals grant, single use, quota |
| Storage | `writeAttachmentFile` | key `<team>/<id>.<ext>`, path containment, `O_NOFOLLOW`, mode 0600 |
| Serving | `GET /api/attachments/:id` | `x-content-type-options: nosniff`, `content-security-policy: sandbox; default-src 'none'`, inline only for png, jpeg, gif, webp, pdf, otherwise `attachment` |
| Agent upload | `attachWorkerFile` in `apps/server/src/services/agent-attachments.ts` | content sniff (image, PDF, UTF-8 text), then the same `validateAttachmentUpload` |
| Reading | `readAttachmentMeta` (chief tools, MCP face, machine relay in `machines.ts`) | utf8 for text MIME, base64 otherwise |
| Daemon | `apps/daemon/src/step-attachments.ts` | only image extensions are fetched and materialized; nothing parses or executes other types |

Limits: 10 MiB per file, team quota, no per-message count limit server-side. SVG, HTML and CSS were already allowed by extension and are served as downloads only (sandbox CSP plus nosniff plus `attachment`). That protection is kept and not widened.

## Design

One allowlist in `packages/shared/src/attachment-types.ts`, used by web and server:

- Extension decides validity (`isAllowedAttachmentExt`). Added: `xlsx xls docx doc pptx ppt zip` (download only). Already present: `csv tsv pdf md txt json yaml yml log` and the code and image sets. Not allowed: `exe`, `dll`, `bin`, macro `xlsm`, no extension.
- Declared MIME only refines (`resolveAttachmentMime`): empty, octet-stream or an unknown type falls back to the extension's canonical type. A text extension keeps a declared `text/*` except `text/html`, `text/xml`, `text/javascript`. The stored and grant MIME is this resolved value.
- Serving never trusts the stored MIME: content-type comes from the key's extension (`servedAttachmentMime`, unknown becomes `application/octet-stream`). Inline disposition requires an inline extension (png, jpg, jpeg, gif, webp, pdf) and a stored MIME equal to that extension's canonical type (`isInlineAttachment`). Everything else is `attachment`. nosniff and the sandbox CSP stay on every response.
- Empty files: size 0 is valid on web, in the grant schema and in `validateAttachmentUpload`/`uploadFile`. Size above 10 MiB and negative sizes stay rejected.
- The grant token only checks the type of `sizeBytes`, so `attachments-token.ts` needs no edit. No security-surface file is changed.
- Agent side: office, CSV and zip files reach `readAttachmentMeta` as base64 (CSV and TSV as utf8); no code parses or executes them. Agent `attach_file` keeps its own content sniffing and still only produces image, PDF and text files.

## Paths and expected behavior

| Path | Expected | Test |
|---|---|---|
| Web `attachFile`, 0-byte `.txt` | accepted, grant carries `size: 0` | `apps/web/e2e/composer-paste.spec.ts` (0-byte .txt and .xlsx) |
| Web `attachFile`, `.xlsx` with empty or Office MIME | accepted | same e2e |
| Web `attachFile`, `.exe` | rejected locally with the unsupported-type toast, no grant | `composer-paste.spec.ts` (non-whitelisted paste) |
| Web `attachFile`, over 10 MiB | rejected locally | `composer-paste.spec.ts` (over-cap paste) |
| Picker `accept` | extension list from shared | `attachment-types.test.ts` (accept list) |
| Grant, size 0 | 200 | `attachment-upload-limits.test.ts` (0-byte) |
| Grant, negative size or over 10 MiB | 400 | `attachment-upload-limits.test.ts`, `attachments.test.ts` |
| Grant, office, zip, csv with any declared MIME | 200 | `attachment-upload-limits.test.ts` |
| Grant, `.exe`, `.dll`, `.xlsm`, `.bin`, no extension | 400 | `attachment-upload-limits.test.ts`, `attachments.test.ts` |
| Upload, size mismatch, MIME mismatch, extension mismatch, replay | 409 | `attachments.test.ts`, `attachment-upload-limits.test.ts` (extension) |
| Upload, 0 bytes | 201, empty file on disk | `attachment-upload-limits.test.ts` |
| Serve xlsx, docx, csv, zip | `attachment`, nosniff, sandbox CSP | `attachment-upload-limits.test.ts` |
| Serve html, svg, js, html-declared txt or xlsx | never inline, never `text/html`, nosniff | `attachment-upload-limits.test.ts`, `attachment-download-security.test.ts` |
| Serve png, jpeg, gif, webp, pdf | inline | `attachment-download-security.test.ts` |
| Serve a row with unknown extension | `application/octet-stream` download | `attachment-types.test.ts` (served type) |
| Agent `attach_file` | unchanged sniffing, shared validation | `agent-attachments.test.ts` |
| Chief, MCP, machine read | text utf8, others base64 | `attachments.test.ts` |
| Daemon image fetch | unchanged, images only | `step-attachments` tests |
