# Login handoff on the Coordinator computer

Status: proposal for the owner's review. Security surface: `apps/server/src/services/machine-computer.ts`. Scope: logging in only. Prior art: `docs/research/browser-login-handoff-2026-11-13.md`.

Owner decisions (2026-11-13):

- The job board logs in inside the orb browser on the Coordinator computer, scoped to login. This overrides open decision 1 of `docs/design/job-applications.md` for login only.
- Handoff timeout is 15 minutes; then the attempt stops, with no retry.
- The push opens the machine page with the screen enlarged and view-only; the owner presses Take control.
- The owner wants the agent to fill his password and hand over only for human verification. That ships as a second milestone (M2b below), after this handoff, because it needs its own security-surface change.
- M2b fills a saved login without a per-fill confirmation; the login is bound to one origin and the activity row says "filled from saved login".
- Session persistence for M4: `--restore` with an encryption key the daemon passes only to browser commands, and the agent's shell refuses `.agent-browser/` paths. The residual risk below is accepted until the browser runs as a separate user.

## Goal

When a page in the Coordinator browser needs a login or a human check, the agent stops driving it. The owner gets a push that opens the live screen. While the owner holds control, the agent issues no browser action and no screen capture. When the owner gives control back, the agent continues from a fresh snapshot. Passwords, one-time codes and cookies never reach the model.

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
