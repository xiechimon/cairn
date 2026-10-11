# #1225 mea 实测证据：daemon clone/push 凭据降级

Run date: 2026-10-12. Machine: mea (WSL2, the ticket's incident machine; gh
logged in as xiechimon, `~/.gitconfig` wires `credential.https://github.com`
to the gh helper, HTTP_PROXY=127.0.0.1:7890 in the environment).

`probe.mjs` is the whole run (self-contained: stub LLM + isolated server at
`PORT=8791` + one daemon in a scratch `PACMAN_HOME`; the daemon inherits
mea's full environment including the proxy, per ticket failure mode 4). The
base repo is pre-materialized by the probe so the daemon's prepare is a fast
fetch instead of a 2-minute clone that would outrun the server's 120s
abandoned-step sweep; the public repo's clone/fetch never gets a 401
challenge, so the degrade evidence is on push, which is the operation the
ticket's incident actually killed. The clone half of the order is pinned by
`apps/daemon/test/workspace-cred-fallback.test.ts` with real git.

Leg 1: `github_connection` seeded with an invalid token
(`probe-1225-bad`), one build. Leg 2: connection replaced with the real
`gh auth token`, another build.

| file | what it shows |
|---|---|
| `result.json` | 19/19 checks, both legs |
| `leg1-daemon-relevant.log` | push auth failure on the per-step token, retry with machine credentials, `pushed pacman/conv-…` |
| `leg1-credential-row.json` | `message` table row `git-credential-<stepId>` = `machine` (the build record's credential source line) |
| `leg2-daemon-relevant.log` | second build pushes with no new fallback line |
| `leg2-credential-row.json` | source row = `integration` (valid token, behavior unchanged) |
| `leg1-steps.json` / `leg2-steps.json` | step rows, both `done` |
| `connection-status-leg*.json` | the connection login for each leg |
| `cleanup-remote-branches.txt` | both probe branches deleted from origin |
| `daemon-console-verify-1225.log` / `server-console.log` | full console output |
| `daemon-homes.txt` | scratch paths (wiped after the run) |

No credential value appears in any file: the fabricated bad token exists
only as a constant in `probe.mjs`, and the real token was piped over stdin
into the seeding script and matched with a shape-only regex
(`gho_…`, `github_pat_…`) in the zero-hit check.
