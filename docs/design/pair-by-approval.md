# Pair by approval

Status: design before implementation. Replaces the 32-cell code entry on the
token gate with a request/approve flow (prototype direction 3,
`~/Pictures/cairn-review/pairing`, owner pick 2026-11-24). The link/QR grant
path (`POST /api/remote/pairing` → `#pair=` fragment → `POST /api/remote/pair`)
stays as the single fallback.

## The newcomer

Someone who installed Cairn today opens the served app on a second device
(phone on the tailnet, another laptop). The page shows a pairing card with a
large short code and "waiting for approval" — nothing to type. On any device
already signed in (the desktop app hosting the server is always signed in)
they open Settings → Remote access, see the request, compare the code on the
new device's screen with the code in the request, and approve. The new device
signs itself in. If no signed-in device is at hand, they use the existing
pairing link/QR from the Remote access page instead. Nothing is asked of them
beyond reaching the server; the pairing state lives in the server's SQLite
database. When nobody approves within 5 minutes the new device says so and
offers one button to request again.

## Why

The owner's review of the gate: "Pair this computer — why all those input
fields?" and on options 2 vs 3: "I lean toward convenient… the user deploys
this themselves" — a self-hosted install always has a signed-in device (the
desktop), so approval there is cheaper than transcribing a code. Prior art:
the machine-enroll flow in this repo already runs request→poll→confirm
(`/api/machine/enroll/*`); the
number-comparison check is the Bluetooth pairing pattern; Tailscale's device
list is the reference for showing who asked. Rejected alternatives, from the
prototype: direction 1 (paste the whole link — still one field) and direction
2 (8-digit code typed on the new device — an input plus a weaker secret).

## Model

One `pairing_request` row per request:

