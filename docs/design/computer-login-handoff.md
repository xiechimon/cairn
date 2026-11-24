# Login handoff on the Coordinator computer

Status: proposal for the owner's review. Security surface: `apps/server/src/services/machine-computer.ts`. Scope: logging in only. Prior art: `docs/research/browser-login-handoff-2026-11-13.md`.

Owner decisions (2026-11-13):

- The job board logs in inside the orb browser on the Coordinator computer, scoped to login. This overrides open decision 1 of `docs/design/job-applications.md` for login only.
- Handoff timeout is 15 minutes; then the attempt stops, with no retry.
- The push opens the machine page with the screen enlarged and view-only; the owner presses Take control.

Owner decision (2026-11-14, superseding the push line above; research: `docs/research/takeover-card-2026-11-14.md`):

- `request_takeover` shows a card in the Coordinator conversation: `需要你登录`, the reason, the time left, `接管` and `停止这一步`. The card follows the call: waiting, owner in control (`交还`, `打开画面`), handed back, not finished.
- The push opens the conversation at that card and is sent through `sendMustReachAlert`, so every takeover leaves a `push_delivery` row. It never takes control by itself; pressing `接管` on the card takes control and opens the screen ready to use.
- When this device has no push subscription, the card says so and offers to turn push on.
- The owner wants the agent to fill his password and hand over only for human verification. That ships as a second milestone (M2b below), after this handoff, because it needs its own security-surface change.
- M2b fills a saved login without a per-fill confirmation; the login is bound to one origin and the activity row says "filled from saved login".
- Session persistence for M4: `--restore` with an encryption key the daemon passes only to browser commands, and the agent's shell refuses `.agent-browser/` paths. The residual risk below is accepted until the browser runs as a separate user.

Owner decision (2026-11-15, superseding the session persistence line above):

- Sites such as BOSS Zhipin (zhipin.com) tear down any page driven over CDP, so on takeover the daemon closes the agent browser and opens a plain Chromium without a debugging port on the same desktop, at the agent's last http(s) page. Giving control back stops it, and the agent's next browser call starts the agent browser again.
- Both browsers share one Chromium profile per desktop at `.cairn/browser-profile`, so a login the owner makes is the agent's login too. `--restore` is gone; an old saved session is imported into the profile once. The agent's shell refuses `browser-profile` paths as it does `.agent-browser/`.

## Cloak engine supplement (2026-11-16)

The approved [CloakBrowser adapter design](cloakbrowser-computer.md) replaces system Chromium selection, not this handoff. Automation, the no-debugging owner process and the generated Cairn Dock launcher share the Cloak binary and the existing profile's strict fingerprint identity. Preparation requires a license file; failure removes browser capability without removing desktop or files. Owner transfer checks driver close and profile-lock release; the next agent call observes graceful manual-unit exit and lock release. Owner and Dock use one manual starter and visible-window readiness check. The final launcher refuses an agent-owned live profile rather than forwarding a human window into a debugging session. Native Chrome `--restore-last-session` preserves session cookies; it is not the removed agent-browser `--restore` state-file path. Desktop residency and production-profile cutover remain outside this change; target-site recognition effects require separate acceptance.

## Hover control and the owner browser (2026-11-17)

Owner decision: a pointer on the screen is a control lease, and hover happens all the time, so a plain control lease leaves the agent's browsers alone. Only a control screen opened while the computer has a pending handoff (`handoffReason` set by a login detection or by `request_takeover`) closes the agent's stealth session and opens the owner Cloak without a debugging port. The server marks that screen request `handoff: true`, and only for a daemon that reports the `screenHandoff` capability; an older daemon gets no flag and keeps its old behavior. VM and host desktops follow the same rule.

- A control lease taken before the handoff began does not switch browsers; the owner can still log in through the agent's window, which uses the same profile.
- Debian's xdotool has no `windowquit`, which is why every handback failed with "The owner browser did not close"; the guest now sends `WM_DELETE_WINDOW` itself (see `cairn-browser agent`).
- The control VNC server releases every modifier key when a viewer disconnects, so a key held as the pointer left cannot turn the agent's later typing into shortcuts.
- When a plain `browser_navigate` lands on a page with no interactive elements, the daemon opens the same address in the stealth session and says so in the result. Without a CloakBrowser license it returns the no-license refusal, so the Coordinator posts the license card.

## Explicit take over (2026-11-24)

The screen no longer takes control on hover. A control lease starts only from `接管` in the screen view, the machine row's `接管` during a pending handoff, or the Coordinator's takeover card, and ends with `交还` or by closing the screen. The handoff rule above is unchanged: a control screen opened while a handoff is pending still swaps in the owner browser.

## Goal

