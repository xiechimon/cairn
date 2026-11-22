# In-chat secret card (`request_secret`)

Issue #5384. Replaces the CloakBrowser-only `request_cloak_license` tool and card with one generic tool and card. The CloakBrowser license becomes one use of it.

## Newcomer

Someone who installed Cairn today asks the Coordinator to set up a service that needs an API key. The Coordinator posts a card in the chat: the secret name, a sentence on what it is for, and whether it is saved for the whole team or one project. The person pastes the value and presses Save, or presses Not now. The value is sealed into the secret store (Settings → Secrets lists it afterwards) and never shows in the chat, the Coordinator's context, logs or traces. Nothing else is asked of them: no account, payment or key beyond the value itself.

| Situation | What they see | What the system does | Wait and cost |
|---|---|---|---|
| Pastes and saves | Card turns into a one-line `Saved as team secret NAME` history line | Upserts the secret, the tool returns `saved` to the Coordinator, which continues | Turn holds until they answer, at most 15 minutes |
| Presses Not now | History line `Not provided` | Tool returns `cancelled`; the Coordinator is told not to ask again unless asked | None |
| Ignores it, or the turn is stopped | History line `Request ended` | Hold ends at the deadline or when the step leaves `claimed`; tool returns `not saved` | 15 minutes at most |
| Saves after the hold ended | Inline error `This request has ended` | Save endpoint answers 409; nothing is written | None |
| A paired phone (not the owner) saves | Inline error `Only the owner can save` | 403; nothing is written | None |
| The name already exists in that scope | Footer says the value is replaced | `updateSecret` keeps the row's delivery policy and bumps `policyRevision` | None |

## Tool protocol

`request_secret({ name, scope: 'team' | 'project', projectId?, description })`, offered to every Coordinator turn (in-server runtime and Runner claim, one definition in `packages/shared/src/protocol/secret-request.ts`). Restricted turns (mail, memory edit, report) refuse it through their allowlists, so external content cannot make the Coordinator phish for a secret.

Parameter checks happen before any wait: `name` matches `SECRET_NAME_PATTERN`; `scope: 'project'` needs a `projectId` of a listed project of the team; `description` is 1 to 300 characters. A refusal returns a `request_secret refused: …` text at once.

Results (constants in the shared module; the web card keys its state on them):

- `SECRET_REQUEST_SAVED` — the owner saved it.
- `SECRET_REQUEST_CANCELLED` — the owner declined.
- `SECRET_REQUEST_NOT_SAVED` — deadline, turn stopped, aborted.

No result, parameter or transcript row ever carries the value. The value travels only in the owner's HTTP body to the save endpoint.

## States

A request lives only while its tool call holds: `pending` → `saved` | `cancelled` | `ended`. The waiting set is in-process (`apps/server/src/services/secret-requests.ts`): one entry per holding call, keyed by team, project (or null) and name. No new table: the only persisted write is the existing `secret` row. A server restart drops the entries and fails the relayed call, which the card shows as ended; the Coordinator may ask again.

## Paths that read or write

| Path | Reads | Writes |
|---|---|---|
| `executeRelayToolCall` → `holdSecretRequest` | step status, project | adds and removes a waiting entry |
| `POST /api/teams/:id/secret-requests` `{decision:'save', name, projectId, value}` | waiting entries, existing secret row | `createSecret` or `updateSecret` (value only), marks every matching entry saved |
| same route `{decision:'cancel', name, projectId}` | waiting entries | marks matching entries cancelled |
| web `mapChiefStream` | tool call args and result text | nothing |

The route requires the owner session (as the CloakBrowser route did), answers `Cache-Control: no-store`, returns only `{ name }` and never echoes the value in a validation error. With no matching entry it answers 409 and writes nothing, so the route cannot be used as a second secret API.

## Failures

- Save fails validation (empty, over 4096 characters, control character): 400, card keeps the input and says what to fix.
- Save fails in `createSecret` (for example a name that collides with a reserved secret): the route's error maps to the card's generic failure line; the hold keeps waiting.
- Two threads waiting on the same name and scope: one save answers both.
- Hold ends between the owner pressing Save and the request arriving: 409, `This request has ended`.

## Migration

The stealth-browser refusal text now names `request_secret` with `CLOAKBROWSER_LICENSE_KEY` and scope team. `request_cloak_license`, its route `PUT /api/teams/:id/cloak-license`, `cloak-license.ts`, the CloakBrowser card and the `vmBrowser` tool-offer flag (which existed only to offer that tool) are deleted in the same change. `teamHasVmComputer` moves to `services/vm-computer.ts`.

## Tests

- `apps/server/test/coordinator/secret-request.test.ts`: an in-server Coordinator turn calls `request_secret`, the owner saves a sentinel through the route; the sentinel is absent from the model messages of the next request, every table row and every log line, and the stored cipher opens to it.
- `apps/server/test/secret-request.test.ts`: route auth, validation without echo, 409 with no request, cancel, deadline and stopped turn, project scope.
- `apps/web/test/chief-secret-request-card.test.ts`: the stream maps pending, saved, cancelled and failed.
- `apps/web/e2e/chief-secret-request-card.spec.ts`: the rendered card in each state.
