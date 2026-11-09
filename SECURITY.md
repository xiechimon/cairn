# Security policy

## Supported versions

Cairn is pre-1.0. Only the latest published release of each package gets security fixes:

| Package | Supported |
|---|---|
| [`@xiechimon/cairn`](https://www.npmjs.com/package/@xiechimon/cairn) (server and web UI) | latest |
| [`@xiechimon/cairn-cli`](https://www.npmjs.com/package/@xiechimon/cairn-cli) (machine daemon) | latest |

## Reporting a vulnerability

Do not open a public issue, pull request or discussion for a security problem.

Report it privately through GitHub: open the repository's [Security tab](https://github.com/xiechimon/cairn/security) and choose **Report a vulnerability**. Include:

- the affected package and version, or the commit SHA;
- what an attacker can do, and what access they need first;
- steps or a proof of concept that reproduce it.

You will get an acknowledgement within 7 days. Once the issue is confirmed, a fix and an advisory are prepared together, and you are credited in the advisory unless you ask not to be.

## Scope

Cairn runs AI agents that execute code on machines you register. By design an agent step can run shell commands, use the git and GitHub credentials given to it, and read the team secrets it is allowed to fetch. Reports are most useful when they cross a boundary Cairn claims to enforce, for example:

- reaching protected `/api/*` without a valid access token, paired-device token, authorized owner identity on the private tailnet listener or an owner-uid loopback browser, or with a revoked API key;
- one team reading or changing another team's data, secrets or machines;
- a webhook or issue intake importing work from a user below triage permission;
- a merge landing without the human gates (plan and diff approval, AI review verdict) it was configured to pass;
- secrets leaving encrypted storage other than through a recorded, permitted fetch.

## Private tailnet owner authentication

Tailscale identity grants owner access only on the private `0600` Unix socket, never on TCP loopback or Funnel. The socket and its private parent directory must belong to the server uid; same-uid processes and root are trusted. Widening socket permissions invalidates this boundary.

Requests whose `X-Forwarded-For` is one of the serving node's own Tailscale addresses come from the server machine itself, where any local user can reach Serve, so they get no identity. Until LocalAPI has reported those addresses once, every request carrying `X-Forwarded-For` gets no identity on the socket listener; the last reported set survives a failed refresh. Browsers on that machine use the loopback rule below.

An untagged node's own user login takes priority. If unavailable, or if the server is tagged, only the explicit socket-scoped allowlist applies. Missing identity, other users and tagged sources still need a token. The sidecar strips client-supplied identity headers and withholds identity for sharees. System Serve must rewrite identity headers and connect directly to the private socket.

Ambient identity on unsafe methods requires same-origin fetch metadata or an Origin matching the tailnet origin. Valid Bearer credentials are exempt from this ambient CSRF check and retain their original authority: paired-device tokens cannot perform owner-only operations. WebSocket origin and subprotocol checks remain unchanged. Token/login-link and revocable QR pairing remain fallback authentication; a fresh home opens no tailnet listener.

See [deployment instructions](docs/deploy/tailscale-mobile.md). Repointing a live Serve target is an operator action after merge, not an implementation step.

An agent doing something harmful with permissions you granted it is a configuration matter, not a vulnerability. Run the server on a trusted network, keep the default loopback `HOST` unless you set `CAIRN_TOKEN` for a wider bind, and terminate TLS in front of it.

## Loopback owner authentication

On Linux, a browser on the server machine reaches `/api/*` as the owner without a token when all of these hold:

- the TCP peer is `127.0.0.1` or `::1`, and `/proc/net/tcp` or `/proc/net/tcp6` shows the client socket as a live, established socket (nonzero inode) owned by the server uid; orphaned or closing rows never count;
- `Host` is `127.0.0.1`, `localhost` or `[::1]` with the server's own port, which refuses DNS-rebinding names;
- the request carries no relay header (`Forwarded`, `Via`, `X-Forwarded-*`, `X-Real-IP`, `X-Client-IP`, `CF-Connecting-IP`, `True-Client-IP`, `Tailscale-*`).

The same fetch-metadata rule as the tailnet listener applies: `Sec-Fetch-Site` other than `same-origin` or `none` is refused on every method, and unsafe methods need `Sec-Fetch-Site: same-origin` or an `Origin` equal to the loopback origin. Container mode (`CAIRN_REQUIRE_TOKEN=1`) and platforms without `/proc` never trust loopback.

Same-uid processes are trusted, as they can already read the token file. A relay you run as the server uid that forwards other parties' traffic to the loopback port with a loopback `Host` and no relay header (a raw `ssh -R` or `socat` forward, a proxy that rewrites `Host`) passes that trust on; expose cairn through `tailscale serve` or the token instead.
