# Retire the paused Connect DO relay surface

## Intent

#5341 removes the unmounted Connect Durable-Object relay code paused on
2026-11-15 in favor of Tailscale mode: the `connect-lifecycle` /
`connect-store` service modules, the `*Relay*` exports and `relayScope`
plumbing in `browser-session.ts` / `paired-devices.ts`, the two out-of-workspace
prototype directories and their CI jobs, plus the now-unwritable
`browserSession.relayScope` / `pairingGrant.relayScope` columns.

## States and transitions

- `browserSession.relayScope` / `pairingGrant.relayScope` held
  `installationId:generation` for relay-scoped sessions/grants. No production
  path ever wrote a non-null value: `issueBrowserSession`, `issuePairingGrant`,
  `redeemPairingGrant` and `pairFromGrant` were only ever called with the
  default `null` (the relay caller was the unmounted prototype). Migration 0207
  drops both columns; any hypothetically non-null legacy row disappears with
  its column — acceptable because the relay was never deployed and such a row
  could not resolve anyway (no resolver reads it after this change).
- `resolveBrowserSession`, `listPairingGrants` and `redeemPairingGrant` lose
  their `isNull(relayScope)` predicates: with no writer left, every remaining
  row satisfies the predicate, so removing it is a no-op on live data.
- `issueBrowserSession`, `issuePairingGrant` and `pairFromGrant` lose the
  `relayScope` parameter; signatures narrow to what production callers already
  pass.

## Reads/writes after the change

- `browserSession`: resolved by `tokenHash` + `expiresAt` only; written by
  `issueBrowserSession` without `relayScope`.
- `pairingGrant`: issued/redeemed/listed/revoked by `codeHash` + lifecycle
  timestamps only; written without `relayScope`.

## Failure paths

- A pairing code redeemed after this deploy behaves exactly as before for
  normal grants (the only kind that can exist); a stale grant row with
  `revokedAt`/`redeemedAt`/`expiresAt` still cannot be redeemed.
- Dropping the columns mid-flight is safe: no prepared statement references
  `relayScope` after the code change lands, and the migration runs at boot
  before routes serve.

## Tests per path

- Migration test: pre-seed a 0206 snapshot DB with `browserSession` /
  `pairingGrant` rows (including a non-null `relayScope` to prove the drop),
  run migrations, assert both columns are gone and the rows' other fields
  survive.
- Existing suite covers the narrowed paths: session resolve, pairing
  grant issue/redeem/list/revoke and `pairFromGrant` end-to-end.