When a page in the Coordinator browser needs a login or a human check, the agent stops driving it. The owner gets a card in the conversation and a push that opens it. While the owner holds control, the agent issues no browser action and no screen capture. When the owner gives control back, the agent continues from a fresh snapshot. Passwords, one-time codes and cookies never reach the model.

## Detection (daemon, `apps/daemon/src/computer/browser.ts`)

Harness-side, as Browserbase puts its wait in the tool rather than the prompt. After `open` and on every `snapshot`, the daemon runs one fixed script through `agent-browser eval`; the model cannot change it. `agent-browser snapshot` does not print input `type` or `autocomplete`, so the script is needed. Signals:

- `input[type=password]`, or an `autocomplete` token `current-password`, `new-password`, `one-time-code`, `username`;
- an iframe from a known challenge origin (captcha and slider vendors), or a page whose visible text is a block or verification page.

The result frame carries `loginForm: { signals: string[] }`, and the snapshot text gets one fixed line, `[login form: <signals>]`. The model keeps `request_takeover` for anything the script cannot see, as in Rakazo.

## Gate (server, `machine-computer.ts`)

A new nullable state on `computer`: `handoffReason` (`login` or `model`), `handoffStepId`, `handoffRequestedAt`.

| From | To | Trigger |
|---|---|---|
| none | `login` pending | A browser frame reports `loginForm` |
| none | `model` pending | The agent calls `request_takeover` |
| pending | owner holds control | Owner presses Take control (the existing lease, allowed while `request_takeover` waits) |
| owner holds control | none | Owner presses Give back; `request_takeover` returns "handed back; take a fresh snapshot" |
| pending or held | none, attempt stopped | 15 minutes without Give back, or the turn is stopped; `request_takeover` returns "the owner did not finish; this step is not done; stop and tell the owner". No retry |

While `login` is pending the server refuses `browser_act` `fill`/`type` into a field the last detection marked password or one-time-code, and refuses `browser_navigate`. While the owner holds control it also refuses `browser_snapshot` and screen capture, so a code being typed is never copied into `computer_call`. `request_takeover` waits on the server (there is no daemon handler today) and pushes the owner once.

## Paths that read or write the handoff state

| Path | Reads | Writes | On failure |
|---|---|---|---|
| Browser frame with `loginForm` | computer row | `handoffReason=login` | Frame lost: the next snapshot sets it again |
| `browser_act` / `browser_navigate` | handoff, last detection field kinds | nothing | Refused with a message naming the rule; nothing typed |
| `browser_snapshot` / screen capture | control lease | nothing | Refused while the owner holds control |
| `request_takeover` | handoff, control lease | `model` if none, push sent, call waits | Push fails: the call still waits; the panel shows the pending row |
| Take control (web) | lease | `controlHolder=user` | Unchanged lease rules |
| Give back (web) | lease | `controlHolder=none`, handoff cleared | Stale lease: release with a fresh lease, as today |
| Timeout sweep | `handoffRequestedAt` | handoff cleared, call ends | Server restart: the sweep on start ends overdue calls |
| Coordinator turn stopped | step | handoff cleared | Same as timeout |

## Proof

Red first, on a local test login page served in the orb (password, one-time-code, username and challenge-iframe variants, plus a plain search form as the negative case). Tests fail on `origin/main` for: no `loginForm` frame; a `fill` into the password field accepted; `browser_navigate` accepted while pending; a snapshot accepted while the owner holds control; `request_takeover` returning before Give back.

## M2b: fill a saved password by reference (separate PR, separate review)

Precedent: Grok, Rakazo, Skyvern, Browser Use and agent-browser type a stored password the model never sees. Shape, from Rakazo and Browser Use:

- The owner saves a login (origin, username, password) on an owner-only card; it is a `login` delivery on the existing `secret` rows.
- The model calls `browser_act` `fill_secret {ref, secret, field}`. `computer_call.params` keeps only the names.
- The server resolves the value; the daemon sends it on stdin (`agent-browser batch --json`), never argv. One fixed script checks the origin and the input type in the field's own frame, then types. A hidden value goes only into `type=password`.
- Every result from that computer, shell included, is scrubbed of the value and its URL, form and base64 encodings. `redactSecrets` already accepts known values; `machine-computer.ts` does not pass any today.
- Handoff stays for CAPTCHA, slider, QR scan, passkey and SMS codes.

Residual risk: after the fill and before submit, the value sits in the page on the same computer where the agent has a shell. Scrubbing reduces it; it is not a boundary. Rakazo documents the same limit.

## Residual risk accepted for M4

The agent's shell runs as the same user as the browser, so a determined agent could still read the live session. Full isolation needs the browser under a separate user, which is a later change.
