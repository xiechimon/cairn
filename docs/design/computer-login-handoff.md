# Login handoff on the Coordinator computer

Status: proposal for the owner's review. Security surface: `apps/server/src/services/machine-computer.ts`. Scope: logging in only. Nothing here submits a form other than the one login step the owner performs.

Owner decision (2026-11-13): the job board logs in inside the orb browser on the Coordinator computer, scoped to login. This overrides open decision 1 of `docs/design/job-applications.md` for login only.

## Goal

When a page in the Coordinator browser shows a login form, the agent stops driving it. The owner gets a push saying a login is needed, which opens the live screen. While the owner holds control, the agent issues no browser action. When the owner gives control back, the agent continues from a fresh snapshot. Passwords, one-time codes and cookies never reach the model.

## Detection (daemon, `apps/daemon/src/computer/browser.ts`)

After `open` and on every `snapshot`, the daemon runs one fixed script through `agent-browser eval`. The script reads only the live DOM and returns which login signals are visible: `input[type=password]`, an `autocomplete` token of `current-password`, `new-password`, `one-time-code` or `username`. The model cannot change the script. The result frame carries `loginForm: { signals: string[] }`. The snapshot text gets one fixed line, `[login form: <signals>]`.

## Gate (server, `machine-computer.ts`)

A new nullable state on `computer`: `handoffReason` (`login`), `handoffStepId`, `handoffRequestedAt`.

| From | To | Trigger |
|---|---|---|
| none | `login` pending | A browser frame reports `loginForm` |
| `login` pending | owner holds control | Owner presses Take control (the existing lease, allowed while `request_takeover` runs) |
| owner holds control | none | Owner presses Give back; the waiting `request_takeover` returns "handed back, take a fresh snapshot" |
| `login` pending | none, attempt stopped | 15 minutes without Give back; `request_takeover` returns "the owner did not finish; stop and tell the owner". No retry |

While `login` is pending, the server refuses `browser_act` `fill`/`type` into a field the last snapshot marked password or one-time-code, and refuses `browser_navigate` away from the page. `browser_snapshot` stays allowed. The agent then calls `request_takeover` (already in the tool enum; the lease code already lets the owner take control while it runs), which pushes the owner and waits.

## Paths that read or write the handoff state

| Path | Reads | Writes | On failure |
|---|---|---|---|
| Browser frame with `loginForm` | computer row | `handoffReason=login` | Frame lost: next snapshot sets it again |
| `browser_act` / `browser_navigate` | handoff, last snapshot field kinds | nothing | Refused with a message naming the rule; nothing typed |
| `request_takeover` | handoff, control lease | push sent, call waits | Push fails: call still waits; owner sees the pending row in the panel |
| Take control (web) | lease | `controlHolder=user` | Unchanged lease rules |
| Give back (web) | lease | `controlHolder=none`, handoff cleared | Stale lease: release with a fresh lease, as today |
| Timeout sweep | `handoffRequestedAt` | handoff cleared, call ends | Server restart: sweep on start ends overdue calls |
| Coordinator turn stopped | step | handoff cleared | Same as timeout |

## Proof

Red first: a local test login page (password, one-time-code and username variants, plus a plain search form as the negative case) served in the orb. Tests fail on `origin/main` for: no `loginForm` frame; a `fill` into the password field accepted; `browser_navigate` accepted while pending; `request_takeover` returning before Give back.

## Decisions for the owner

1. Before handing off, may the agent fill non-secret fields you named in your message (the phone number) and press the send-code button? Recommended: yes. Password and one-time-code fields stay refused, and the agent must call `request_takeover` before the code is needed. Without this, M4 stops before the code is sent.
2. Handoff timeout. Recommended: 15 minutes, then stop without retry.
3. Push target. Recommended: the machine page with the screen enlarged in view-only mode; you press Take control yourself.
