# Local-project daemon execution surface (mirror clone + conv-branch landing)

The task execution chain for local-repo projects (spec 12 G2-T2, #362): the daemon hardlink-mirror-clones the user's local git repo into a worktree, pushes the conv branch back to the user repo after every step's commit; the merge step runs `git merge origin/<default>` in a separate worktree and then pushes the conv branch back to the user repo, which is the landing (#1211: the user's main checkout's branches/reflog/worktree are never touched by cairn, merging into the default branch is left for the user to take). The web surface's Files tab was opened with #1030 (read surface + degradation, see [project-files-local.md](./project-files-local.md)); the GitHub-form execution credential (per-step x-access-token) is wired in the same ticket, consumed on the daemon git spawn.

## Sub-features

- `local-clone` — the runner opens a worktree for `repo.kind==='local'`: cloneUrl = the user repo's absolute path, `git clone` of a local path hardlinks by default (near-zero cost); zero writes to the hosted storage surface (the server's reposDir).
- `local-push-back` — at each step's close, the conv branch `cairn/conv-<buildId>` is pushed back to the user repo's refs/heads (a non-bare repo accepts the push; the user's current branch is not touched).
- `branch-landing` — after the merge step's push, the conv branch tip in the user repo's refs/heads = the merge checkpoint (#1211 criterion: the user's main HEAD/reflog/worktree zero change, status clean; a dirty worktree does not block — the landing never reads the user's worktree).
- `github-per-step-token` — the github-project token endpoint issues `{username:'x-access-token', password:<connection token>}`; the credential is injected only through the GIT_CONFIG_* env credential.helper, the fork+exec argv carries no token throughout (PATH-shim capture proof).
- `local-unreachable-fail-loud` — a local-form repo path unreachable on the executing machine (#1210 C backstop): prepare throws `LocalRepoUnreachableError` (reason=not_found/not_git) before clone/fetch, the runner synthesizes a step errorMessage naming the machine / the path / the reason / the fixes; zero clone attempts (no `Cloning` log line, no withGitNetRetries backoff burned), zero workspace materialization. The product answer for cross-machine development = the GitHub form (ADR 0017 acceleration slot); the copy gives both fixes.
- ~~`files-tab-disabled`~~ — overturned by #1030: the local-project Files tab is open, the read-surface/degradation recipe moved to [project-files-local.md](./project-files-local.md).

## How to get to it (user POV)

- Execution surface: create a local project (see [local-repo-api.md](./local-repo-api.md)) -> create a task -> start the build (withPlan) -> confirm -> execute -> request merge; watch the user repo's branches/HEAD/worktree.
- Files tab surface: enter the local project's detail page `/app/project/:id` (lands on the `文件` tab by default) -> file browsing, recipe see [project-files-local.md](./project-files-local.md).
- Driving: this feature has no current case; all registered ones are judged stale / host-bound and refuse to run without `--force` (the refusal prints the reason), `vp.mjs list local-daemon-executor` lists the usage:
  - `vp.mjs drive local-daemon-executor local-unreachable`: agent creation without machineId, 400 since ADR 0019.
  - `vp.mjs drive local-daemon-executor mea-live-claude-code`: runs only on the designated remote host.

## Driving it with integration E2E + fixture e2e

Preconditions: all proxy env unset (loopback through a proxy = false positive); `git` available locally.

- The daemon execution surface full chain (real server + real daemon + stub LLM + real git): `cd integration && env -u http_proxy -u https_proxy -u all_proxy NO_PROXY='*' npx vitest run test/g2t2-local-lifecycle.test.ts` -> 2 tests (hardlink / push-back / conv-branch landing + the main checkout's reflog/HEAD/status zero change + a dirty worktree does not block and the user's worktree stays intact).
- The hosted-surface non-regression control: `npx vitest run test/m3b-demo.test.ts` (the runner change touches the shared chain, must run at close).
- The argv credential discipline + the workspace landing surface: `cd apps/daemon && npx vitest run test/local-executor.test.ts` (PATH-shim capture of the fork+exec command line).
- The server claim/token wiring: `cd apps/server && npx vitest run test/g2t2-executor-wire.test.ts`.
- The Files tab surface (fixture e2e): `cd apps/web && npx playwright test e2e/project-files-local.spec.ts` (scenario `prj-local-files`; open since #1030, the old disabled pins retired).
- The unreachable fail-loud unit-test surface: `cd apps/daemon && npx vitest run test/workspace-local-unreachable.test.ts test/runner-local.test.ts` (L1-L5 + failure modes 10/11).
- The unreachable fail-loud live surface (real daemon + stub LLM): `node docs/verify/1210/drive-1210-local-unreachable.mjs` (launch.mjs first; two legs = mv the repo directory away and the step fails explicitly + mv it back and materialization is normal; recipe and reading guide = docs/verify/1210/README.md).
- The live re-probe (an isolated stack's real daemon walking the full chain of creating a local project through the UI) is pending.

## Gotchas

- **The user repo's delivery surface has only the refs/heads/cairn/ branches**: every step of plan/build/merge only pushes the conv branch, the user's main is never advanced by cairn — to verify "the user repo changed", look at the tip of `refs/heads/cairn/conv-<id>` (after the merge step = checkpointCommit), not at HEAD/reflog (they must stay byte-for-byte unchanged, snapshot-compare `git reflog main` before/after).
- A dirty worktree does not affect any step's close: the landing only writes the conv-branch ref and never reads the user's worktree — the user's uncommitted changes stay intact.
- The hardlink evidence surface (`nlink >= 2`) requires the clone source and workspacesRoot on the same volume — the test props all land in os.tmpdir(); across volumes it silently degrades to a copy.
- The github-form token issuance precondition is a github_connection row in place (the OAuth surface is [github-oauth-picker.md](./github-oauth-picker.md)); no row = the git slot is null, a private repo's failure raw text floats on the step reason, it is not a token-endpoint error.
- The Files tab read surface is open since #1030 (the server reads the localPath worktree directly): the driving recipe and degradation semantics are in [project-files-local.md](./project-files-local.md), do not assert by the "disabled placeholder" anymore.
- The live simulation of "the repo on another machine" = mv the repo directory away: the daemon's reachability judgment only looks at the local filesystem (existsSync + rev-parse), "the path is held by another machine" and "the path was mv'ed away" are indistinguishable on the execution surface (same family as the #1213 probe's PATCH-to-nonexistent-path). The deterministic fail-fast criterion = no `Cloning` line in daemon.log (zero clone attempts); do not use step duration as the criterion (it drifts under load).
- The local-project creation gate validates the path on the server filesystem (validateLocalRepoPath), so a live probe must create the project with a real existing path first and then mv the path away — creating a project with a nonexistent path directly 400s.
