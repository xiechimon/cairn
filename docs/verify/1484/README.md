# #1484 evidence: the per-step git credential answers only for its own host

Base = `659d8cb5` (origin/main). Branch = `claude/optimistic-albattani-r5pmfn`. All runs are in this cloud container (uid 0, with its own `GIT_CONFIG_*`); the git tests strip those where the result depends on them.

## The change

- `packages/shared/src/git-ops.ts` adds `BoundGitCredentials`: `GitCredentials` plus the `url` it was issued for. The wire type (`MachineTokenResponse.git`) is unchanged.
- `apps/daemon/src/credentials.ts` `pushCredential(token, repoUrl)` binds the step's git credential to the claim's `project.repo.cloneUrl`; `apps/daemon/src/runner.ts` passes it. A step with no repo binds to `''`.
- `apps/daemon/src/git.ts` `gitCredentialEnv` writes the empty `credential.helper` reset (unchanged), then the inline helper under `credential.<scheme>://<host>.helper` instead of `credential.helper`. `credentialScope` takes the scheme and host from the bound URL: default port and userinfo dropped, host lowercased, as git normalizes it. A URL that is not http(s), including `''`, gets no helper at all.
- The git primitives (`clone`, `fetch`, `push`, `tagPush`, `remoteSetHeadAuto`), `withGitCredentialFallback`, the workspace (`prepare`, `push`), the workspace hook and the `create_tag` tool take `BoundGitCredentials`, so the type checker rejects a credential without its URL.

git looks a credential up by the URL it actually connects to, after `url.<base>.insteadOf` rewriting. A worktree whose `origin` was repointed with `git remote set-url`, or rewritten with `insteadOf`, therefore gets no credential for the other host: git falls back to asking for a username, and `GIT_TERMINAL_PROMPT=0` makes that fail.

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
| 失败方式 1 (4 cases) | the helper key for github.com, github.com:443, a hosted `http://127.0.0.1:8787/git/...` URL and a URL with userinfo and an uppercase host; the empty reset stays first |
| 失败方式 2 (5 cases) | `''`, a local path, an scp-style URL, `file://`, `ssh://`: only the reset, no helper, the token nowhere in the env |
| 失败方式 3/4 | real `git credential fill`: the bound host gets the token; another port, `https` instead of `http`, another host get none; a `credential.<same host>.helper` in the global config is reset |
| 失败方式 5, set-url | two HTTP servers that challenge for Basic auth: with origin on the bound host the token arrives (control); after `git remote set-url` to the other server, `push`, `tagPush` and `fetch` send it nothing |
| 失败方式 5, insteadOf | `url.<other>.insteadOf <bound>` in the repo config: `push` and `tagPush` send nothing to either server |

The fixtures that build a git credential now carry a URL: the one their test pushes to (`tag-tool.test.ts` binds to its HTTP git server), or an https URL where the test only inspects the environment. `runner-cred-fallback.test.ts` and `runner-local.test.ts` now expect the runner to hand `push` the token response bound to the claim's `cloneUrl`, which pins the wiring in `runner.ts`.

## Runs

| file | what | result |
|---|---|---|
| `old-leg.txt` | `git.ts` from origin/main, `-t '#1484'` | 12 failed. `expected 'credential.helper' to be 'credential.https://github.com.helper'`; `expected '2' to be '1'`; another host's `credential fill` contains the token; the other HTTP server received `git:pacman_fresh_token_123` on push, tagPush and fetch (set-url) and on push and tagPush (insteadOf) |
| `new-leg.txt` | this branch | 12 passed |
| `daemon-suite.txt` | whole daemon suite | 86 files, 896 passed |
| `integration-hosted.txt` | `integration/test/rework-branch-reuse-e2e.test.ts`: real server, real daemon, hosted repo | passed. The server's `/git/` route answers 401 to any request without valid Basic auth (`apps/server/src/routes-git-hosting.ts`), so the clone, fetch and push in this run only succeed if the bound helper answers for the server's own host |

`pnpm lint`, `pnpm typecheck` and `pnpm spec:parse` pass. `e2e-affected --dry-run` selects no web specs (daemon and shared `git-ops.ts` only).

## Rerun

```sh
(cd apps/daemon && node_modules/.bin/tsx ../../docs/verify/1484/repro.mts)
(cd apps/daemon && pnpm exec vitest run --reporter=verbose test/git.test.ts -t '#1484')
(cd integration && pnpm exec vitest run test/rework-branch-reuse-e2e.test.ts)
```
