# local project Files tab (read-face opening + unreachable degradation)

#1030 (the 2026-10-08 user ruling) overturns spec 12's "Files tab hidden/disabled for local projects" out-of-scope: a local project's `文件` tab works, the read face = the server directly reads the `localPath` worktree on the line (the directory-resolution branch `requireRepoReadDir`, git read primitives same shape for bare repos / worktrees, no checkout requirement). The github form still has no local read face (404, the web does not send the request). The relevant spec 12 rows are annotated as overturned by this ticket.

## Sub-features

- `local-read-face` — the five read faces (tree/file/files/branches/commits) allow `repoKind='local'`: the ref defaults to HEAD (the worktree's current checkout), the commits face lands on the default branch (`listBranches` first); the hosted form keeps the `ref=main` existing convention (seed commits are always main). The web side's tree/commits/file send requests for the local form without passing the ref.
- `branch-chip-echo` — the branch chip shows the tree payload's ref echo: hosted='main', local='HEAD' (live); the fixture face = `project.branch` (prj-local-files pins `trunk`, proving the local default branch is arbitrary).
- `unreachable-degradation` — localPath ineligible (a multi-machine deployment the server cannot see / the directory deleted / no longer a git repo) -> 404 + reason code (`not_found`/`not_git`, the vocabulary reuses #386 `PROJECT_LOCAL_ERROR_REASONS`); the web renders the `本地仓库当前无法读取。` main row + the reason split-translation row, FilesPane does not render (no empty tree, no fake history face). `repoKind='local'` with an empty localPath column (row-integrity break) -> 404 explicit red without reason.

## How to get to it (user POV)

- Create a local project (see [local-repo-api.md](./local-repo-api.md)) -> the project page's `文件` tab (the default landing) -> branch chip + file rows + viewer + history seg.
- Driving (`vp.mjs list project-files-local` lists all cases and usage):
  - `node .claude/skills/verify-cairn/scripts/vp.mjs drive project-files-local local-files`: the local project's files tab, hosted control, deleted-repo degradation.

## Driving it with drive-1030-local-files.mjs

Preconditions: `launch.mjs` already started the isolated stack; proxy env all unset (loopback through a proxy = 502 false positive); the local machine has `git`.

- One-command three phases: `env -u http_proxy -u https_proxy -u all_proxy NO_PROXY='*' VERIFY_REPO_ROOT=<worktree> node .claude/skills/verify-cairn/scripts/drive-1030-local-files.mjs` -> console 20 PASS/FAIL + `evidence:<dir>` (result.json + responses.json + 5 screenshots).
- Phase A: a true git worktree repo (default branch `trunk` + README marker line) -> REST five read-face truth + browser Files tab opening/chip=HEAD/row->viewer/history.
- Phase B: hosted control zero regression (bare repo push a real README then the same page chain, chip='main').
- Phase C: delete the repo directory -> reload shows the degradation copy + FilesPane does not render + API 404+reason.
- The script builds and self-reaps its props (mkdtemp real repo / hosted clone); the hosted push goes through the REST-created git API key (Basic auth).

## Gotchas

- **local's ref must not hardcode 'main'**: the local repo's default branch is arbitrary (the probe pins `trunk`); the web passes undefined for local -> the server lands HEAD, the file viewer's ref same convention (a miss = 404 false red).
- The unreachable degradation pins on `treeQ.isError` (the local form) - the fixture face live=false, the tree query always disabled, **e2e cannot pin the degradation face**, it belongs to this probe's phase C + server vitest (project-local.test.ts F2/F3/F4).
- `requireRepoReadDir` does `existsSync + isGitRepo` pre-check per local read: without the pre-check runGit spawn ENOENT 500s directly (the "no 500" mechanism root cause).
- The fixture-face data source = the `prj-local-files` scenario (`projectLocalFiles`, branch='trunk' + its own README/commits, no longer reusing the hosted demo content).
- The e2e face = `e2e/project-files-local.spec.ts` (4 cases; the old `project-files-local-disabled.spec.ts` retired with the ticket).