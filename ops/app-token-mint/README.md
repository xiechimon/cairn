# Host-side GitHub App token mint

Implements segment 1 of the [identity split research](../../docs/research/bot-identity-and-coauthorship-2026-11-07.md).
The server receives short-lived installation tokens; the RSA private key stays in a host file and is never read by the server or stored in its database. This directory is outside the pnpm workspace and has no dependencies. Use Node 22.19 or later.

## Configuration

The script reads its JSON config from its first argument, then `CAIRN_APP_TOKEN_MINT_CONFIG`, then `~/.cairn/cairn-bot.json`.

```json
{
  "appId": "123",
  "installationId": 456,
  "privateKeyPath": "/absolute/path/to/app.pem",
  "socketPath": "/absolute/path/to/app-token.sock"
}
```

Use the existing host App key, owned by the service user with mode `0600`. No key migration or database storage is required. Symbolic links, non-regular keys, keys owned by another user, and group/world permissions are rejected. The socket directory must be owned by the service user and not writable by other users.

`socketPath` is optional: it takes precedence over `CAIRN_APP_TOKEN_SOCKET`, whose default is `~/.cairn/run/app-token.sock`. Paths in JSON are literal absolute paths; shell tilde expansion does not apply. Set `CAIRN_APP_TOKEN_SOCKET` on the cairn server to the same socket path to enable the provider. An unset server setting leaves the feature off. The provider only supplies tokens: the commit author comes from `CAIRN_GITHUB_APP_SLUG` and `CAIRN_GITHUB_APP_BOT_ID`, which the server requires alongside the socket.

## Run

```sh
node ops/app-token-mint/mint.mjs /absolute/path/to/config.json
node --test ops/app-token-mint/mint.test.mjs
```

The service opens only a Unix socket, with mode `0600`. A regular file or an answering socket at that path blocks startup; only a non-answering socket owned by the service user is removed. A failed or timed-out probe never authorizes removal.

`GET /health` returns `{"ok":true}`. A scoped `GET /token` returns `token`, `expiresAt`, `installationId` and `appSlug`. These responses use `Cache-Control: no-store`. Do not print, journal or archive `/token` responses. The slug is obtained from GitHub's authenticated `GET /app`, not assumed from the config. JWTs use RS256, a 60-second backdate and a nine-minute expiry. The installation token cache expires five minutes early. Concurrent requests share an exchange.

Every scoped request supplies `repository=<name>`, `owner=<owner>`, and `permissions=<name:level,...>`. The latter is a comma-separated list of `name:read` or `name:write` entries sent as the `permissions` object to `POST /app/installations/{id}/access_tokens`. Runner requests also supply `repository_id=<id>`, the positive, immutable GitHub repository ID pinned at claim time. The mint sends `repository_ids: [id]` for an ID-scoped request; the name and owner are not used to select the repository. Server-side calls without an ID use `repositories: [name]` instead. Missing required, malformed or repeated scope parameters return `400` without an exchange.

The response must grant exactly the requested permissions and describe exactly one repository. For an ID-scoped request, the mint verifies GitHub's repository ID and echoes it as `repositoryId`, with GitHub's full repository name in `repositories`. The server checks both against the claim, including when it reuses a cached token. Case-only differences are allowed. If the name from an ordinary fetch does not match, the server forces one fresh exchange before deciding. If the fresh response still matches the ID but not the name, the server refuses the token with `GitHub repository was renamed; reconnect it.` For a name-scoped request, both verify the `repositories` echo against `owner/name`.

Both caches key grants by the requested `owner/name` (case-insensitive), the repository ID when supplied, and the exact permissions. Ordinary runner fetches reuse a still-valid server cache entry or respect the brief `repo-not-installed` backoff. A matching cache hit does not fetch current repository metadata from GitHub. Forced refresh bypasses both caches for that scope and replaces their entries on success; a token no longer valid long enough is renewed.

Rollout order: deploy the server before this mint. A server version that still requests a bare `/token` receives `400` for every call, so the scoped-credential guarantee holds only once no caller depends on unscoped mints; drain old server instances and existing claims before relying on it. Upgrade daemons together with the server and this service: the step-token endpoint requires the `generation` claim parameter that only current daemons send, so an older daemon's claims fail the generation fence.

At claim time the server resolves the repository ID with its App read grant or the team's OAuth connection. If neither can supply a read credential, the server records a step failure and the claim request returns `503` without a claim. Lookup errors such as a timeout or rate limit fail the pending step with a lookup error, also without dispatching it. If the lookup returns no usable ID, the step-token endpoint refuses to mint and returns `503`.

After a claim, clone, push and credential refresh receive GitHub credentials only from the scoped mint. If minting is unavailable, the step-token endpoint returns `503`; the daemon reports `GitHub App token service unavailable` on initial fetch or when a Git operation requires a refresh. A failed background refresh leaves the current credential in place. The team's OAuth grant is never handed to a runner: an OAuth-only team retains the repo picker and server reads but cannot run GitHub-bound steps until the scoped mint is available.

An App request rejected with HTTP 401 uses `GET /token` with `x-cairn-refresh: 1` for one fresh exchange in the same scope. A runner refresh uses the pinned ID again. Neither the provider nor the mint relists installation membership; GitHub validates the requested repository during the exchange. The App request uses a separate fetch path and never enters the OAuth refresh wrapper. The server provider returns null on failure and reports `{reason, owner, repo}` (with `repositoryId` when supplied) through its optional `onReason` callback (`app-token-unconfigured`, `app-token-unavailable`, `repo-not-installed`, or `repo-renamed`). New write modules must import branded providers; today's legacy importers are explicitly frozen in `biome.json` until segment 2 migrates them.

Only `/token` intentionally returns the installation token. Health/error responses and stdout/stderr never include it, the JWT or private key. Exchange errors contain GitHub's status and sanitized message; network and startup errors use fixed messages. No request or response body is logged.

## systemd user service

Copy `cairn-app-token-mint.service` to the user's systemd unit directory on the host. Adjust its absolute `ExecStart` Node/script paths and configuration path for the deployment, then reload and enable the unit. The example uses `%h/Code/cairn` as the checkout. Node must be an absolute executable path available outside an interactive shell. The service must run as the same user as cairn: the socket is intentionally inaccessible to other users. This change supplies the unit but does not install or start it.

Outbound HTTPS access to `api.github.com:443` is required. No TCP listener, inbound network port or private key transfer is needed. Merges and explicit user actions remain on the user token. The service does not modify the App installation's permissions.
