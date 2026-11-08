# Android installed web app: frontend design

Date: 2026-11-08
Status: Proposed contract; real-component page drafts and owner selection pending; not implementation-ready

Requirement: [#3475](https://github.com/xiechimon/cairn/issues/3475). Evidence and platform boundaries: [research](../research/android-installed-web-app-2026-11-08.md). Data, launch intents and test ownership: [backend design](android-installed-web-app-backend.md). The owner confirmed that they will perform Android acceptance after implementation; device access is not a blocker for research or automated tests.

## UI brief

Surface: account settings, Coordinator chat, needs-you list, and a new local share-review surface.

Goal: distinguish interruptions from completed work, open the exact answer, and capture another app's content without losing or automatically submitting it.

Rules: P1–P5, C1, C4, C5, C7, C10–C12, V1–V10, L1–L5, T1–T2, A1–A4 and R1 in `apps/web/DESIGN-RULES.md`. Follow the current `apps/web/DESIGN.md` tokens and gallery primitives, not the native Android styling table in the mobile IA.

References inspected:

- `docs/design/references/settings/t3code-mobile-settings.png`: label and help text in divided rows, controls beside their setting. Unlike the reference's combined thread-alert selector, cairn separates decision and completion delivery.
- `docs/design/references/coordinator-chat/claude-ai-mobile-empty-light.jpg`: one composer, quiet navigation and no competing send action. Share intake must stage a draft, not add another always-visible composer.
- `docs/design/references/thread-review/amp-mobile-pending-question-running.jpg`: actual question and numbered options remain together with the answer control; an Answer launch must not open an empty input detached from its question.

Draft: pending. Render the settings and share-review proposals from the existing `SettingsCard`, `SettingsRow`, `ToggleSwitch`, `FormStack`, `FormField`, `EmptyState`, `Button` and question-card components before dispatching UI implementation. Capture 390px and 1440px, light and dark; label every render as a draft. This text contract is not a substitute for those renders or the owner's pick. Reference images remain on main; do not copy private captures into this PR.

## Notification controls

Use the account settings group, not a new top-level settings section. One master row is named Push on this device. Two rows underneath are Needs your answer and Completed work. Help text states that category choices apply to this device in this team, and that Android/browser permission still controls all notifications.

- Existing subscription: needs-answer on, completed off unless explicitly changed.
- No subscription: show explanatory text and one Enable on this device action; category rows are disabled with the reason visible.
- Permission denied: keep the saved choices visible, say notifications are blocked and direct the user to site/app settings. Do not repeatedly prompt or label a network failure as denial.
- Permission dismissed: remain off; explain that permission was not granted without calling it blocked.
- Read or save failure: preserve last confirmed state, explain that the change was not saved, and offer retry. Never indicate success based only on a local toggle.
- Offline: show last confirmed preferences as read-only with an offline explanation; retry is an explicit user action after reconnecting.
- Unsupported API: explain the limitation once; retain usable in-app needs-you and task creation controls.

App categories are not Android system channels. The labels and notification titles convey category even when the system groups everything under one app. Turning off completed work leaves questions enabled; turning off questions does not turn off completed work. The master switch disables both by unsubscribing.

## Notification landing

A question notification reads Needs your answer, with the actual question text in the body. One optional action reads Answer. Body tap and Answer land on the same question, with the containing thread and pending card visible. Open the card and focus the first unanswered control after data loads. Do not send an answer, change its status, or focus an unrelated composer automatically.

For a resolved or cancelled question, show one factual status line and a View thread link. For an expired build, show that it is no longer current; do not silently answer a replacement build. Signed-out users authenticate first, then resume the same validated launch intent. Unauthorized identifiers do not reveal question text. Offline users see an offline state, never a stale enabled submit button.

Question context, accepted-answer cleanup and counts belong to #3485. This task integrates the landing with that contract rather than building another answer lifecycle.

## Launcher shortcuts

Long-press the installed icon: New task, then Needs you. Both URL launch intents are consumed once and removed with replace navigation, so refresh/back does not create another intent. The browser may retain old launcher metadata until the installed WebAPK updates.

New task opens the existing task-creation/Coordinator intent and focuses the composer without submitting or replacing an existing draft. If a draft exists, keep it. Needs you opens the current authoritative attention surface, not a second mobile-only list. Clear a project filter when the shortcut means all pending work; preserve the user's regular navigation state outside this explicit shortcut.

## Share review

Flow: source app Share → cairn → local review → sign in if needed → choose the destination project → create a task using the existing creation path. A share is untrusted source material, never an instruction to execute immediately.

The local review contains a title, editable text and URL, attachment rows, destination selector and one primary Continue action. A secondary Discard action asks before deleting content. Continue validates the session and project, uploads attachments using existing grants, and stages the existing task composer. The existing task-creation action is the only point that submits work. If a typed draft exists, offer an explicit destination choice instead of overwriting it.

Plain text rendering preserves URLs passed in text as well as the dedicated URL field. Files have name, size and upload state; rejected files remain listed with a reason and Remove action. Incoming HTML stays text. No link preview, server fetch or model call happens during review.

Before sign-in, show only this local incoming content, never cached private task data. Signing in as another user or team requires explicit confirmation of the destination; never auto-upload local content into that account. A successful save is shown only after a durable local write completes. Storage failure leaves the current content visible and gives Copy text and retry guidance rather than pretending it will survive a restart.

## Component × state production matrix

Every listed cell must be captured at both widths and themes by the implementation session. None has been captured for the proposed UI yet.

| Component | Empty | Loading | Error | Offline | Long content | Pending question | 390px | Dark |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Settings rows | Seed no subscription | Delay preference read | Fail read/save; permission denied separately | Disable saves with reason | Wrap help without shrinking switch | Categories independent of pending count | Full-width rows; 44px touch controls | Token colors and focus contrast |
| Question landing | Seed resolved/deleted question | Delay authorized question read | Invalid request or unauthorized | Refuse submit, keep local answer draft | Wrap question and options | Seed exact request id, multiple questions | Card and submit visible with keyboard | Existing question component tokens |
| Needs-you launch | Seed zero pending | Delay attention read | Fail attention read with retry | Show offline state, no live claim | Long task and question titles | Seed task and Coordinator questions | No horizontal scroll | Same grouping and monochrome glyphs |
| Share review | Empty/malformed share | Pending attachment verification | Reject type/size; fail durable write/upload | Cold launch cached review shell | Text overflow scrolls inside form | Separate share draft from answer draft | Keyboard-safe primary action | Same form tokens, no custom palette |

## Required comparisons and acceptance

The implementation PR includes one reference-versus-ours row for each state with a source shot. Settings populated/390px compares to t3code; empty/ready composer compares to claude.ai; pending answer compares to Amp. Error, offline and share-review have no direct reference capture: use the established components, label that absence, and do not invent a reference screenshot.

Measure no horizontal scroll at 390px, 44px touch targets, one primary action, accessible names, focus after intent resolution, and axe in both themes. Capture the live authenticated stack for populated settings, question landing and staged share. Fixture/draft captures remain labelled and never substitute for live evidence or the owner's Android test.

The [phone checklist](../verify/android-installed-web-app-acceptance.md) is deliberately future-tense until the implementation is deployed. A design PR must not close #3475 or claim a working Android share target.
