# Signing in through Cloudflare Access

Status: owner-approved 2026-11-14. Security surface: `apps/server/src/lib/token-auth.ts`. Research: `docs/research/cloudflare-access-identity-2026-11-14.md`.

## Decision

When Cairn sits behind a Cloudflare Tunnel with a Cloudflare Access application in front, passing Access is the only sign-in step. The web page posts to `POST /api/auth/access`; the server verifies the `Cf-Access-Jwt-Assertion` JWT Cloudflare attached, checks the email against an allowlist, and issues the ordinary owner browser session (`cairn_auth`).

This is a scoped exception to #3927 ("a pairing code is the only way in"). #3073 and #3927 stopped trusting identity from a proxy because a plain header such as `Tailscale-User-Login` can be forged by any local process on loopback. An Access JWT is signed by Cloudflare with keys Cairn fetches from the team's certs URL, so a local process cannot mint one. The plain `Cf-Access-Authenticated-User-Email` header is never read.

## Configuration

Off unless all three are set; a partial set refuses to start and names what is missing.

| Variable | Value |
|---|---|
| `CAIRN_ACCESS_TEAM_DOMAIN` | `<team>.cloudflareaccess.com` |
| `CAIRN_ACCESS_AUD` | the Access application's AUD tag |
| `CAIRN_ACCESS_OWNER_EMAILS` | comma-separated emails allowed in as the owner |

## Checks

`jose` `jwtVerify` with the team's remote key set (`https://<team>/cdn-cgi/access/certs`, 5 s fetch timeout, 10 min cache, 30 s refetch cooldown on an unknown `kid`): algorithm RS256 only, `iss` = `https://<team>`, `aud` = the AUD tag, `exp` and `email` required. The email is compared case-insensitively after trimming.

## Paths

| Path | Result |
|---|---|
| Not configured | 404; every other sign-in path unchanged |
| Request with `Sec-Fetch-Site` other than same-origin or none | 403, no cookie |
| No assertion, bad signature, unknown key, HS256, wrong `aud` or `iss`, expired, no `exp`, no `email` | 401, no cookie |
| Valid token, email not on the allowlist | 403, no cookie |
| Keys cannot be fetched (network error or timeout) | 503, no cookie |
| Valid token, allowed email | 200, owner session whose expiry and cookie `Max-Age` never pass the JWT `exp` |

Removing an email takes effect when that session expires (at most the Access session length); revoke the user's Access session in Cloudflare for immediate effect. Loopback bootstrap and pairing codes keep working; the web page tries loopback bootstrap first and the Access exchange only on a non-loopback page.

## Setup

1. Run `cloudflared` on the Cairn host with a named tunnel whose ingress maps a hostname to `http://127.0.0.1:<port>`.
2. In Cloudflare Zero Trust, add a self-hosted Access application for that hostname with an Allow policy listing the owner emails. Create it before the DNS route so the hostname is never reachable without Access.
3. Route the hostname to the tunnel, then set the three variables above and restart the server.
