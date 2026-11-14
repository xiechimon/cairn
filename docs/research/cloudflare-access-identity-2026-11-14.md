# Trusting Cloudflare Access identity as the only login step (2026-11-14)

> **Question.** Cairn is reached at `https://app.example.com` through a Cloudflare Tunnel, with a Cloudflare Access self-hosted application (email one-time PIN) in front. After passing Access, a new device must still redeem a one-time pairing code. Can Cairn verify the identity Access already established, check it against an allowlist, and issue its own browser session, so Access is the only login step?
>
> **Marks.** `measured`: read first-hand in the linked primary source or in this repo. `inferred`: derived from measured facts and checkable. `guess`: everything else.
>
> **Refs.** Cairn at `1c14d9148`. Hono `4.13.8` and jose `6.2.12` from `node_modules/.pnpm`. Upstream repos at default-branch heads read on 2026-11-14: grafana `3f36380cf`, gitea `e2f451ae1`, open-webui `b0e6098e9`, oauth2-proxy `39ec0e19b`, authelia `f575f2006`.
>
> **Builds on.** [`seamless-device-auth-2026-11-08.md`](seamless-device-auth-2026-11-08.md) (Tailscale identity headers, threat model) and [`browser-login-handoff-2026-11-13.md`](browser-login-handoff-2026-11-13.md).

## 1. Cloudflare's guidance for origins

