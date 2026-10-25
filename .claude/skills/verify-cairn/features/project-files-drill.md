# Project Files-face directory drill-down (hosted + local dual form)

#1097: the project page's `文件` tab tree rows consume `entries[].type` / `entries[].path` from `projectTreeResponseSchema`, which existed but neither end used - folders and files same-shape same-click (clicking a directory = taking the directory name as a file path to read -> "file load failed"), and the route layer never passed the `path` query to `readTree` (the tree is always only the top level). This ticket completes the drill-down: the route passes `path` through (readTree/lsTree zero changes, the `isSafeRepoPath` guard already in place natively), the row data changes to `{name,path,type}`, directory rows get the Folder glyph + click drill-down, the breadcrumb returns to the parent, the selected key uses the full path. Same face as [project-files-local.md](./project-files-local.md): #1030 opened the local read face, this ticket stacks the drill-down on both readable forms.

## Sub-features

- `tree-path-passthrough` — `GET /api/projects/:id/tree?path=<dir>` returns that directory's single level (entries' path carries the full path prefix, the name is bare), the `path` field echoes the requested directory; default/empty = the top level. A nonexistent directory = 200 + empty entries (git ls-tree semantics). The server pin = project-local.test.ts "tree route path parameter passthrough (#1097)" P1-P5.
- `folder-vs-file-rows` — directory rows `data-tree-entry="folder"` + the Folder glyph, file rows `data-tree-entry="file"` + the FileTab glyph (not just a color); clicking a directory row = re-send `tree?path=` (**not** `file?path=` - the reverse pin of the original bug), clicking a file row = the existing viewer chain zero regression.
- `breadcrumb-nav` — renders only inside a subdirectory (zero top-level visual drift): a root segment button `根目录` + each segment button (clickable back to the middle levels) + the current segment `aria-current="location"` echo. The display follows the directory state (instant feedback on switch); the payload `path` echo contract pinned by server vitest.
- `path-keyed-selection` — the selected state and `file?path=` both use the full path: same-name files across directories do not cross (after going back up, the old directory's selected row does not steal aria-current, the preview keeps the last selected full path).
- `empty-and-loading-states` — an empty directory (entries=[]) -> `此目录为空。`; the current directory key in flight with no cached data -> `加载中…` (the empty state does not preempt). The live face cannot produce a truly empty directory (git does not track them), these two states belong to e2e W5/W6 + server P5, not acted in the live probe.

## How to get to it (user POV)

- A hosted project (with commits) or a local project (the line's localPath reachable) -> the project page's `文件` tab -> click into a directory row -> the breadcrumb back up; click a file row to open the viewer.
- Driving (`vp.mjs list project-files-drill` lists all cases and usage):
  - `node .claude/skills/verify-cairn/scripts/vp.mjs drive project-files-drill folder-drill`: the files-tab directory drill-down, breadcrumb back up, viewer.

## Driving it with drive-1097-folder-drill.mjs

Preconditions: `launch.mjs` already started the isolated stack; proxy env all unset; the local machine has `git`.

- One-command two phases: `env -u http_proxy -u https_proxy -u all_proxy NO_PROXY='*' VERIFY_REPO_ROOT=<worktree> node .claude/skills/verify-cairn/scripts/drive-1097-folder-drill.mjs` -> console 20 PASS/FAIL + `evidence:<dir>` (result.json + responses.json + 7 screenshots).
- Phase H: hosted bare repo push nested real content (root README.md + docs/README.md same-name control + docs/setup.md + docs/guide/deep.md three levels) -> REST tree?path= level by level + browser drill/breadcrumb/same-name-no-cross/deep-nest full chain.
- Phase L: local true repo (default branch trunk) same nest -> drill-down + viewer stacked on chip=HEAD.
- The script builds and self-reaps its props (mkdtemp real repo / hosted clone); the hosted push goes through the REST-created git API key (Basic auth).

## Gotchas

- **stubBoot's projects stub must carry the query**: the web hits `/api/projects?teamId=`, a bare `**/api/projects` pattern does not match -> the whole page has no project rows, file rows never render (the first run 7/7 all-red root cause, e2e project-files-tree.spec same).
- **The breadcrumb does not follow the payload echo**: while switching directories in flight `treeQ.data` is the old key's data, the display follows the directory state; the echo contract belongs to server vitest P1-P3.
- **live cannot produce an empty directory**: git does not track empty directories, empty/nonexistent directories both return entries=[]; the empty state and loading state pinned in e2e W5/W6 (stub controllable delay) + server P5.
- Directory rows and file rows both carry `.prj-file-row` (the cross-domain positioning alias, dead-buttons and other existing specs' counts have no directory rows on the fixture face, zero drift); the discriminating carrier = `data-tree-entry`.
- The e2e face = `e2e/project-files-tree.spec.ts` (W1-W7, stubBoot carries the board-dnd-live discipline); the fixture face has no directories (string files degrade to top-level blob rows), the drill-down behavior only pinnable on the live/stub face.