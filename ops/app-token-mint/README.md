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

`GET /health` returns `{"ok":true}`. `GET /token` returns `token`, `expiresAt`, `installationId` and `appSlug`. These responses use `Cache-Control: no-store`. Do not print, journal or archive `/token` responses. The slug is obtained from GitHub's authenticated `GET /app`, not assumed from the config. JWTs use RS256, a 60-second backdate and a nine-minute expiry. The installation token cache expires five minutes early. Concurrent requests share an exchange.

An App request rejected with HTTP 401 uses `GET /token` with `x-cairn-refresh: 1` to invalidate the mint cache once. The provider rechecks installation repository membership, including paginated results, before retrying. It uses a separate fetch path and never enters the OAuth refresh wrapper. The server provider returns null on failure and reports `{reason, owner, repo}` through its optional `onReason` callback (`app-token-unconfigured`, `app-token-unavailable`, or `repo-not-installed`). Keep its dependency object stable to reuse the in-memory token/membership cache. New write modules must import branded providers; today's legacy importers are explicitly frozen in `biome.json` until segment 2 migrates them.

Only `/token` intentionally returns the installation token. Health/error responses and stdout/stderr never include it, the JWT or private key. Exchange errors contain GitHub's status and sanitized message; network and startup errors use fixed messages. No request or response body is logged.

## systemd user service

Copy `cairn-app-token-mint.service` to the user's systemd unit directory on the host. Adjust its absolute `ExecStart` Node/script paths and configuration path for the deployment, then reload and enable the unit. The example uses `%h/Code/cairn` as the checkout. Node must be an absolute executable path available outside an interactive shell. The service must run as the same user as cairn: the socket is intentionally inaccessible to other users. This change supplies the unit but does not install or start it.

Outbound HTTPS access to `api.github.com:443` is required. No TCP listener, inbound network port or private key transfer is needed. Merges and explicit user actions remain on the user token. The service does not modify the App installation's permissions.