| Fact | Mark | Source |
|---|---|---|
| Access sends the application token to the origin as the `Cf-Access-Jwt-Assertion` header; browser requests also carry a `CF_Authorization` cookie. Cloudflare recommends validating the header, "since the cookie is not guaranteed to be passed". | measured | [Validate JWTs](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/) |
| Public keys live at `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`: `keys` (JWK, both current and previous), `public_cert`, `public_certs`. Each JWK has `kid`, `kty: RSA`, `alg: RS256`, `use: sig`. | measured | same page |
| Keys rotate every 6 weeks by default; the previous key stays valid for 7 days. Do not hard-code the key, do not read `public_cert`; match the JWT `kid` against the set. | measured | same page |
| Checks: RS256 signature, `iss` = `https://<team>.cloudflareaccess.com`, `aud` contains the application AUD tag. The AUD tag "will never change unless you delete or recreate the Access application". Cloudflare's own Worker sample uses jose `createRemoteJWKSet` + `jwtVerify({ issuer, audience })` and returns 403 when the AUD is not configured. | measured | same page |
| Payload: `aud` (array), `email` ("verified by the identity provider"), `exp`, `iat`, `nbf`, `iss`, `type` (`app` or `org`), `identity_nonce`, `sub` (user ID, changes if the user is removed and re-added), `country`. A service-token JWT has `common_name` and `sub: ""` and no `email`. | measured | [Application token](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/) |
| "Unless your application is connected to Access through Cloudflare Tunnel, your application must validate the token... Validation of the header alone is not sufficient." | measured | same page |
| `cloudflared` can itself validate the JWT before proxying: `originRequest.access: { required: true, teamName, audTag: [...] }` ("Protect with Access"). | measured | [Origin parameters, access](https://developers.cloudflare.com/tunnel/reference/origin-parameters/#access) |
| No Cloudflare page found that documents `Cf-Access-Authenticated-User-Email` as a trust source; it appears only in Worker samples that read it. The "header alone is not sufficient" line above is the closest official warning. | measured (search of `developers.cloudflare.com/llms-full.txt`) | — |
| The Tunnel exemption does not hold for Cairn: `cloudflared` connects to `127.0.0.1:<port>`, so any local process can send the same request with a forged email header. This is the #2057 hole (`Tailscale-User-Login` forged on loopback). Cairn must verify the signature itself; `cloudflared` `access.required` is defence in depth only. | inferred | `seamless-device-auth-2026-11-08.md` §4; #3073 |

## 2. How other self-hosted products do it

| Source | What is verified | Header vs signature | Identity mapping | Default | Link |
|---|---|---|---|---|---|
| **Grafana `[auth.jwt]`** | Signature from `jwk_set_url` (or file/PEM). "By default, only exp, nbf and iat claims are validated"; `iss`/`aud` only through `expect_claims`. JWKS cached `cache_ttl = 60m`, lowered by `Cache-Control`. | Signature | `username_claim`/`email_claim` to a local user; `auto_sign_up` creates one; roles via JMESPath `role_attribute_path`, `role_attribute_strict` denies on no role | `enabled = false`, `auto_sign_up = false` | [docs](https://grafana.com/docs/grafana/latest/setup-grafana/configure-access/configure-authentication/jwt/), `conf/defaults.ini` `[auth.jwt]`, `pkg/services/auth/jwt/key_sets.go:291-338` (measured) |
| **Grafana `[auth.proxy]`** | Header value only; optional source-IP `whitelist` | Plain header | `X-WEBAUTH-USER` to username; `auto_sign_up = true` | `enabled = false` | `conf/defaults.ini` `[auth.proxy]` (measured) |
| **Gitea** reverse-proxy auth | Header value only; the sample config says Gitea "must only be reachable through the proxy, which must set or remove the authentication headers on every request" | Plain header | `X-WEBAUTH-USER` (+ optional email, full name) to a local user; `ENABLE_REVERSE_PROXY_AUTO_REGISTRATION` | All `ENABLE_REVERSE_PROXY_*` = false; API separate flag | `custom/conf/app.example.ini:466-479,871-877` (measured) |
| **Open WebUI** | Header presence only | Plain header | `WEBUI_AUTH_TRUSTED_EMAIL_HEADER` value, lower-cased, is looked up by email; unknown emails are signed up; password change is blocked in this mode | Unset (off) | `backend/open_webui/routers/auths.py:676-700` (measured) |
| **oauth2-proxy** | Runs the OIDC login itself; upstream gets `X-Forwarded-User/-Email/-Groups` (`pass_user_headers = true`). `--skip-jwt-bearer-tokens` + `--extra-jwt-issuers issuer=audience` verifies bearer JWTs against the issuer JWKS. | Signature at the proxy; plain header to upstream | Upstream maps the header | JWT bearer path off | `docs/docs/configuration/overview.md:143-254` (measured) |
| **Authelia** forward-auth | Authelia session; response headers `Remote-User`, `Remote-Groups`, `Remote-Name`, `Remote-Email` | Plain header to upstream | Upstream maps the header | Per app | [Trusted Header SSO](https://www.authelia.com/integration/trusted-header-sso/introduction/) (measured) |
| **Tailscale Serve** | tailscaled strips client-sent identity headers and sets them from WhoIs; none for tagged nodes, Funnel or local traffic | Plain header, unforgeable only if the backend is unreachable except through serve | `Tailscale-User-Login` | Always sent | `seamless-device-auth-2026-11-08.md` §2 (measured there) |
| **Cairn today** | Owner token (Bearer), pairing-code device session, loopback same-uid bootstrap, 60 s stream tickets | — | Single owner (`ctx.user`); devices are paired rows, non-owner (403 on owner-only routes) | Token always required (#3073) | `apps/server/src/lib/token-auth.ts`, `routes-core.ts:60-73` (measured) |

**Reading.** Every plain-header product says, in its own docs, that the backend must be unreachable except through the proxy (measured: Gitea, Tailscale KB 1312; Open WebUI per the 11-08 note). Cairn cannot guarantee that on a shared host (inferred, #2057). Grafana JWT is the only row that verifies a signature at the app, and it shows the trap: `iss`/`aud` are off unless configured (measured).

## 3. Hono 4.13.8 `verifyWithJwks`

Read in `node_modules/.pnpm/hono@4.13.8/node_modules/hono/dist/utils/jwt/jwt.js` (measured):

- Rejects a header without `kid`, any HS* algorithm, and any `alg` not in the required `allowedAlgorithms`.
- Picks the key with `key.kid === header.kid`; throws if none; rejects when the key's `alg` differs from the header's.
- Calls `verify` with `alg` + `verification: { iss?, aud?, exp?, nbf?, iat? }`. `iss` and `aud` are checked **only when passed**. `aud` accepts the payload array form.
- `exp`, `nbf`, `iat` are checked **only when present** in the payload. A token with no `exp` passes. No clock tolerance; `iat` in the future throws.
- `jwks_uri` is fetched with plain `fetch` **on every call**: no cache, no timeout, no refetch-on-unknown-kid cooldown.

Gaps Cairn must cover: require `exp`; always pass `iss` and `aud`; cache keys with a TTL; a fetch timeout; one refetch on unknown `kid` with a cooldown; check `type === 'app'` and a non-empty `email`.

jose `6.2.12` is already in the lockfile (dependency of `@modelcontextprotocol/sdk`, measured `pnpm-lock.yaml`), not of `apps/server`. Its `createRemoteJWKSet` caches 10 min (`cacheMaxAge` 600000), refetches on unknown `kid` after a 30 s cooldown, and times out at 5 s (measured `dist/webapi/jwks/remote.js:42-80`); `jwtVerify` options include `requiredClaims` and `clockTolerance` (measured `dist/types/types.d.ts:491,516`). It is what Cloudflare's own sample uses (measured).

## 4. Cairn's current auth and the "Tailscale is only a route" decision

- `registerTokenAuth` admits: Bearer owner token or device token; a stream `?ticket=`; the `cairn_auth` cookie resolved by `resolveBrowserSession` (kinds `owner`/`device`), with `cookieWriteAllowed` (Sec-Fetch-Site/Origin) on writes. `/api/auth/bootstrap` and `/api/remote/pair` are exempt and do their own checks. (measured `token-auth.ts:41-185`)
- `/api/auth/bootstrap` issues an `owner` session only for a loopback, same-uid peer with no relay headers; `cf-connecting-ip` is in `RELAY_HEADERS`, so tunnel traffic can never bootstrap. (measured `routes-core.ts:60-73`, `loopback-owner.ts:15-26,164-167`)
- `issueBrowserSession(db, kind, deviceId)` writes `browser_session` (id, tokenHash, kind, deviceId, expiresAt, createdAt), TTL 30 days; `setAuthCookie` sets HttpOnly, SameSite=Lax, `Secure` per request. (measured `services/browser-session.ts:12-68`)
- **Why the policy exists.** #3073 (closes #2057, 2026-11) stopped `Tailscale-User-Login` from granting access because the only check was "TCP peer is loopback", so any local process, including a second Unix user on the host, could forge it (measured, commit `ffb889b4e`, 11-08 note §1). #3440 then admitted tailnet identity on a 0600 socket, and #3927 (`1d7f9397c`, 2026-11-11) removed that too: "Tailscale is only a route. The owner token stays on this machine. Another device exchanges a one-time pairing code", citing t3code: "Authentication remains the environment's responsibility for every route." `ignoredTailscaleUsersWarning` in `config.ts:274-278` and `docs/configuration.md:9` record it. (measured)
- **Conflict.** Trusting Access identity contradicts the literal #3927 principle that a route is not a login. The threat that drove #2057 does not apply to a verified Access JWT: a local process cannot forge an RS256 signature by Cloudflare's key, and cannot read a JWT off loopback without root (inferred). The PR must say so, keep Tailscale identity ignored, and change the wording to "unsigned proxy headers grant nothing; a verified Cloudflare Access token can, when configured". This is an intended-behavior change: ian decides (see §7).

## 5. Pattern that fits Cairn

**Grafana-style signature verification at the app, used once at an exchange endpoint that issues Cairn's own session (like `/api/auth/bootstrap`), owner-only allowlist, off by default.** Not header trust (Gitea, Open WebUI, Authelia): Cairn cannot keep `127.0.0.1` private on a shared host (inferred). Not per-request verification as the only gate: the SPA, stream tickets and CSRF checks already run on `cairn_auth`, so reusing the session keeps one admission path (inferred).

## 6. Recommendation

**Config** (names go through `ENV_VARS` in `packages/shared/src/brand.ts`):

- `CAIRN_ACCESS_TEAM_DOMAIN` = `https://<team>.cloudflareaccess.com` (exact `iss`; certs URL derived as `${team}/cdn-cgi/access/certs`).
- `CAIRN_ACCESS_AUD` = one or more AUD tags, comma-separated.
- `CAIRN_ACCESS_OWNER_EMAILS` = comma-separated, compared lower-cased after trim.
- Off when all three are unset. Any one set without the others refuses to start, in the `authOffRefusal` pattern (`config.ts:280`). The team domain must be `https:` and end in `.cloudflareaccess.com`. Startup logs one line naming the team domain and the count of emails, never the emails.

**Exchange endpoint.** `POST /api/auth/access` in `routes-core.ts` next to bootstrap, added to `isExempt` in `token-auth.ts:41-54` beside `/api/auth/bootstrap`. Steps, each failing closed:

1. Feature off: 404.
2. `Sec-Fetch-Site` must be `same-origin`/`none` (the Access header is ambient on every request, so a cross-site POST would carry it): else 403.
3. Read `Cf-Access-Jwt-Assertion` only; never `CF_Authorization`, never `Cf-Access-Authenticated-User-Email`.
4. Header `alg` must be `RS256` and `kid` present; key chosen by `kid` from the cached set.
5. Verify signature, `iss` equals the team domain exactly, `aud` intersects `CAIRN_ACCESS_AUD`, `exp` present and in the future, `nbf` not in the future, 60 s clock tolerance.
6. `type === 'app'`, `email` a non-empty string (rejects service tokens).
7. Lower-cased `email` in `CAIRN_ACCESS_OWNER_EMAILS`.
8. `issueBrowserSession(ctx.db, 'owner', null)` and `setAuthCookie`, with `expiresAt = min(now + 30 d, jwt.exp)` so the Cairn session never outlives the Access session. Response `{ ok: true }`, `cache-control: no-store`.

**SPA.** On the first 401, call `/api/auth/access` before showing pairing (same place it calls bootstrap). When the Cairn session expires with the Access cookie still valid, the next exchange is silent.

**Multi-user.** Cairn has one owner (`ctx.user`). Every allowlisted email maps to that owner. Other people keep pairing codes, which give non-owner device sessions. A later "Access email to device" mapping would create a `paired_device` row per email and reuse its revoke button; out of scope.

**Revocation.** Removing an email takes effect at the next exchange; with the `exp` cap that is at most one Access session duration. Immediate effect needs the session row to remember its email: add `browser_session.subject` (nullable) and have `resolveBrowserSession` reject an Access session whose subject is no longer allowlisted. That is a persisted-state change, so a one-page design goes to the coordinator first (CLAUDE.md). Removing the user or ending their session in the Cloudflare dashboard stops new exchanges at the edge (inferred).

**Key cache.** Prefer jose `createRemoteJWKSet` (10 min cache, 30 s cooldown refetch on unknown `kid`, 5 s timeout) as a direct `apps/server` dependency; this changes `package.json` and `pnpm-lock.yaml`. Fallback without a lockfile change: Hono `verifyWithJwks({ keys })` plus a thin cache holding the last good set for 10 min, `AbortSignal.timeout(5000)` on fetch, one refetch on unknown `kid` at most every 30 s, and our own `exp`/`type`/`email` checks (§3 gaps). The fallback is hand-rolled caching, which needs the stated reason "no new lockfile entry".

**Failure behavior.**

| Failure | Response | Log |
|---|---|---|
| Feature off | 404, pairing unchanged | none |
| Partial config | refuse to start | one line naming the missing variable |
| Cross-site request | 403 `same-origin proof required` | none |
| Header missing | 401, SPA falls back to pairing | debug |
| Certs fetch fails or times out, no cached set | 503 `access verification unavailable`; never admit | warn, rate-limited |
| Certs fetch fails, cached set still fresh | verify with cache | warn |
| Unknown `kid` after one refetch | 401 | warn |
| `alg` not RS256, malformed JWT | 401 | warn |
| Bad `iss` or `aud` | 401 | warn with the received values |
| Expired, `nbf` future, `exp` missing | 401 | debug |
| `type` not `app`, no `email` | 401 | warn |
| Email not allowlisted | 403 `this Cloudflare Access account is not allowed here` | warn without the email |

**Tests** (one per row; Red first on the current code where a test can fail today):

1. Off by default: no env, `POST /api/auth/access` 404, `/api/teams` 401.
2. Partial config refuses to start (each of the three alone).
3. Valid JWT from a local JWKS server, allowlisted email: 200, `cairn_auth` set, `/api/teams` 200.
4. Session `expiresAt` equals the JWT `exp` when sooner than 30 days.
5. Cross-site `Sec-Fetch-Site`: 403, no cookie.
6. Missing header: 401. Only `CF_Authorization` cookie present: 401. Only `Cf-Access-Authenticated-User-Email` present: 401 (the #2057 class).
7. Certs server down, empty cache: 503, no cookie. Certs down with fresh cache: 200.
8. Unknown `kid` triggers exactly one refetch; a rotated key then verifies.
9. HS256 token signed with the public key bytes: 401. `alg: none`: 401.
10. Wrong `aud`; wrong `iss`; expired; `nbf` in the future; no `exp`: each 401.
11. Service-token payload (`sub: ""`, no `email`): 401. `type: org`: 401.
12. Email not allowlisted: 403. Upper-case variant of an allowlisted email: 200.
13. A paired-device session still 403s on owner-only routes (unchanged behavior).
14. `CAIRN_TAILSCALE_USERS` still grants nothing (existing `safe-defaults.test.ts:288`).
15. Live: through the real tunnel, a fresh browser profile passes the OTP and lands on the board with no pairing step (verify-cairn).

## 7. Decisions for ian

1. Accept that a verified Cloudflare Access token is a login, a scoped exception to #3927 "Tailscale is only a route". Recommended: yes, owner emails only, off by default.
2. jose as a direct `apps/server` dependency (lockfile change). Recommended: yes; it is what Cloudflare's sample uses and removes the hand-rolled cache.
3. Add `browser_session.subject` for immediate revocation. Recommended: yes, behind the one-page design.
