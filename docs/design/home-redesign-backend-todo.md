# Coordinator home redesign: backend to-do

The UI of the Coordinator home redesign is built against fixtures. The items below are the backend work it still waits for. They are not part of the UI change and are open for anyone to pick up. Shapes, data sources and fallbacks for each `G` item are in `docs/design/side-panels-backend-gaps.md`.

A box marked **owner route** changes a security surface from `packages/shared/merge-gate-paths.json` and needs the owner's review. A box marked **design first** changes persisted state, a wire protocol or the command boundary and needs a one-page design before code.

## Larger than this list

- [ ] AI-native action registry: one typed registry that the web, the Coordinator tools, the MCP face and the CLI are generated from, with a journal and undo. Proposal in `docs/design/ai-native-actions.md`; a separate project that needs the owner's review first.

## Done with the UI change

- [x] Quick replies: `suggest_replies` tool and stored replies (`docs/design/coordinator-quick-replies.md`).
- [x] Uploads accept 0-byte files and common office and data files (`docs/design/attachment-upload-limits.md`, gaps G-B and G-C).

## Computers panel

- [ ] G3. Return the threads running on a machine (title, project, start time) so the work tab lists them instead of a count. Small, read-only.
- [ ] G1. Store and return the machine's own hostname. Small. **Owner route.**
- [ ] G2. Report, store and enforce the folders an agent may use on a machine. Large. **Owner route, design first.**
- [ ] Agent browser and desktop use on by default. The panel no longer shows the two switches; the owner wants both open by default. Today the browser capability is off per computer and desktop control is a lease the user takes. Needs a default, a place to turn it off, and the daemon side. **Design first.**

## Results panel

- [ ] G5. A result kind finer than code or document (design, page). Small for the field, medium for reliable classification.
- [ ] G6. A thumbnail per result. Large. **Owner route.**
- [ ] G7. Per-result visibility. Needs a product decision first.
- [ ] G8. Archive a result from its card menu. Small, the endpoint exists.

## Attachments and file preview

- [ ] G-A. Download under the file's own name through `?download=1`. Small.
- [ ] G-F. PDF inside the panel: check on a live stack whether the `sandbox` response header blocks the built-in viewer, then decide. Needs a security review.
- [ ] G-D. Attachment metadata endpoint, only if a size line is wanted.
- [ ] G-E. Preview of office documents. Medium, new dependency, owner decision.

## Message first

The owner's rule: what the user sends shows at once; the network works behind it. Most of this is web work; the server parts are listed so nobody assumes they exist.

- [ ] Send without waiting. A message leaves the composer and appears in the conversation the moment it is sent, marked pending; a failure turns the mark into an alert with retry, edit and delete instead of putting the text back in the composer. Today the web awaits the request and keeps the draft on failure. Web: an outbox kept across reloads, ordering against server messages, one retry path. Server: the idempotency ledger already exists (`apps/server/src/services/client-message.ts`, `clientMessageId`); confirm every send route goes through it so a retry never creates a second message, and that a retried send after a server-side success returns the stored response. **Design first** (delivery state: every path that reads or writes it and the behavior on each failure).
- [ ] Show attachments before they upload. A picked or dropped image, video or file renders from the local copy at once and uploads in the background; a message with attachments still in flight waits in the outbox and sends when they finish, and a failed upload marks the message instead of blocking the composer. Server: resumable or retryable uploads for large files, and video is not an accepted type yet (allowlist in `packages/shared/src/attachment-types.ts`, size limit and quota in `apps/server/src/services/attachments.ts`).

## Product goals the owner named

These are the first things the owner wants cairn to do for him. Each needs a design before code; both touch the machine and command boundary or credentials, so they are owner-routed.

