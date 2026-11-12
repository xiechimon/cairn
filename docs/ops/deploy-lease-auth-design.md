# Self-deploy lease authentication (#3958)

Extends [the drain design](deploy-drain-design.md). Read that first for the lease itself.

## 1. Evidence

Measured on omarchy, 2026-11-12:

- `GET http://127.0.0.1:8787/api/server/deploy/lease` without a credential answers `401 {"error":"Unauthorized"}`. With `Authorization: Bearer` holding the owner token from `~/.cairn/token` it answers `200` and the lease row.
- `~/.local/state/cairn-deploy/last-attempt.log` repeats `refused: server lacks the deployment lease endpoint; bootstrap server-only first`. The endpoint exists; the preflight in `scripts/ops/deploy-self.sh` mapped every non-200 to that sentence.
- #3927 (`1d7f9397c`) removed loopback admission: a loopback request is the owner only with the owner token, an owner session cookie or a stream ticket. #3624 (`67a2a82c1`) wrote the lease client while loopback was still admitted, so it sends no credential.
- Both commits are ancestors of `b8be60b28`, the last deployed revision. The server that approved that deploy still admitted loopback. The server it installed does not, so the first daemon-affecting target after it was refused, and every one since.

Prior-art research is skipped: this restores one existing client to the server's existing owner authentication and adds no mechanism.

## 2. Options

| Option | Server change | Verdict |
| --- | --- | --- |
| A. The deploy script sends the owner token the host already holds in `$CAIRN_HOME/token` | none | Recommended and implemented. |
| B. The script calls `POST /api/auth/bootstrap` and uses the owner session cookie | none | Rejected: writes a browser session row per attempt, works only on Linux without `CAIRN_REQUIRE_TOKEN`, and needs a cookie jar on disk. |
| C. The server admits loopback callers on the lease routes | weakens `token-auth` | Not taken. It reverses #3927 for one route and is the owner's decision. |

Option A adds no new credential and no new reader: the token file is mode 600 and the deploy already runs as its owner, with write access to `server.db`.

## 3. Token handling

- Source: the first `CAIRN_TOKEN` line of `${CAIRN_HOME:-$HOME/.cairn}/token`, parsed like `parseAccessTokenFile`. A server configured with the `CAIRN_TOKEN` environment variable instead of the file is refused with the 401 message below.
- Transport: a header file on a process-substitution descriptor (`curl -H @/dev/fd/N`), written by a shell builtin. The token never appears in an argument list, a log line or a file on disk.
- Destination: sent only when `CAIRN_HEALTH_URL` is `http://` on `127.0.0.1`, `localhost` or `[::1]`. Any other URL gets no token.

## 4. Callers of `/api/server/deploy/lease`

`deploy-self.sh` is the only client; `bootstrap-deploy.sh` only stages it.

| Caller | Request | 200 | 401 or 403 | 404 | No response | Other status |
| --- | --- | --- | --- | --- | --- | --- |
| Preflight, daemon-affecting target, before rehearsal | `GET` | continue | exit 2, `deployment lease request unauthorized (HTTP n)` plus the token cause | exit 2, `server lacks the deployment lease endpoint (HTTP 404)` | exit 2, `deployment lease endpoint unreachable` | exit 2, `deployment lease endpoint answered HTTP n` |
| `drain_steps`, after build | `PUT` | read the lease back, then wait for steps | same refusals as preflight; cleanup restores the previous checkout and releases the lease through the DB | same | same | same |
| `resume_claims`, EXIT cleanup and recovery | `DELETE` | claim polls wake | ignored; the DB release and readback still run, polls wake on their own timeout | ignored | ignored | ignored |

Token causes named after a 401 or 403: the health URL is not loopback, the token file is unreadable, the file has no `CAIRN_TOKEN` line, or the server rejected the stored token. A server-only target sends no lease request and is unaffected. Nothing is deployed, stopped or snapshotted on any refusal row.

## 5. Decisions

| Decision | Reason | Reversal |
| --- | --- | --- |
| Owner token over a loopback exemption | No auth change on the server; the owner decides any exemption. | Revert the script change. |
| Loopback-only destination | An overridden `CAIRN_HEALTH_URL` must not receive the owner token. | Remove the guard after a reviewed need. |
| The test fake requires the token on every lease request | The old fake answered 200 to anonymous calls, which is why the regression shipped green. | None. |
| Refusals keep exit 2 | The watcher retries every tick either way; only the message was wrong. | n/a |

Security surface: none. The change is `scripts/ops/deploy-self.sh` (`dataDestruction` and `releaseAndControlPlane` in `packages/shared/merge-gate-paths.json`), its test and docs. No path in `credentials`, `machineAndCommandBoundary` or `externalEntryAuth` changes.
