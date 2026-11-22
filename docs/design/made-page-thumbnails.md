# Made page thumbnails (#4965)

Prior art: `docs/research/2026-11-22-page-thumbnails.md`. Owner decision 2026-11-22: option A′, a static image made once by the desktop app.

## Who meets it

Someone who installed Cairn today asks for a web page, the task finishes, and its card shows up in the Made panel. The card shows a picture of the first screen of the page. Nothing to set up: no account, key or download. Without the desktop app (a standalone server), the card shows the report's opening lines instead, as it already does for pages it cannot preview.

Why: the card used to render the page itself in a sandboxed iframe. A page under the 256 KB cap built from tens of thousands of blurred or animated elements stalls the whole panel for 1 to 5 s, and an endless animation keeps it janky while the card is mounted (#4965).

## Mechanism

1. The card fetches the page HTML (unchanged, 256 KB cap) and keeps the existing rule: a page with scripts, handlers, script URLs, `noscript` or nested frames gets no preview.
2. For a script-free page the card shows `<img src="/api/attachments/<id>/thumbnail">`.
3. The server answers from `<attachmentsDir>/<teamId>/<id>.thumb.jpg` when it exists. Otherwise it asks desktop main over the utility-process port: `{type: 'cairn-page-capture', id, html}`.
4. Desktop main opens one hidden offscreen window (800x600, `sandbox`, `javascript: false`, in-memory partition `cairn-page-capture`, every permission denied, every request except its own `cairn-page-capture:` scheme cancelled, the card's CSP as a response header, window-open denied, navigation prevented, audio muted). It takes the first `paint` frame after load, encodes JPEG 80 and replies `{type: 'cairn-page-capture-result', id, image}`; the window is destroyed in every case.
5. The server checks the reply is a JPEG under 1 MiB, writes it (mode 0600, contained path) and serves `image/jpeg` with `nosniff`, `private, max-age=86400`.

Capture runs on the first card view, not at publish. Attachments are immutable: a republish or a page edit publishes a new attachment id, which gets its own capture. Pages published before this change are covered without a backfill job.

## States

| State | Stored | Card shows |
|---|---|---|
| none | no file | tile skeleton after 200 ms while the request is open |
| capturing | in-memory promise per attachment id; concurrent requests join it | same |
| ready | `<id>.thumb.jpg` | the image |
| failed | in-memory set for the server's lifetime (a restart retries once) | report opening lines (existing summary), else the title alone |
| unavailable | nothing (no desktop port) | report opening lines, else the title alone |

## Budget

- Desktop: one capture at a time (queued); 10 s from window creation to frame, then the window is destroyed, which kills its renderer. Only runs after the tray window exists, because destroying the last window quits the app.
- Server: one request in flight to desktop; 15 s reply deadline, then failed. HTML over `DELIVERABLE_LIMITS.maxPageBytes` is refused on both ends.

## Cleanup

The attachment GC unlinks `<id>.thumb.jpg` whenever it reaps the attachment (pending, failed or orphan), in the same step as the attachment file. A failed attachment never gets a thumbnail because the route requires status `ready`.

## Channel security

The request travels only over Electron's utility-process message port, which exists only between desktop main and the server it forked; no socket, header or loopback route carries it, so the model's host shell cannot reach it (#4948/#4986 threat). Main accepts only well-formed messages from its own child; the server accepts results only for ids it issued, and treats the bytes as an untrusted image. The page itself is untrusted: it renders with no script, no network, no permission and no cookie (in-memory partition, not the owner-signed default session), in a sandboxed renderer separate from main. The thumbnail route sits under the same auth as `GET /api/attachments/:id`, so a remote viewer (Cloudflare Access, paired device) sees what it could already download.

## Scenarios

| Situation | What the user sees | What the system does | Wait and cost |
|---|---|---|---|
| Mac app, new script-free page, first view | skeleton tile, then the picture | one hidden-window capture, JPEG stored | 0.2 to 5 s once, off the panel's renderer |
| Same page, later views or other devices | the picture at once | serves the stored JPEG | one ~20 to 60 KB image |
| Costly page (tens of thousands of animated elements) | the picture; the panel stays smooth | capture pays the render once in the hidden renderer | no panel stall |
| Page takes over 10 s to render | report opening lines | window destroyed, failure remembered until restart | 10 s once |
| Page with scripts | report opening lines (unchanged) | no capture requested | none |
| iPhone through Cloudflare Access | the same picture | same route on the Mac's server | one image |
| Standalone server, no desktop app | report opening lines | route answers 404 at once | none |
| Desktop app restarts the server mid-capture | report opening lines for that card until reload | reply goes to a dead port; server deadline fails it | 15 s once |
