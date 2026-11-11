# Job applications in the owner's browser

Status: proposal for the owner's review. Nothing here is built. Owner route: a later implementation crosses the machine and command boundary. This page does not change code.

Completes to-do item: Job applications in the browser. The checkbox stays unticked until #3924 merges.

No account names, resume text, or other personal data belong in this repo. The owner names the job board at connect time. This page does not.

## Problem

The owner wants the Coordinator to open postings on a job board, fill forms from a profile he wrote, and submit. A submitted application cannot be withdrawn. Site terms may forbid automation. Credentials must stay in the browser he already logged into, and must never enter the model context.

## What exists

Checked on `origin/main` (`7299c658e`).

`apps/server/src/services/browser-session.ts` is the web auth cookie (`cairn_auth`, kind `owner` or `device`, stream tickets). It does not drive a browser. Do not build this feature on it.

`apps/server/src/services/computer-control.ts` is the desktop takeover lease (`controlHolder` `none` / `bot` / `user`). It is not a submit confirmation.

Browser tools that do exist:

| Piece | Behavior |
|---|---|
| Tools | `browser_navigate`, `browser_snapshot`, `browser_act` in `packages/shared/src/protocol/computer.ts` and `computer-tools.ts`. Acts: click, fill, type, press, hover, select, check, uncheck, scrollintoview. No submit class. |
| Gate | `apps/server/src/services/machine-computer.ts` returns 403 when `computer.browserEnabled` is false or the machine capability `browser` is not true. `browserEnabled` defaults false (`apps/server/src/db/schema.ts`). |
| Who may call | `apps/server/src/services/machine-relay.ts` allows these tools only on a claimed chief step. |
| Where it runs | `apps/daemon/src/computer/browser.ts` runs `agent-browser` with `--session` and `--headed` inside the orb image (`computer.kind` defaults to `orb`; capability comes from `computerImageOffersBrowser` in `apps/daemon/src/orb/computer.ts`). This is not the owner's daily browser. |
| Profile block | `apps/daemon/src/computer/guard.ts` refuses shell that mentions `.browser-profiles` or `--user-data-dir`. The agent cannot point a shell at a Chrome profile. Nothing attaches to one either. |
| Takeover | `acquireExecutionLease` refuses a non-replay-safe call with 409 while the user holds the lease. Snapshot is replay-safe, so it still runs. Navigate and act are not, so they wait. |
| Call log | `computer_call.params` and `resultText` store tool arguments and the snapshot text (`storedParams` truncates strings at 8 KB). A fill's text would be copied there today. |
| Confirm-once | Not built. The class is described in `docs/design/ai-native-actions.md`. `ask_user` stores a question on `chiefMessage` (`apps/server/src/services/chief-questions.ts`) and pushes; that is a question, not a matched submit. |
| Profile store | None. Attachments are message files, not a resume record. |

The computers-panel item that would turn the orb browser on by default is a different switch. This design does not flip `browserEnabled`.

## Recommendation

Do not submit applications through the orb `agent-browser` session. That session has no login the owner already made, and a login typed into it is a second credential store the model can screenshot.

Add a host-browser attach the owner starts on his machine. Cookies and passwords stay in that browser. The tool returns an accessibility tree with password, cookie, and storage values removed before the frame is stored or sent to the model. Navigation is limited to hosts the owner allowed at connect time. The shell guard stays: the agent still cannot read the profile directory.

Until that attach exists, this feature does not ship. Enabling the orb browser is not a substitute.

Submit is not `browser_act`. A new tool, `job_submit`, is the only path that clicks a submit control. It is not replay-safe. An interrupted call is not retried (`machine-computer.ts` already returns the stored result for a non-replay-safe call).

Confirm-once is the same class as `docs/design/ai-native-actions.md`, not a second approval system. Until that registry exists, the gate is this tool: it reads a pending preview the server stored, and it refuses unless the owner answered that preview. The model cannot supply the hash.

There is no profile table. Add `owner_profile`: fields the owner wrote, plus an optional resume attachment id. The agent may read those fields. It may not invent fields, and it may not read a secret to fill a login. A login form stops the attempt and asks the owner to take the lease (`acquireComputerControl`). The agent does not type passwords.

Daily cap is a server counter. Recommended default: 5 delivered submits per UTC day. The agent cannot raise it.

A captcha, a block page, or a host outside the allowlist stops the attempt. No captcha solving, no proxy rotation, no identity evasion, no retry loop.

## State

`job_host`: `proposed`, `allowed`, `refused`. The owner sets this at connect, per host. Default `refused`.

`owner_profile`: owner-authored fields and an optional attachment id. Not a secret. Not third-party text.

`job_attempt`: `idle`, `reading`, `browsing`, `previewed`, `confirming`, `submitting`, `submitted`, `blocked`, `failed`.

`job_preview`: url, field refs, profile field ids, hash. Values are not stored on `computer_call`. The preview row holds the values only until the owner answers or the preview expires, then drops them.

`job_cap`: user, UTC day, count of delivered submits.

