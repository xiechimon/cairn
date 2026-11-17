# GitHub auth emulator evidence

Exercise the GitHub authorization surfaces (team device sign-in, OAuth transport, refresh, revocation) without GitHub credentials. This case serves the in-repo `githubAuthFake` over loopback HTTP and repoints the server through `CAIRN_GITHUB_OAUTH_BASE_URL` and `CAIRN_GITHUB_API_BASE_URL`. It complements `github-emulator.md`, which covers REST/PR behavior; this one covers the grant lifecycle.

## Sub-features

- OAuth base: `CAIRN_GITHUB_OAUTH_BASE_URL` repoints device-code, token-poll, refresh and authorize URLs. Unset or empty retains `https://github.com`. Only loopback `http:` (127.0.0.1, [::1], localhost) with an optional path prefix is accepted; every other value — including https and non-loopback hosts — is rejected, so a grant can never be redirected to a remote host by configuration.
- Device journey: `startGithubConnectionDevice` issues a code, a real Chromium leg opens the fake `/login/device` page, enters the user code and clicks Authorize; `pollGithubConnectionDevice` then completes with the verified login.
- Persistence: the completed poll seals both tokens and writes login, numeric user ID, App client ID and both expiries to `github_connection`; `adoptGithubProfile` sets the account display name and avatar.
- Reads: `githubUserRepos` lists the seeded fake repository over the API base.
- Lifecycle: forcing expiry rotates the pair through the refresh grant; revoking the refresh token disconnects the row with `GitHub authorization expired`.

## How to get to it (user POV)

Backend evidence only; run the registered case below. The fake serves its own device-authorization page, so no real GitHub page is opened and no GitHub account is needed.

## Driving it with verify-cairn

Preconditions: Node 24, installed workspace dependencies and Playwright Chromium. No running verify stack is needed; the case owns its fake server and in-memory SQLite database. The fake has no external dependency.

```sh
cairn-heavy node .claude/skills/verify-cairn/scripts/vp.mjs drive github-auth-emulator device-sign-in
cairn-heavy pnpm exec vitest run integration/test/github-auth-emulator.test.ts
```

The driver selects an available loopback port, serves `githubAuthFake` over real HTTP, runs the service functions with the ambient fetch, approves the device code through a headed-in-headless Chromium page on the fake's own `/login/device` route, and asserts the persisted row, profile adoption, token rotation and revocation disconnect. It writes `result.json` (requests with form fields, the saved row, repos) into `VERIFY_EVIDENCE_DIR` supplied by vp. Unit coverage in `apps/server/test/github-connection-device.test.ts` drives the same fake in-process for pending, slow_down, denial, expiry, refresh races and outage behavior; `apps/server/test/github-oauth-base.test.ts` covers production defaults and override validation.

PR coverage lines:

```text
Live: Cairn device/OAuth transport, connection persistence, profile adoption and repo reads over loopback HTTP; migrated SQLite DB.
Mocked: in-repo githubAuthFake (device codes, token exchange, refresh, /user, /user/repos, /user/installations, /login/device approval page).
Not covered: real GitHub authorization UI and rate limits, legacy OAuth web callback, App installation page, MCP connector sign-in UI, daemon git/gh calls.
```

## Gotchas

- `CAIRN_GITHUB_OAUTH_BASE_URL` accepts loopback `http:` only; production must leave it unset so endpoints stay on github.com. Never point a real deployment at a fake, and never put a real token into a fake stack.
- The fake's `/login/device` returns `verification_uri` under its own origin, which the transport accepts because the pin compares against the configured base, not the string `github.com`.
- Fake grants are in-memory per process; a restarted fake forgets prior grants, so revoke/refresh checks must run inside one case execution.
