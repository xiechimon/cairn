# Project "history" list commit detail face (hosted + local dual form)

#1102: the project page's `文件|历史` segmented "history" rows have been read-only display (static li) since #149, the server has only the `GET /api/projects/{id}/commits` list endpoint - clicking a row does nothing. This ticket adds a commit detail face: the row becomes a clickable button, the right-pane viewer slot renders that commit's file-level unified diff relative to the **first parent**. Same face and same gate as [project-files-local.md](./project-files-local.md) / [project-files-drill.md](./project-files-drill.md): `requireRepoReadDir` single-source directory resolution (hosted bare / local worktree), the github form and an unreachable local are the same-family 404.

## Sub-features

- `commit-detail-endpoint` — `GET /api/projects/{id}/commits/{sha}` ([inferred] route, registered in wire.test INFERRED_ROUTES): the payload = the list row's same five fields (sha/shortSha/message/authorName/at, the %x00 format string same source as readCommitHistory) + `files: DocumentDiffFile[]` (parseUnifiedDiff output, same family as the changes face). The envelope single-source shared projectCommitDetailResponseSchema.
- `first-parent-diff` — the diff convention = `git show --patch --first-parent`: a root commit (no parent) = all files new relative to the empty tree; a merge commit = relative to the first parent (the default combined diff is always an empty set for a clean merge, turning "has changes" into "no changes", deprecated after the 2026-10-10 three-shape measurement); an empty commit / pure binary = files=[] defined state (parseUnifiedDiff filters no-hunk lines).
- `detail-viewer-reuse` — the right-pane viewer splits per seg: the history seg = the detail face (a head with meta info + close button), the files seg = the existing file viewer zero regression; the diff render reuses the docpane `DiffFileBlock` (allowFullFile=false removes the full-text button - no full-text data source), no separate render.
- `commit-selection-key` — the selected state stores a (projectId, sha) pair (the fileSel/dirSel same discipline); sha enters the queryKey, switching commits keys the cache; the row-selected carrier = aria-current (#910 ruling 3).
- `detail-degradation` — an unreachable sha / injection shape = 404 (the resolveCommitOr404 seam, rev-parse --verify --end-of-options); the local directory gone / not git = 404 + reason (not_found/not_git), the web translates per LOCAL_ERROR_REASON_COPY into `提交详情加载失败` + the split-translation row, no 500 no empty tree; when the whole local repo is unreachable FilesPane same-gate does not render (no fake history rows).

## How to get to it (user POV)

- A hosted project (with commits) or a local project (localPath reachable) -> the project page's `文件` tab -> history seg -> click a commit row -> the right pane shows the meta head + file-level diff; click another row to switch; the X button clears the selection.
- Driving (`vp.mjs list project-commit-detail` lists all cases and usage):
  - `node .claude/skills/verify-cairn/scripts/vp.mjs drive project-commit-detail commit-detail`: the history row opens the commit diff, switch, deleted-repo degradation.

## Driving it with drive-1102-commit-detail.mjs

Preconditions: `launch.mjs` already started the isolated stack; proxy env all unset; the local machine has `git`.

- One-command three phases: `env -u http_proxy -u https_proxy -u all_proxy NO_PROXY='*' VERIFY_REPO_ROOT=<worktree> node .claude/skills/verify-cairn/scripts/drive-1102-commit-detail.mjs` -> console 25 PASS/FAIL + `evidence:<dir>` (result.json + responses.json + 6 screenshots).
- Phase H: hosted bare repo push a real commit chain (seed -> README -> side branch -> main-side another -> --no-ff merge) -> REST five criteria + browser row-click/switch/close full chain.
- Phase L: local true repo (default branch trunk, root commit + second commit) -> the root commit's all-files-new dual-side pin.
- Phase D: delete the local repo directory -> API 404+reason and the browser whole-pane human-readable degradation.
- The script builds and self-reaps its props (mkdtemp real repo / hosted clone); the hosted push goes through the REST-created git API key (Basic auth).

## Gotchas

- **A merge commit's default combined diff is always an empty set**: the detail face must be `--first-parent`, otherwise a clean merge's detail becomes "no displayable changes" (a false defined state). server vitest pins the merge detail files == ['side.txt'].
- **React Query switching back to a cached sha makes zero requests**: the "switch does not cross" assertion pins content ownership (the file row present/exiting), not the request count; e2e's first run asserted by request sequence, a false red once, then changed to the set criterion.
- **When the stub world does not provide the tree face, the local form's whole pane degrades**: the cross-project selected-state test's second project must be hosted, otherwise the history rows never render (the treeQ.isError gate).
- The fixture-face row's `files` slot missing key = files:[] (the defined state), same shape as the seed empty-commit truth; the row data must carry meat to guard against dead buttons (the fixture-face no-dummy-button discipline).