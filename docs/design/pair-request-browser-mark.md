# Server-side withdrawal of a browser's pairing requests

## Rule

When a browser signs in, the server voids that browser's open pairing requests, including one still in flight at that moment. A browser that is signed out can always ask again. The server enforces this. The web app withdraws nothing.

## Browser mark

- Cookie `cairn_browser`: 32 random bytes, base64url. HttpOnly, SameSite=Lax, Path=/api, Secure when the request is HTTPS, Max-Age 30 days, renewed by the routes below on a successful response and on the signed-out probe.
- Set by every successful response of the listed routes (the session probe and access-token sign-in, which share `/api/auth/session`, Cloudflare Access, account sign-in, sign-out, pairing code, pair request and every pair claim, including one still `pending`) and by the session probe's 401, which precedes the sign-in screen. A value that is not 43 base64url characters is replaced.
- It is not a credential and admits nothing. The server stores only its hash.
- Cookies are scoped by host, not port. Servers sharing a host reuse one value; each matches it only in its own database.

## Persisted state

Two nullable columns, one additive migration: `pairing_request.browserMarkHash` and `browser_session.browserMarkHash`. NULL never matches anything. The second column is required for a request that leaves the browser before the sign-in response and reaches the server after it: it carries no session cookie, exactly like a request from a signed-out browser, so the server remembers when the mark signed in and treats requests arriving within 30 seconds of that as in flight. Nothing bounds how late a request can arrive; 30 seconds is the chosen limit.

## States

`pending` → `approved` → `consumed`; `pending` → `denied`; `pending` → `superseded` (a newer request from the same peer, or the browser signed in); unclaimed `approved` → `superseded` (the browser signed in). A request is inserted as `superseded` when it carries a session cookie this server accepts (a sign-in screen left open and asking again), or when it arrives within 30 seconds of a sign-in under its mark. A live session in the database alone does not count: the server cannot know the browser still holds it. A request born `superseded` replaces no other request.

## Writers and readers of the request store

| Path | Access | Change |
|---|---|---|
| `createPairRequest` | deletes old rows, supersedes same-peer pending rows, inserts | stores the mark; inserts `superseded` when the request carries an accepted session cookie or its mark signed in within the last 30 seconds |
| sign-in (one function issues the session and stores the mark; the mark cookie comes from a middleware mounted on a listed set of paths, and a sign-in route left off that list stores NULL) | new | in one transaction, supersedes every `pending` and unclaimed `approved` row with the mark |
| sign-out | new | no request change; removes the mark from every session that carries it, so the 30 second window ends at once |
| `listPairRequests` | reads pending | none |
| `decidePairRequest` | pending to approved or denied | none; approving a superseded row already answers 409 |
| `claimPairRequest` | reads; approved to consumed, then issues a session | marks the row consumed before sign-in runs, so it never supersedes itself |
| shared table lists | names the tables | none |

Sign-in routes that must use the one function: access token (owner and device token), Cloudflare Access, account (Clerk), approved pairing claim, pairing code. No route sets the session cookie any other way.

Device revocation deletes session rows, so their mark goes with them.

## Web

Delete nothing from the server contract. One addition: when a claim answers `expired` or `denied`, probe the session once; if signed in, close the sign-in screen. A signed-in answer is the only thing that changes the screen, and a terminal request is never re-requested automatically, so this cannot loop.

## Failures

| Case | Result |
|---|---|
| Superseding fails during sign-in | the transaction rolls back and sign-in answers 500; no half state |
| Browser or client keeps no cookies | no mark comes back; behaviour is the same as before this change |
| Rows and sessions from before the migration | NULL mark; expire as before |
| Page loaded before the upgrade, new server | the cookie works without new web code; a voided window shows "expired" until reload |
| New page, old server | the extra probe is harmless; requests are not withdrawn |
| Two first tabs get different marks at once | the cookie jar keeps one; same-peer superseding already leaves only the newest request pending |
| Someone sends requests with another browser's mark | their own requests are voided; they gain no access |
| Sign-in fails | nothing is superseded |
| The session cookie is lost but the mark is kept (another server on the same host overwrote it, or it was cleared alone) | a new request is pending; within 30 seconds of that sign-in the code shows as expired (with the usual "nobody approved it in 5 minutes" text), and asking again later works |

## Not covered

A request that reaches the server more than 30 seconds after the sign-in it preceded stays pending until it expires.

A window whose request was already replaced by a newer tab stops polling, so it stays on the sign-in screen until reload, as today.

## Proof

Red on the parent: for each of the five sign-in routes, a server test with a pending request under the mark; closed-window case (the request's owner never calls again); late request after sign-in; approve-after-void answers 409; another mark and NULL mark stay pending; a request born `superseded` replaces no other request. Guards that pass on the parent and must stay green: sign-out lets the browser request again at once; a browser that lost only its session cookie can request again once 30 seconds have passed since that sign-in. A browser test closes the second sign-in tab and signs in on the first. The packaged remote walk signs in with the token and asserts no pending request and no banner, with the banner-deny click removed.