| Column | Note |
| --- | --- |
| `id` | record id |
| `secretHash` | SHA-256 of the claim secret; the secret itself is returned once at create, held only by the requesting browser, never shown |
| `code` | comparison code, 8 chars from the unambiguous alphabet `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (the machine-enroll alphabet) shown as `XXXX-XXXX`; unique among live requests (regenerated on collision) |
| `name` | requester-reported device name (e.g. `macOS`), max 80 chars |
| `detail` | requester-reported OS/browser hint (e.g. `Chrome 131`), max 120 chars, nullable |
| `source` | server-classified peer: `loopback` / `lan` / `tailnet` / `public` / `unknown` |
| `status` | `pending` · `approved` · `denied` · `consumed` · `superseded` |
| `expiresAt` | pending: createdAt + 5 min (`PAIRING_CODE_TTL_MS`); approve resets it to decidedAt + 2 min (claim window) |
| `createdAt`, `decidedAt` | epoch ms |

Transitions: `pending` → `approved` | `denied` | `superseded` | (expired when
`expiresAt <= now`); `approved` → `consumed` | (expired). `expired` is derived,
not stored; `superseded` is set when the same source creates a newer request.
Every row — pending or decided — is swept on the next create once `createdAt`
leaves the 10-minute rate window: decided rows stay readable to their poller
far past the 2-minute claim grace, and the retained rows are the rate-limit
ledger, so a requester cannot make its own creates uncountable early.

## Wire

Open (unauthenticated; same browser-origin proof as `POST /api/remote/pair` —
`x-cairn-browser-auth: 1`, `sec-fetch-site: same-origin`, matching Origin):

| Route | Contract |
| --- | --- |
| `POST /api/remote/pair/request` | Body `{name, detail?}`. 201 `{id, secret, code, expiresAt}`. 429 over the rate limit, 409 when token auth is off. |
| `POST /api/remote/pair/claim` | Body `{id, secret}`. Poll AND collect: `{status:'pending'}` · `{status:'approved', token, deviceId, environmentId}` (sets the session cookie, marks the request `consumed`) · `{status:'denied'}` · `{status:'expired'}`. Unknown id, wrong secret or already consumed → 404. |

Owner-only (`requireOwner`, and `isOwnerOnlyRoute` covers all methods so a
paired-device credential gets 403 — the requesting device can never approve):

| Route | Contract |
| --- | --- |
| `GET /api/remote/pairing-requests` | Live pending rows `{id, code, name, detail, source, createdAt, expiresAt}`. Secret never leaves the server. |
| `POST /api/remote/pairing-requests/:id/approve` | 200 `{id}`; 404 unknown; 409 already decided or expired. |
| `POST /api/remote/pairing-requests/:id/deny` | Same contract. |

## Every path that reads or writes a request

- `create` (open): sweep dead rows; count the source's requests in the last 10
  min (429 over `PAIRING_REQUEST_RATE_CAP` = 20); supersede that source's other
  live pendings; count live pendings globally (429 over `PAIRING_REQUEST_CAP`
  = 20); insert pending row.
- `claim` (open): read by id; constant-shape 404 for unknown/wrong
  secret/consumed; status check; on `approved`, a guarded UPDATE
  (`status='approved' AND expiresAt>now` → `consumed`) runs inside the
  device+session transaction, so exactly one claim wins.
- `list` (owner): live pendings only.
- `approve`/`deny` (owner): guarded UPDATE `status='pending' AND expiresAt>now`
  — first writer wins, the loser gets 409.
- Sweep on create removes decided and expired rows.

## Requester side

The gate opens on a confirmed signed-out verdict (not during `retrying`) and
creates exactly one request per gate opening: big code, "ask on a signed-in
device", countdown, polls `claim` every 2 s. Approved → the cookie is already
set → session probe closes the gate. Denied → "the other device refused" +
`重新请求`. Expired → `重新请求`. A fragment link still bypasses the gate
(`consumePairFragment`); a dead link ends in the same request flow. The 32-cell
grid, its input and the manual-entry submit are deleted in this change.

## Approver side

A pending-request section on Remote access (polled every 3 s): the code in
large tabular mono, `name · detail · source class · age`, `拒绝` / `批准`, and the
hint to compare the code with the new device's screen — a stranger's request is
recognisable by a code that matches nothing the owner is holding.

## Replay, race, abuse

- Claim is single-use (guarded update; a second claim is 404).
- Approve/deny are single-decision (guarded update; second writer 409).
- Secret = 32 random bytes, hashed at rest; the 40-bit `code` is display-only
  and authorizes nothing — approval is bound to the row, not the code.
- A request that is approved but whose response is lost leaves an orphan
  `paired_device` row, revocable from the device list (same as the grant flow).
- Rate limit per source (peer address class recorded at create): 20 creates
  per 10 min per source (`PAIRING_REQUEST_RATE_CAP`) and 20 live pendings
  total (`PAIRING_REQUEST_CAP`), both 429; a same-source create supersedes
  its own earlier pendings so the owner list stays short.

## Failure behaviour

| Situation | Result |
| --- | --- |
| Token auth off | all four routes 409 |
| Paired device calls approve/deny/list | 403 |
| Unauthenticated owner call | 401 |
| Claim with wrong secret / unknown id / consumed | 404 |
| Pending row past `expiresAt` | claim `expired`; absent from list |
| Device cap reached at claim | 409, request stays `approved`, retryable |
| Create over per-source or global cap | 429 |
| Two approves / two claims racing | exactly one wins |
| Server unreachable at create | gate keeps retrying with backoff |

## Tests (one per path, written failing first)

Server (`remote-access.test.ts` additions): create→list→approve→claim→device
token works; deny→claim denied; double approve/deny 409; claim wrong secret
404; expired pending; supersede on re-request; per-source and global caps;
device-cap claim retry; device-token approve 403; unauthenticated 401; auth
off 409; origin-proof header missing 403; cookie set on claim; secret absent
from owner list. Web e2e (`token-gate-pair-request.spec.ts`, live server):
gate shows the code → owner approves via API → board; deny → denied card →
`重新请求` → new pending request; mocked claim `expired` → expired card. The
32-cell spec (`token-gate-code-cells.spec.ts`) is removed with the grid.
