# Team GitHub connection through device flow

The team GitHub connection (`github_connection`, one row per team) backs the new-project repository picker, server-side GitHub reads and the credential sent to task steps. Until now only the authorization-code flow wrote it, and that flow needs an operator-registered OAuth client and secret. This change lets the same row be written by device flow on the shared public GitHub App ([github-device-core.md](./github-device-core.md)), so a fresh self-hosted installation connects with no server configuration. It is active only while `githubAppRegistration` is non-null.

## States of a row

| State | `appClientId` | `connectionGeneration` | Refresh path |
| --- | --- | --- | --- |
| Absent | - | - | none; readers report `no-github-connection` |
| Legacy OAuth | null | null | client secret refresh through the configured OAuth client (unchanged) |
| Device grant | the App client ID that issued it | random id per completed sign-in | `refreshGithubDeviceToken` with the stored client ID, no secret |
| Disconnected | any | any | none; `disconnectedReason` set, readers report `github-disconnected` |

The legacy upsert now clears `appClientId`, `connectionGeneration` and `refreshTokenExpiresAt`, so a legacy reconnect never refreshes through the device path with a legacy token, and a device completion sets all three.

## Transitions and their writers

- Start (`POST /api/teams/:id/github/connection/device`): requires a registration, else 400 with no GitHub request. Requests a device code; the private device code lives only in the server's in-memory attempt map (`githubConnectionDeviceStates`, separate from the MCP connector's attempts), keyed by a random attempt id and bound to team and user. A new start for the team drops that team's older attempts. Returns the public user code, the fixed `https://github.com/login/device` URL, interval and expiry.
- Poll (`POST .../device/:attempt`): one GitHub poll at most per interval; earlier calls return pending without a request. `slow_down` widens the interval. Expired, denied and failed delete the attempt. Complete deletes the attempt and upserts the row as a device grant (tokens sealed with the secret box, both expiries, verified login and numeric id, new generation). An attempt owned by another team or user is 404.
- Cancel (`DELETE .../device/:attempt`): deletes the attempt.
- Refresh (any reader of the team token when the access token is within 60s of expiry, and `refreshingGithubFetch` after a 401): serialized per team by the existing in-process chain. A device row refreshes with its own client ID. The rotated pair is saved only where team and generation still match; if a newer sign-in replaced the row meanwhile, the refresh result is dropped and the reader gets the new row's token. A 401 from GitHub (revoked or expired refresh token) marks the row disconnected, again only for the same generation. Rate limits and outages keep the row and return the stale token, so a transient failure does not force a reconnect. A legacy client-secret refresh writes its tokens or its failure only while the row is still legacy (`appClientId` null), so a device sign-in that lands during it is kept.
- Disconnect (`DELETE /api/teams/:id/github/connection`): unchanged, deletes the row. It does not touch MCP connector grants, and MCP reconnects do not touch this row; both share the upstream App authorization, so revoking the App on GitHub ends both.

## Failure behavior

Start without registration: 400, and the web never offers the button because `/api/capabilities` reports `githubDeviceInstallUrl: null`. Upstream errors map to 4xx/5xx with fixed text from the core; no upstream description or credential reaches the response or the logs. The web shows plain sentences and never a server message.

## Tests, one per path

Server: start without registration, start and poll pending within the interval, slow_down, denied, expired, complete writes a device row and the legacy upsert clears it, cross-team or cross-user poll is 404, cancel, refresh with the stored client id and no secret, refresh losing to a newer generation, refresh 401 disconnects, refresh 502 keeps the row. Web: the auth button opens the code dialog when the capability is present and the picker opens after completion.

## Release boundary

The code can merge with the registration null. Filling the registration is the activation step and waits for live A3 (refresh of a device-issued token without a secret) and A4 (repeated MCP connector reconnects keep this row's grant) on a real App, per the device-core release boundary.
