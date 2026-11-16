# Shared GitHub device transport

This preparatory change adds a storage-free transport for the owner publication connection and the optional writable GitHub MCP connector. It does not activate either integration, change existing OAuth routes, migrate connections or change task identity. The public App registration remains null until its operator supplies the real public client ID and slug. Research: [GitHub identity sources](../research/owner-github-identity-2026-11-16.md).

## Public contract

`apps/server/src/services/github-app-registration.ts` exports `githubAppRegistration: Readonly<{ clientId: string; slug: string }> | null`. Consumers must treat null as unconfigured, make no authorization request, and never fall back to legacy OAuth client-secret configuration or a new environment variable. The connector receives the public client ID through dependency injection.

`apps/server/src/services/github-device-core.ts` exports:

- `requestGithubDeviceCode({ fetch }, clientId)`: returns a private device code, public user code, fixed GitHub verification URL, interval and expiry. The private code remains in the consumer's server-side attempt state.
- `pollGithubDeviceCode({ fetch }, clientId, deviceCode)`: performs exactly one poll. Returns pending, slow_down with an optional interval, expired, denied, failed, or complete. Complete contains the verified GitHub login and positive numeric ID, both tokens, both expiry durations and scope.
- `refreshGithubDeviceToken({ fetch }, clientId, refreshToken)`: returns the complete rotated pair and expiry durations without a client secret. Revoked/expired refresh errors throw HttpError 401; permission errors use 403; evidenced rate limits use 429; unavailable or malformed upstream responses use 502. Error text never includes upstream descriptions or credentials.

Device/token endpoints are fixed to github.com. Identity verification reuses the existing GitHub client and its operator-trusted CAIRN_GITHUB_API_BASE_URL override (api.github.com by default); a token issued on github.com is sent to that configured API base. Each request has a 15-second timeout. Only the fixed verification URL is accepted. The transport imports no database, encryption or connection state, and owns no timers or attempt map.

## Consumer state ownership

Publication and MCP separately own attempts, scheduling, cancellation, encrypted token pairs, connection generations, persistence and refresh arbitration. Starting or disconnecting one connection must not mutate the other's row or attempts. Both grants share upstream App authorization and installation permissions; separate storage does not make them independent revocation scopes.

| Entry | Caller responsibility | Transport regression |
| --- | --- | --- |
| Request code | Require registered client ID; retain device code privately. | Separate codes; trusted URL and public interval. |
| Poll once | Enforce interval and expiry; delete terminal attempts. | Every poll status, including slow_down's optional interval. |
| Complete | Encrypt and atomically persist tokens and both expiries. | Verified user identity and expiring pair; no client secret sent. |
| Refresh | Serialize rotation; CAS and reload a winning same-generation pair. | Rotated pair and old refresh input; no client secret sent. |
| Failure | Classify reconnect versus retry without exposing credentials. | Registration failures and permission versus evidenced rate limit. |

## Release boundary

The transport can merge while unused and registration is null. Full identity v2 must not merge or deploy before live A3 (device-issued App user-token refresh without a client secret) and A4 (repeated connector reconnects retaining the publication grant) pass. Documentation and controlled provider responses are not live acceptance. Remote MCP token acceptance and disconnect isolation also need real validation once the App exists.

Before production wiring, include this core in the repository's security-path manifest, with its matching guidance and manifest-test entries. The inactive extraction does not change those development policies.

No private key or client secret is generated or distributed. Register the App for any account, enable device flow and user-token expiry, disable webhooks, leave callback/setup URLs empty and redirect-on-update unchecked. Installation uses the fixed public App page; the user returns and reloads manually. Permissions remain Contents/Pull requests/Issues read-write and Actions/Checks/Commit statuses/Administration/Metadata read-only, with no account permissions.
