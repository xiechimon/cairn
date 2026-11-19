# GitHub webhook intake (seq 32)

One page: states, transitions, every reader/writer, failure behavior.

## Goal

A GitHub `issues` webhook delivery lands a todo through the same
`importGithubIssue` path the five-minute poller uses. Polling stays as
fallback and as the reconcile loop; the webhook only accelerates.

## Token and state

`github_connection` is per-team (teamId PK). The webhook token
authenticates the team; the delivery's `repository.full_name` picks the
project via `project.githubRepo` — the same mapping the pre-#1796 webhook
used.

New columns on `github_connection` (same shape as `schedule`'s seq-31
webhook columns):

- `webhookTokenHash text` — sha256 hex of the token, unique index. `null`
  = no webhook configured (polling only).
- `webhookMasked text` — `cairn-wh-XXXX…YYYY` for display.
- `webhookDeliveries json text[]` — bounded history of the last 50
  delivery ids for dedup.
- `webhookLastUsedAt integer` — audit.

Minting reuses `lib/webhook-token.ts` (`newScheduleWebhookToken` →
rename-neutral helpers `newWebhookToken`/`webhookSecretOf`/`webhookTokenMatches`;
the schedule call sites move to the neutral names). The plaintext is
returned once at mint time and never stored.

Token lifecycle: `POST /api/teams/:id/github/webhook` (owner) mints or
rotates — rotation overwrites hash+masked and clears deliveries so old
delivery ids cannot suppress a fresh import. `DELETE` removes the token
(hash, masked, deliveries, lastUsedAt → null). `GET` on the connection
record already exposes masked + lastUsedAt only.

## Endpoint

`POST /api/webhook/github/:token` — auth-exempt by path prefix in
`token-auth.ts` (`/api/webhook/` is already a non-member-write prefix in
`autonomy-gates.ts`, so deliveries cannot starve the quiet window).

Reads `X-GitHub-Event`, `X-GitHub-Delivery` (fall back to
`x-cairn-delivery`), and the JSON body (`action`, `issue.number`,
`label.name`, `repository.full_name`, `sender.login`).

Answers `202` for every known token:

- `created` — issue imported, `{ todoId, threadId, deliveryId }`.
- `duplicate` — delivery id already in `webhookDeliveries`, or the
  sourceRef `github:owner/repo#N` already exists (caught by
  `importGithubIssue`'s 409 → reported as duplicate, not an error).
- `ignored` — ping event, non-`issues` event, action other than
  `labeled`, label other than the intake label, the intake label absent
  from the fetched issue, missing/malformed sender, sender below triage
  permission, or the project is at the in-flight cap. Sender-permission
  refusals carry a generic detail; other checks report their reason so
  the delivery log on the GitHub side stays debuggable — the detail is
  visible only to whoever already holds the unguessable URL.
- `misconfigured` — no project binds `repository.full_name`, or the
  team's GitHub connection cannot produce a read token.

Unknown token → `401` with a generic body (constant-time compare on the
hash; no probing of valid tokens).

## Import path

On `issues` + `labeled` + intake label (`ready-for-agent`):

1. Token lookup by hash (unique index) → `github_connection` row → team.
2. Dedup: delivery id in `webhookDeliveries` → `duplicate`.
3. Sender triage: reuse `hasRepoTriage` (shared 15-min cache with the
   poller) with `githubReadToken`/`autonomousToken`.
4. Cap: reuse `projectAtInFlightCap`.
5. `importGithubIssue(deps, projectRow, issue.number, { createdBy })`
   then `orchestrateTodo` — identical to the poller, so the poller's
   own 409 backstop dedupes webhook-vs-poller races both directions.
6. Record the delivery id (bounded to 50) + `webhookLastUsedAt` in the
   same transaction that marks the row consumed.

## Races and failures

- Webhook then poller: the sourceRef 409 makes the second import a
  `duplicate`/logged `claimed`; no double todo.
- Concurrent same-issue deliveries: `importsInFlight` map + 409.
- Team token rotated mid-delivery: lookup is by hash; a rotated-out
  token gets 401 on the next delivery.
- Sender permission check fails (network/5xx): `ignored` with reason
  `permission-unreadable` in logs; the poller picks the issue up on its
  next sweep — the webhook is an accelerator, never the only path.
- `misconfigured` is reported but the delivery id is still recorded, so
  GitHub's redelivery retries do not spam the log; a fixed
  configuration plus a manual redelivery still works because a *new*
  delivery id replays the checks.

## Tests (red-first)

- Token mint → masked shown, plaintext once, hash persisted.
- `issues/labeled` + label → 202 `created`, todo row + step enqueued.
- Same `X-GitHub-Delivery` → 202 `duplicate`.
- New delivery id, same issue (poller already imported) → 202
  `duplicate` via sourceRef.
- `ping`, wrong label, `unlabeled`, no sender → 202 `ignored`.
- Unknown token → 401; rotated token → old 401 / new works.
- No repo match → 202 `misconfigured`.
- Quiet window: `countsAsMemberWrite` stays false (already asserted).
- `retired-zero-use` and REST vocabulary updated for the new path.
