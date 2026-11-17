# Loopback-only GitHub OAuth base and the fake's auth surface

Until now every `github.com/login/*` endpoint was a constant: the device flow in `github-device-core.ts` and the legacy OAuth `authorize`/`access_token` URLs in `GITHUB_CONNECTION_OAUTH` and the `github` provider family. The REST surface already has the operator-trusted `CAIRN_GITHUB_API_BASE_URL` seam and a loopback emulator recipe, but the auth surface had no seam, so auth tests hand-script reply queues and live auth journeys could only run against real GitHub. This change adds a deliberately narrower seam for OAuth endpoints and grows the repository's fake GitHub to cover the auth surface, so tests and verify-cairn can drive authorization without GitHub.

## The seam

`CAIRN_GITHUB_OAUTH_BASE_URL`, read by `githubOauthBaseUrl()` in `lib/github-oauth-base.ts` (sibling of `github-api-base.ts`).

- Unset or empty: `https://github.com`. Production behavior is unchanged.
- Set: must be `http:` loopback — hostname `127.0.0.1`, `[::1]` or `localhost` — with an optional path prefix. Credentials, query, fragment and every non-loopback host are rejected, including `https:`. Unlike the API base this is not an operator knob: it exists only so a loopback fake can stand in for GitHub during tests and verification, and the loopback restriction keeps that guarantee structural rather than documented. A grant can never be redirected to a remote host by configuration.
- `githubOauthEndpoints()` derives the four consumers' URLs from the base: `/login/device`, `/login/device/code`, `/login/oauth/authorize`, `/login/oauth/access_token`. `github.com/login/device` remains the only accepted verification URI — under an override, the fake must return the URI under the override base, so the pinning check keeps its meaning.

## Readers and writers

- `github-device-core.ts`: the three constants become endpoint lookups. Both device consumers (team connection, MCP connector) follow.
- `oauth.ts`: `issueAuthorize` and `exchangeToken` receive `authorizeUrl`/`tokenUrl`; when the target URL is under `https://github.com` it is rewritten onto the OAuth base. This covers `GITHUB_CONNECTION_OAUTH` and the `github` provider family uniformly; arbitrary third-party connector URLs (MCP OAuth) are untouched because they are not under github.com.
- `github-connection.ts` legacy refresh: `refreshOAuthAccessToken` is called with `GITHUB_CONNECTION_OAUTH.tokenUrl`; the call site resolves it through the same rewrite so a device-faked stack can also exercise refresh — but note refresh of a *legacy OAuth* row needs a configured client secret, which faking does not provide. Device-grant refresh (`/login/oauth/access_token` with `grant_type=refresh_token`) goes through `github-device-core.ts` and is covered.
- `skill-import.ts`: `GH_API_BASE` is the same bug class on the API side; it now reads `githubApiBaseUrl()`.
- The web never builds these URLs: the device dialog opens `verificationUri` from the server, and OAuth authorize redirects come from the server response. Both follow the base automatically.

## The fake's auth surface

`test/fakes/github.ts` already fakes the REST surface behind `FetchLike`. It grows a second surface speaking the OAuth wire protocol, keeping the same style: state lives in the fake, tests drive semantic events instead of response bodies.

State: `users` (id → login/name), `deviceCodes` (deviceCode → userCode, status pending/approved/denied, userId, expiry), `grants` (accessToken → userId, refreshToken, revoked), `installations` (login → installed repos). Semantic controls: `approveDevice(userCode, login)`, `denyDevice(userCode)`, `revokeToken(accessToken)`, `expireAccess(accessToken)`.

Endpoints served, as `FetchLike` and as a loopback HTTP server for verify-cairn:

- `POST /login/device/code` → new pending code pair, `verification_uri` under the served base.
- `POST /login/oauth/access_token` → `device_code` grant (pending → slow_down → complete with rotated refresh pair, denied, expired_token), `refresh_token` grant (rotates, `bad_refresh_token` after revoke), `authorization_code` grant for the legacy web flow.
- `GET /login/device` → a minimal page that accepts the user code and approves, so browser journeys exercise the real click path.
- `GET /user`, `GET /user/installations`, `GET /user/repos` under the API surface: the identity trio the auth flow and repo picker need, keyed by the bearer the fake issued. Deeper REST (issues, pulls) stays on the existing REST fake or the emulate.dev recipe.

## Failure behavior, one test per path

- Base unset → `https://github.com`; loopback `http` accepted incl. `[::1]` and `localhost`; https, non-loopback, creds, query, hash rejected.
- Device: pending within interval, slow_down widens, denied, expired, complete writes the row (existing tests migrate from `scripted()` to the fake); verification_uri outside the served base rejected; identity fetch failure → 502 unchanged.
- Refresh: rotation returns the new pair; revoked refresh → 401 → row disconnected; revoked access on `/user` → 401.
- Legacy OAuth: authorize URL follows the base; `authorization_code` exchange completes the connection; provider-family github URLs rewrite, non-GitHub families do not.
- `skill-import` reads the API base (same class).

## Boundaries

- No production behavior change with the env unset; the loopback rule makes a remote redirect inexpressible.
- Tokens minted by the fake are synthetic (`ghu_fake_*`); a fake stack must never hold a real token — same rule as the emulator recipe.
- Real-GitHub checks (the release-boundary A3/A4 probes) stay: the fake proves our handling of the protocol, never GitHub's side of it.
- `github-emulator` recipe coverage line updated to name OAuth/device coverage; MCP connector OAuth to non-GitHub providers remains uncovered as before.
