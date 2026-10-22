# #1484 evidence: the per-step git credential answers only for its own host

Base = `659d8cb5` (origin/main). Branch = `claude/optimistic-albattani-r5pmfn`. All runs are in this cloud container (uid 0, with its own `GIT_CONFIG_*`); the git tests strip those where the result depends on them.

## The change

- `packages/shared/src/git-ops.ts` adds `BoundGitCredentials`: `GitCredentials` plus the `url` it was issued for. The wire type (`MachineTokenResponse.git`) is unchanged.
- `apps/daemon/src/credentials.ts` `pushCredential(token, repoUrl)` binds the step's git credential to the claim's `project.repo.cloneUrl`; `apps/daemon/src/runner.ts` passes it. A step with no repo binds to `''`.
- `apps/daemon/src/git.ts`:
  - `gitCredentialEnv` still writes the empty `credential.helper` reset first. After it comes a fixed helper body, `CREDENTIAL_HELPER`, which contains no credential.
  - The bound remote and the credential go into four environment variables: `PACMAN_GIT_CRED_PROTOCOL`, `_HOST`, `_USERNAME`, `_PASSWORD`.
  - The helper reads git's request on stdin and answers only for `get` with an exact `protocol=` and `host=` match. It prints with `printf '%s'`.
  - `credentialTarget` takes the protocol and the host from the bound URL's text, the way git takes the host from a remote URL: userinfo is dropped, and case, an explicit port, `_` and non-ASCII characters are kept (`git-host-from-url.txt`). `origin` is set to exactly this URL, so the two strings match byte for byte with no normalisation in between.
  - A URL that is not http(s), including `''`, gets no helper and no `PACMAN_GIT_CRED_*`.
- The git primitives (`clone`, `fetch`, `push`, `tagPush`, `remoteSetHeadAuto`), `withGitCredentialFallback`, the workspace (`prepare`, `push`), the workspace hook and the `create_tag` tool take `BoundGitCredentials`, so the type checker rejects a credential without its URL.

git builds the request from the URL it actually connects to, after `url.<base>.insteadOf` rewriting and after an HTTP redirect. A worktree whose `origin` was repointed with `git remote set-url`, or rewritten with `insteadOf`, therefore sends a different `host=`, and the helper prints nothing. git falls back to asking for a username, and `GIT_TERMINAL_PROMPT=0` makes that fail.

Two side effects of the fixed body:
- The credential no longer appears in the helper's `sh -c` command line, which other local users can read from `/proc/<pid>/cmdline`.
- The values no longer pass through the shell at all (#1485).

## Why not a URL-scoped key

The branch's first version (`86923c68`) wrote the helper as `credential.<scheme>://<host>.helper`. The security review found that git's URL-scoped keys never match a host containing `_`, which would break push and fetch on a hosted deployment reached by a name like `pacman_server` (a docker-compose service name). This was confirmed with plain `git -c`. `first-leg.txt` shows that version failing the `_` test.

## Reproduction

`repro.mts` binds a fake token to `https://github.com/o/r.git`, repoints a worktree's origin to a local HTTP server that answers with a Basic challenge, and runs the daemon's `gitPrim.tagPush` (what the `create_tag` tool calls).

| file | `git.ts` | the other host received |
|---|---|---|
| `repro-old.txt` | origin/main | `["x-access-token:ghs_FAKE_STEP_TOKEN_0000"]` |
| `repro-new.txt` | this branch | `[]` (git: `could not read Username ... terminal prompts disabled`) |

## Tests

`apps/daemon/test/git.test.ts`, block `#1484`:

| test | what it pins |
|---|---|
| 失败方式 1 (6 cases) | protocol and host for github.com, `github.com:443`, a hosted `127.0.0.1:8787`, a URL with userinfo and an uppercase host, `pacman_server:8787`, `[::1]:8787`; the empty reset stays first |
| 失败方式 2 (5 cases) | `''`, a local path, an scp-style URL, `file://`, `ssh://`: only the reset, no helper, no `PACMAN_GIT_CRED_*`, the token nowhere in the env |
| 失败方式 3/4 | real `git credential fill`: the bound host gets the token; another port, `https` instead of `http`, another host get none; a `credential.<same host>.helper` in the global config is reset |
| 失败方式 1/3 | real `git credential fill` with `url=` (git parses the URL itself): `pacman_server:8787`, `GitHub.com` and an explicit port get the token when bound as written; another `_` host and a dropped port get none |
| 失败方式 5, set-url | two HTTP servers that challenge for Basic auth: with origin on the bound host the token arrives (control); after `git remote set-url` to the other server, `push`, `tagPush` and `fetch` send it nothing |
| 失败方式 5, insteadOf | `url.<other>.insteadOf <bound>` in the repo config: `push` and `tagPush` send nothing to either server |
| 失败方式 6 | with `GIT_TRACE`, the logged `run_command` lines (the helper's `sh -c`) do not contain the password, while `credential fill` still returns it |

Fixtures that build a git credential now carry a URL:
- the one their test pushes to (`tag-tool.test.ts` binds to its HTTP git server);
- or an https URL, where the test only inspects the environment.

Updated assertions:
- `runner-cred-fallback.test.ts` and `runner-local.test.ts` now expect the runner to hand `push` the token response bound to the claim's `cloneUrl`, which pins the wiring in `runner.ts`.
- `local-executor.test.ts` records `PACMAN_GIT_CRED_*` from its git shim. The token is in the environment and not in git's argv, the same check as before.

## Runs

| file | what | result |
|---|---|---|
| `old-leg.txt` | `git.ts` from origin/main, `-t '#1484'` | 16 failed. The shape cases; another host's `credential fill` contains the token; the other HTTP server received `git:pacman_fresh_token_123` on push, tagPush and fetch (set-url) and on push and tagPush (insteadOf); the token is in the `GIT_TRACE` log |
| `first-leg.txt` | `git.ts` from `86923c68` | 8 failed: the shape cases (it used URL-scoped keys), the `_` host gets no password (`expected '' to contain 'password=…'`), and the token is in the `GIT_TRACE` log |
| `new-leg.txt` | this branch | 16 passed |
| `daemon-suite.txt` | whole daemon suite | 86 files, 903 passed |
| `integration-hosted.txt` | `integration/test/rework-branch-reuse-e2e.test.ts`: real server, real daemon, hosted repo | passed. The server's `/git/` route answers 401 to any request without valid Basic auth (`apps/server/src/routes-git-hosting.ts`), so the clone, fetch and push in this run only succeed if the helper answers for the server's own host |
| `git-host-from-url.txt` | what `host=` git puts in the helper request for six URL shapes | case, explicit port, `_` and non-ASCII kept; userinfo dropped |

`pnpm lint`, `pnpm typecheck` and `pnpm spec:parse` pass. `e2e-affected --dry-run` selects no web specs (daemon and shared `git-ops.ts` only).

## Rerun

```sh
(cd apps/daemon && node_modules/.bin/tsx ../../docs/verify/1484/repro.mts)
(cd apps/daemon && pnpm exec vitest run --reporter=verbose test/git.test.ts -t '#1484')
(cd integration && pnpm exec vitest run test/rework-branch-reuse-e2e.test.ts)
```