Pending confirmation lives on the attempt (`previewHash`, `questionId`), not in the model's claim. The question text is the field list the server built.

## Transitions

| From | To | Who |
|---|---|---|
| `idle` | `reading` | Owner asks to apply. Profile must exist. |
| `reading` | `browsing` | Host is `allowed` and the day's count is under the cap. |
| `browsing` | `previewed` | Snapshot of a form on an allowed host. Hash stored. |
| `previewed` | `confirming` | Server posts `ask_user` with the exact field list. |
| `confirming` | `submitting` | Owner answer matches that question id and the current hash. Cap re-checked. |
| `submitting` | `submitted` | Browser reports the click delivered. Cap increments. |
| `submitting` | `blocked` | Delivery `unknown`. Cap increments (fail closed). No retry of that hash. |
| any active | `blocked` | Captcha, block page, host not allowed, cap reached, machine offline, user holds the lease, login form. |
| `previewed` or `confirming` | `browsing` | Page changed, hash no longer matches. Old preview values deleted. |
| `confirming` | `failed` | Answer does not match the pending hash, or the question expired. |

A second `job_submit` for a hash already `submitted` or `blocked` with unknown delivery is refused.

## Paths that read or write this state

| Path | Reads | Writes | On failure |
|---|---|---|---|
| Host allow (owner only) | `job_host` | `allowed` or `refused` | Agent and MCP face have no write tool. Missing owner acceptance leaves the host `refused`. |
| Profile edit (owner only) | `owner_profile` | fields, attachment id | Empty profile: attempts stay `idle`. Attachment missing: resume id cleared, other fields kept. |
| Read profile (chief tool) | `owner_profile` | nothing | Returns field names and values the owner marked fillable. Omits anything he did not mark. No secrets. |
| Host browser snapshot (new daemon tool, not `browser.ts`) | allowlist, attach the owner started | `computer_call` with redacted tree, attempt `browsing` or `previewed` | Attach down or machine offline: `blocked`, nothing clicked. Password and cookie fields stripped before `resultText` is stored. Off-host URL: refuse, no navigation. |
| Orb `browser_navigate` / `browser_act` | existing gates | existing call log | Unchanged, and not a legal submit path. A job attempt that calls them does not move to `submitting`. |
| Preview build | snapshot, profile | `job_preview` hash and values | Page has a password or payment field: `blocked`, values not stored, owner asked to take the lease. |
| `ask_user` for that preview | preview | `chiefMessage` question, attempt `confirming` | Push failure does not confirm. The question remains until answered or expired. |
| Owner answer | question id, current hash | answer on the question | Mismatch or stale hash: `failed`, no click. |
| `job_submit` | attempt, hash, cap, lease, host | click, then `submitted` and cap, or `blocked` | Cap reached, lease held, hash mismatch, or host no longer `allowed`: refuse before the click, cap unchanged. Delivery unknown: `blocked`, cap incremented, no automatic retry. |
| User takeover (`computer-control.ts`) | lease | lease | While the user holds it, snapshot may run; `job_submit` and fills refuse with the existing 409. |
| Cap read | `job_cap` | nothing until a delivered or unknown submit | Clock skew does not reset the counter early: the key is the UTC day stored on the row, not the model's idea of today. |

`browserEnabled` is not this gate. A host attach has its own owner switch, default off, even if the orb browser is later on by default.

## Page text is data

A posting is third-party text. The snapshot that reaches the model uses the same fence rule as `docs/design/mail-connector.md`: fenced, omitted from `shortEvent`, rejected by `validateMemoryText`. Instructions on the page are not followed. The agent does not pass page text to shell or to `get_secret`.

Filled values come only from profile field ids in the preview. The model does not get to add a field at submit time.

## Risks

- Host attach can see every site open in that browser. The allowlist is the bound. Implementation touches the daemon command boundary (`apps/daemon/src/backend/command-gate.ts` if the attach is a spawned command, and `apps/server/src/services/machine*.ts` for the relay). Owner-routed.
- Anti-automation (captchas, rate limits, account flags) is the site's defense. This design does not defeat it. A block page stops. The owner decides whether using the feature violates that site's terms; the default is not to try.
- `computer_call` is a second copy of anything the tool returns. Redaction has to happen before the frame is posted, not in the prompt.
- Confirm-once that trusts the model's hash is not a confirmation. The server compares the stored preview to the owner answer.
- An unknown click may have submitted. Counting it and refusing a retry is the conservative cap. The owner can look at the board himself.

## Open decisions for the owner

1. Host attach (recommended) versus logging in once inside the orb browser. Orb login does not meet "credentials stay in the owner's browser". Do not ship that fallback without an explicit override.
2. Daily cap. Recommended default 5 delivered submits per UTC day, owner-editable, agent-immutable.
3. Per-host terms acceptance. Recommended: `refused` until the owner allows that host, with the terms risk stated on that screen. No global allow.
4. Whether `job_submit` waits for the action-registry confirm-once, or ships the interim gate above. Recommended: interim gate now, same function called by the registry later, so there is still one mechanism.