- [ ] Job applications in the browser. An MCP-driven flow where the agent uses the owner's own browser session on his computer to search a job site (the owner named Boss Zhipin), open postings, fill application forms from his profile and resume, and submit. Needs: browser control on the owner's machine (the browser capability and `apps/server/src/services/browser-session.ts`, `computer-control.ts` exist; the daemon side and "on by default" are open, see the computers section), a profile and resume store the agent may read, form filling that shows what it will enter, and a confirm-once step before every submit because an application cannot be withdrawn. Risks to decide first: the site's terms and anti-automation checks (captchas, rate limits, account flags), credentials staying in the owner's browser and never in the agent's context, and a daily cap. **Owner route, design first.**
- [ ] Mail that reaches the owner without polling. The agent is told when new mail arrives in the owner's Gmail and QQ Mail and raises what matters. Needs: a mail connector as an MCP server with push delivery (Gmail supports push through a watch on the mailbox with a Pub/Sub topic and a webhook; QQ Mail offers IMAP, where the push equivalent is a held-open IMAP IDLE connection), a public or tunneled webhook endpoint for the self-hosted server, an inbound event that wakes the Coordinator (the wake mechanism exists), rules for what is worth a notification, and delivery to the owner through the existing push channel (`apps/server/src/services/push.ts`, `notifications.ts`). Credentials: OAuth tokens and app passwords go through the secrets service; mail content is third-party text and must be treated as data, never as instructions. **Owner route, design first.**

## Practices worth adopting

From a quick search of the code on 2026-11-11, not a full audit; each line says what the search found. Confirm before starting.

- [ ] Message-first sending and local-first attachments: see the section above.
- [ ] Error boundaries in the web. No React error boundary was found under `apps/web/src`, so one component that throws can blank the whole app. Wrap the routes, each side panel and the conversation, with a retry.
- [ ] Windowed rendering for long lists. No list virtualization was found; a long conversation renders every message, and one e2e test that renders 100 messages already runs close to its time limit on a loaded machine.
- [ ] Event stream resume. No `Last-Event-ID` handling was found; after a dropped connection the client should resume from the last event it saw instead of refetching, and show a quiet reconnecting state.
- [ ] Webhooks instead of polling for GitHub. No webhook receiver was found on the server; pull request and check state is polled with backoff. Webhooks cut latency and API quota, and need the same public or tunneled endpoint as the mail connector.
- [ ] Conditional requests. No `ETag` or `If-None-Match` use was found; unchanged lists could answer 304.
- [ ] An action journal with undo: proposed in `docs/design/ai-native-actions.md`.
- [ ] Team check on project deletion and a guard for running work: see the sidebar section.
- [ ] Data export. No whole-account export was found; a self-hosted product should let the owner take his conversations, tasks and files out in one archive (backup status exists in `apps/server/src/services/backup-status.ts`).
- [ ] A live-stack end-to-end pass before each release. The web suite runs on fixtures and a mocked API, and the pull request stage does not run it; only the merge queue does.

Already in place, so not listed: rate limiting, offline handling, reduced-motion support, push notifications, server-synced composer drafts, an idempotency ledger for sends, scheduling, OpenTelemetry traces.

## Voice input

- [ ] Local transcription for the composer's microphone. The web ships a `VoiceSource` interface with two sources: a fixture source for tests and, as an interim the owner approved, the browser's built-in speech recognition, which sends audio to the browser vendor's service. Replace the interim with a small open-source speech model that runs locally in the background on the daemon or the server, behind the same interface, with the model selectable in settings. Work to do: survey the open-source local speech-recognition options (model size, Chinese and English quality, streaming support, licence, CPU and GPU cost), pick a default, then design the streaming contract (audio format in, interim and final events out, language, auth, errors). The web-side contract is in `docs/design/composer-voice-input.md` once the UI change lands; the trigger phrase that sends (`OK，发送`) is handled in the web. **Design first.**

## Sidebar and projects

- [ ] Refuse to delete a project that has running work, or stop that work first. The archived page now has `Delete all`; archiving does not stop builds or steps and `deleteProject` removes them without a check, so the confirm dialog warns about it.
- [ ] `DELETE /api/projects/:id` does not check that the project belongs to the caller's team, unlike archive and unarchive. Add the same team check.
- [ ] Decide whether a task thread inside an archived project stays writable; the UI still shows its composer.

## Verification still owed

- [ ] Run the redesigned home on a live stack: a real model calling `suggest_replies`, attachments end to end, the computers panel against a real machine.
- [ ] Regenerate the gallery snapshot baselines from the CI artifacts.

## Decided not to build

- Logout in the account menu.
- A hosted cloud computer: the user's own computer is the cloud computer.
