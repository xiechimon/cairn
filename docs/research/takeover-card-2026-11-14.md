# Takeover card in the Coordinator conversation: prior art (2026-11-14)

Question: when the Coordinator calls `request_takeover` (login or human check on its own computer), how should the owner learn about it, reach the live screen in control, and hand back? Today the owner sees nothing in the conversation and the push carries no record.

Evidence marks: measured = read first-hand in the linked primary source or in this repo; inferred = derived from measured; guess = the rest. Related: `docs/research/browser-login-handoff-2026-11-13.md` (login handoff mechanics), `docs/design/computer-login-handoff.md` (gate design).

## 1. Comparison

| Source | How it surfaces takeover | Trade-offs | Link |
|---|---|---|---|
| ChatGPT agent (formerly Operator) | Agent pauses and prompts the user to take control; menu path `"…" → Take over browser` (measured). Operator "proactively" asks for login, payment, CAPTCHA (measured). While the user controls the browser "screenshots are not captured" (measured). After return of control the agent "attempts to continue from the prior workflow state", and may need to re-establish the run or prompt again (measured). Supported on web, iOS/Android, desktop (measured). Card wording, timeout and push for takeover: not documented (guess: none specific). | Strongest privacy statement (model blind during takeover). Resume is best-effort and documented as such. Entry hidden under a "…" menu, so discoverability depends on the in-chat prompt. | [help: ChatGPT agent](https://help.openai.com/en/articles/11752874-chatgpt-agent), [Introducing Operator](https://openai.com/index/introducing-operator/), [Introducing ChatGPT agent](https://openai.com/index/introducing-chatgpt-agent/), [Operator system card](https://openai.com/index/operator-system-card/) |
| Claude for Chrome | Runs in the user's own Chrome in a side panel; "pauses and asks you when something needs your approval" (measured). Uses the `notifications` permission "when it finishes a task or needs you to take action", plus notification sounds (measured). Login: can request a credential from 1Password, approved with biometrics, so "Claude never sees your password or one-time code" (measured). Screenshots capture whatever is visible in its tabs; it "can't filter sensitive content out" (measured). No takeover mode: the user is already at the keyboard (inferred). | OS notification for "needs you" is the closest match to Cairn's push. Privacy relies on a password manager, not on blinding the model. | [Get started](https://support.claude.com/en/articles/12012173-getting-started-with-claude-for-chrome), [Using safely](https://support.claude.com/en/articles/12902428-using-claude-in-chrome-safely), [Permissions](https://support.claude.com/en/articles/12902446) |
| Claude computer use (API tool) | No product UI; the integrator owns human-in-the-loop. Docs suggest putting credentials in the prompt in `<robot_credentials>` tags and warn of prompt-injection risk, and recommend human oversight for sensitive data (measured). | Nothing to copy for the card; confirms the harness, not the model, must own the pause. | [Computer use tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool) |
| Perplexity Comet | Assistant "sidecar" shows steps, with "clear buttons to stop the Assistant or provide more guidance" (measured). For "logging in to a certain site" it "will pause and ask for permission before proceeding" (measured). Takeover screen, timeout, push: help center blocked (Cloudflare challenge on `perplexity.ai/help-center`), so not verified. | Local browser, so no remote screen to open. Permission prompt, not a control transfer. | [Comet Assistant puts you in control](https://www.perplexity.ai/hub/blog/comet-assistant-puts-you-in-control); help center: blocked (bot challenge) |
| Manus | Cloud Browser: on SMS codes, CAPTCHA, MFA "the system will prompt you to Take Over"; steps: "You receive a notification to take over", complete it, "hand control back", Manus continues (measured). Official screenshot: an inline row in the chat under the agent's message, icon + "You can choose to take over the browser to complete the operation." + one dark `Take control` button; below it an ochre-tinted "Manus will continue working after your reply"; the live screen sits in a right "Manus's Computer" pane (measured, screenshot in the Cloud Browser doc). Browser Operator (extension): "take over by clicking into the tab or stop the task completely by closing the tab"; mobile can start and monitor tasks (measured). | Closest to the target: an in-thread card with one button, plus a notification, plus a status line. Timeout and privacy during takeover not documented (guess). | [Cloud Browser: Take Over When Needed](https://manus.im/docs/features/cloud-browser#3-take-over-when-needed), [Browser Operator](https://manus.im/docs/features/browser-operator) |
| Devin | Interactive Browser lives under the session's `Browser` (or `Computer`) tab; meant for "completing CAPTCHAs, completing multi-factor authentication steps" (measured). For credentials Devin posts a chat message with a `Provide Secrets` link (measured, screenshot). Logins can be saved as an org browser profile (measured). Slack DMs notify users (measured, `im:write` scope). Takeover-specific notification, timeout: not documented. | Two separate patterns: in-chat action link for secrets, tab for the screen. No single card that ties request to screen. | [Session tools: Interactive Browser](https://docs.devin.ai/work-with-devin/devin-session-tools#interactive-browser), [Browser auth](https://docs.devin.ai/work-with-devin/browser-auth), [Secrets](https://docs.devin.ai/product-guides/secrets#session-specific-secrets), [Slack](https://docs.devin.ai/integrations/slack) |
| Browser Use Cloud | API pattern: run stops at the checkpoint; caller fetches `live_view_url`, a human acts, then a follow-up run with the same `session_id` continues; browser stays open for `keepAlive` (example 900 s) (measured). | Timeout as an explicit keep-alive window (15 min in the example, same as Cairn). No end-user UI. | [Human in the loop](https://docs.browser-use.com/cloud/agent/human-in-the-loop) |
| Google Project Mariner | Live view per task; `Take over` button "at the bottom of the live view"; `Pause`/`Resume`/`Cancel` top right; tasks waiting on the user are listed under "Needs attention" with `Review` (measured). For passwords or payment details it pauses and prompts to "take over" (measured). Playback "will show a blank screen" for the takeover span (measured). Live page now returns no article body; read from the 2025-12-27 archived copy. Product reported discontinued in 2026 (guess: only third-party reports). | "Needs attention" list is a good secondary surface; blank playback is a clear privacy rule. | [How to use Project Mariner](https://support.google.com/labs/answer/16270604) (archived copy 2025-12-27) |
| Microsoft Copilot (Browse with Copilot, formerly Copilot Actions in Edge) | Runs in a local Edge tab marked with a cursor icon; "take control at any time" (measured). For personal details or payment, Copilot "will ask you to provide it, and you can take control of the tab" (measured); on banking or email sites it asks you to monitor or take control (measured). "If you stop the task, you're back in control", and no screenshots are captured until the task restarts (measured). Cannot read autofill, saved passwords or wallet (measured). | Privacy by stopping capture when the user holds control; local tab, so no remote screen. | [Browse with Copilot](https://support.microsoft.com/en-us/microsoft-copilot/browse-with-copilot) |
| Cairn today | Server holds `request_takeover` up to 15 min (`computer-handoff.ts:6`), sets `handoffReason` (`machine-computer.ts` `holdTakeover`, ~line 648), refuses snapshot and observe while the owner holds control (`computer-handoff.ts:62-73`), fires one push titled `Login needed` that links to `/app?pane=machines&machine=…&screen=1` (`machine-computer.ts:700-705`) (all measured). The conversation shows no card: tool calls are folded into a generic tool pill by name (`apps/web/src/api/mappers.ts:1558-1576`), and `request_takeover` has no renderer (measured, grep finds no web reference). Take control / Give back exist only in the machines panel `ComputerControlBar` (`apps/web/src/board/machines-panel.tsx:167-217`) (measured). | All server mechanics exist; the owner-facing surface and a recorded push are missing. | this repo |

## 2. The pattern that fits Cairn

An in-thread request card tied to a remote live screen, plus a push that lands on the card (Manus shape), with the model blind while the owner holds control (ChatGPT agent, Copilot, Mariner shape). Reasons:

- Cairn's computer is remote, like ChatGPT agent, Manus, Devin and Mariner, not a local tab like Claude for Chrome, Comet or Copilot. Remote products all need an explicit control transfer and a way back (measured in their docs).
- Manus is the only product with a documented in-chat card with one `Take control` button plus a notification plus a "continues after you" line (measured). That matches the target and Cairn's existing ask-user question card, which already pushes and deep-links to `/app?chief=<threadId>` (`apps/server/src/services/chief-questions.ts:190-200`, measured).
- Cairn already blinds the model during owner control and already has the 15-minute window (measured); the card only has to show those states, it adds no new rule.
- Mariner's blank playback is the privacy rule for history: the card must never show a thumbnail or text captured during owner control (inferred).

Rejected: Devin's tab-only model (request and screen live apart), Browser Use's caller-built flow (no UI), Comet's permission prompt (no control transfer).

## 3. Recommendation

### Card fields

- Title: `Coordinator needs you to sign in` (reason `login`) or `Coordinator needs you` (reason `model` with a non-login reason). Chinese source strings via `t()`.
- Reason: the redacted `reason` param, max 200 chars (already redacted in `holdTakeover`, measured).
- Site: origin only (for example `accounts.example.com`), never a full URL with query. Not available today: `request_takeover` takes only `reason` (`packages/shared/src/protocol/computer-tools.ts:49-56`, measured) and `computer` stores no URL (measured). Derive it server-side from the step's last browser call (guess: the browser frame carries the URL; verify).
- Time left: from `computerCall.deadlineAt` (measured column), shown as minutes (`14 min left`), switching to the end state at the deadline.
- One primary `Take control` button (V6); `Stop` as a text link that stops the turn (existing stop path).

### States (one selector, C1)

| State | Source of truth | Card shows |
|---|---|---|
| Waiting | call `running`, `controlHolder != user` | Title, reason, site, `N min left`, `Take control`, `Stop` link. Ochre accent (V5: waiting on you) |
| Computer offline | call `running`, machine not connected | Same, `Take control` disabled with `Computer is offline` beside it (C7) |
| Owner in control | call `running`, `controlHolder = user` | `You're in control. Coordinator is paused`, `N min left`, `Open screen`, `Give back` |
| Handed back | call `done` | `Handed back at 10:42. Coordinator continued`, no buttons |
| Timed out | call `error`, deadline passed | `Not finished in 15 minutes. This step stopped`, no buttons (owner decision: no retry) |
| Stopped | call `error`, step stopped | `Stopped`, no buttons |
| Server restarted | call `error` from `sweepComputerHandoffs` | `Server restarted before you finished. This step stopped` |

### Button behaviour and screen entry

- `Take control` acquires the lease (`acquireComputerControl`, allowed while `request_takeover` waits, `computer-control.ts:69-90`, measured) and opens the enlarged screen dialog already interactive, with `Give back` in the dialog head. Reuse `MachineDetail`'s dialog (`machines-panel.tsx` `DialogShell` block and `ComputerControlBar compact`) by extracting it into a component the card can open, rather than routing through the machines side panel.
- The 2026-11-13 owner decision says the push opens the screen view-only and the owner presses Take control (`docs/design/computer-login-handoff.md`). Keep that for the push: the push opens the conversation at the card; the card's `Take control` is the deliberate press, so control mode on that press does not contradict the decision (inferred). Record this in the design doc when implemented.
- `Give back` releases the lease (`releaseComputerControl` clears handoff, measured); `holdTakeover` sees the fence move and returns `TAKEOVER_HANDED_BACK` (measured). Closing the dialog without `Give back` keeps control and the card stays in "Owner in control" with `Open screen`.
- Mobile (390px, P3): the dialog is already full-width with safe-area insets (measured `machines-panel.tsx`); card buttons use `pointer-coarse:h-11` like `ComputerControlBar` (measured).

### Push and deep link

- Title `Coordinator needs you to sign in`, body = reason + site, href `/app?chief=<threadId>&takeover=<callId>` (same family as the question push, measured), tag `<userId>:<callId>` (existing).
- Send it through the recorded path so delivery is auditable: `sendMustReachAlert` (`apps/server/src/services/push-alerts.ts:208`) or `sendPushToUser` with `required: true`, which inserts a `push_delivery` row (`push.ts:136-146`, measured). Pick `required: true` with no email fallback unless the owner wants email (inferred: a 15-minute window justifies retry tracking).
- On landing, the conversation scrolls to and highlights the card; it does not auto-acquire control.

### Server event for the card

- Persist the card as a conversation row when `holdTakeover` starts (not resumed) and publish it, the way `chief-questions.ts` writes the question and calls `publishRow` (measured). Update the same row on each transition (owner takes control, give back, timeout, stop, sweep). Today `holdTakeover` publishes nothing on start, and `markHandoff` publishes no computer event (measured: `publishFeed` runs only on settle and skips non-feed tools via `FEED_TOOLS`), so the web learns only by polling (inferred).
- Alternatively derive the card from the `request_takeover` toolcall row the mirror writes (`apps/server/src/coordinator/runtime/mirror.ts:64-85`, measured) joined with the live `computer` and `computerCall` rows. Rejected: the mirror row is written from runtime entries and may lag or be folded into the pill row; a server-owned row is one source of truth (inferred).

### Privacy

- No screen capture, thumbnail or OCR on the card or in history while the owner holds control (Mariner blank playback, ChatGPT agent no screenshots, measured). Cairn already refuses `browser_snapshot` and `computer_observe` then (measured).
- The card shows origin only, and the reason is redacted (measured in `holdTakeover`).

### Code areas

- Server: `apps/server/src/services/machine-computer.ts` (`holdTakeover`: write and update the card row, switch to recorded push), `apps/server/src/services/computer-control.ts` (publish on acquire and release so the card flips), `apps/server/src/services/computer-handoff.ts` (`sweepComputerHandoffs` updates the card), `apps/server/src/services/push.ts` / `push-alerts.ts`. `machine-computer.ts` and `machine*.ts` are security surfaces (CLAUDE.md), so `/security-review` applies.
- Shared: card content schema in `packages/shared/src/protocol/` beside the ask-user content type.
- Web: new `apps/web/src/chief/takeover-card.tsx`, mapped in `apps/web/src/api/mappers.ts` (`collectChiefStream`, skip the `request_takeover` pill like `SUGGEST_REPLIES_TOOL_NAME`) and rendered in `apps/web/src/chief/chief-message-rows.tsx`; screen dialog extracted from `apps/web/src/board/machines-panel.tsx`; `useComputerControl` and `apps/web/src/api/computer-screen.ts` for the lease.
- Feature map row and a page draft first (P2: Coordinator chat is a main surface); references in `docs/design/references/coordinator-chat/`.

## 4. Why no push record was seen for the 2026-11-14 takeover

From code reading (measured unless marked):

1. `pushDelivery` rows are written only when `delivery.required` is true (`apps/server/src/services/push.ts:136-146`). `holdTakeover` calls `pushToUserSafely` (`machine-computer.ts:700`), which always passes `required: false` or no delivery (`push.ts:231-255`). So a takeover push never writes a `push_delivery` row, whether or not it was delivered. The missing row is expected and is not proof that nothing was sent.
2. The outcome is discarded: `pushToUserSafely` fires `sendPushToUser` with `void` and logs only `web push delivery failed` to stderr on failure (`push.ts:193`, `push.ts:253`). A `no-subscription` result (no `push_subscription` row for that user and team, `push.ts:152`) returns silently with no log at all.
3. `vapidKeys` is passed to both the HTTP machine routes (`routes-machine.ts:187`) and the in-server Coordinator (`apps/server/src/index.ts:229`, `startCoordinator` deps), so the `vapid === null` early return is not the cause (inferred from the wiring).
4. The push is skipped on a resumed hold (`if (!resumed)`), and skipped entirely when no `chief:<chiefId>` computer exists (`TAKEOVER_NO_COMPUTER` return before the push) (measured).

Root cause of the observability gap: the takeover push uses the fire-and-forget path that records nothing. Whether it actually reached a device on 2026-11-14 cannot be told from the database; check the server stderr for `web push delivery failed` and the `push_subscription` rows for the owner (guess that no subscription is the likeliest silent case). Fix: send via the recorded path (section 3) and add a test that a `request_takeover` writes one `push_delivery` row with the call's tag; it fails on today's code.
