# New-project form (web face)

The user enters `/app/project/new` from the sidebar `新建项目`, fills the project name, picks the repo form (GitHub repo / local folder / none), creates the project and lands on the project page. G2-T3 (#360) land: a two-row menu (the hosted row's create entry removed, none = a plain no-repo project), name auto-backfill (local = basename, github = the repo segment, not overwritten after a manual edit), local-path 400 red error row, input focus-visible spot family consolidated (consuming --focus-ring). The server validation half is in [local-repo-api.md](./local-repo-api.md); the OAuth picker goes to G2-T4, backfilled into this file after it lands.

## Sub-features

- `menu-two-rows` — the repo menu exactly two rows `GitHub 仓库` / `本地文件夹`; the hosted row's create entry is gone (server REST/MCP still accepts hosted, existing projects untouched).
- `name-backfill` — local = `basename(localPath)` (tolerates a trailing slash), github = the repo segment of a valid `owner/repo`; overwritten only when the name is empty or still equals the last backfilled value, a path change no longer overwrites after a manual edit, clearing restores it.
- `face-swap` — the selection swaps the input face (github = owner/repo inputs, local = an absolute-path input) + the swap button re-opens the menu; the old input face exits when the form switches.
- `submit-gates` — name empty / local path empty / invalid github ref (the isGithubRepoRef same-source gate) = the create button disabled.
- `local-error-row` — a server 400 classifies the red error row by the reason code, three states (not_found = path does not exist / not_git = not a git repo / not_absolute = an absolute path is required; no code / unclassified passes the raw text through, #386), blocking navigation; editing the path clears the stale error.
- `focus-ring` — project-name / GitHub / path input focus-visible = outline none + the spot-family border (consuming --focus-ring, dark #cba6f7) + a 1px ring (the shared input primitive recipe) + a `-webkit-autofill` override, not the UA default blue.
- `create-chains` — three submit chains into the DB: local (repoKind/localPath), github (repoKind/githubRepo), none (repoKind NULL no-repo project), success navigates `/app/project/<id>`.

## How to get to it (user POV)

- Sidebar `新建项目` -> `/app/project/new` (the live face, URL without `?scenario=`).
- The fixture-face interaction-chain regression (menu / backfill / focus computed style / submit-body stub assertions) is in `apps/web/e2e/project-new-repo.spec.ts`, it does not go through this harness.
- Driving (`vp.mjs list project-new-form` lists all cases and usage):
  - `node .claude/skills/verify-cairn/scripts/vp.mjs drive project-new-form new-form`: new-project form menu, name backfill, three create chains.

## Driving it with drive-project-new-form.mjs

Preconditions: `launch.mjs` already started the isolated stack (fresh DB; a worktree lane passes `VERIFY_REPO_ROOT`); proxy env all unset; the local machine has `git`.

- One-command full chain: `env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY NO_PROXY='*' VERIFY_REPO_ROOT=<worktree> node .claude/skills/verify-cairn/scripts/drive-project-new-form.mjs` -> the console prints per-check PASS/FAIL + `evidence:<dir>` (result.json + responses.json + 6 screenshots).
- The script builds its own props (mkdtemp + `git init` empty-commit real repo / a non-git directory / a nonexistent path), self-cleans after running.
- User actions = real clicks and real fills: open the menu and pick a row, fill the path and watch the name backfill, manually edit the name and verify no overwrite, click create and walk navigation; the error row uses the real server 400 (not a stub).
- The second eye: `GET /api/projects` record truth (repoKind/localPath/githubRepo) + SQLite read-only rows (the local row and the none row repoKind NULL); the focus face = computed style (outline/border/box-shadow against `--focus-ring` dark rgb(203,166,247)) + screenshot `03-focus-ring-spot.png`.
- Key screenshots: `01-menu-two-rows` / `02-backfill-local` / `03-focus-ring-spot` (the AC "spot-family border not the UA default blue") / `04-error-path-not-found` / `05-error-not-git` / `06-created-local-project`.

## Gotchas

- **The `-webkit-autofill` override cannot be live-driven** (the browser exposes no trigger face) - rely on the CSS-recipe review + the e2e computed-style pin of the focus face; do not claim the probe verified autofill.
- The github face is auth-gated (#361): unauthenticated, the `owner/repo` input does not exist, you must first click the `手动输入 owner/repo` fallback link to reveal it - the probe clicks that link before every github-input fill (pick row -> click link -> fill), missing it is a 30s fill timeout; there are several spots, do not fix only the first one.
- The error-row classification consumes the structured `reason` code in the server 400 response (the vocabulary single source = shared `PROJECT_LOCAL_ERROR_REASONS`, since #386); the message copy is no longer the contract, the server changing error copy freely does not affect it - if the server validation throws a new code, the web classifies it as unclassified and passes the raw text through, the probe reds to remind alignment.
- The none-form submit body carries no `kind`/`repoKind` - a repoKind of null/absent in the record both pass (`== null` judgment), do not tighten to strict undefined.
- vite dev's first-load cold transform is slow, `gotoNew` waits up to 20s; if the page is not up, doctor first, do not rush to change assertions.
- 8791/5273 are often held by another lane - change `VERIFY_PORT`/`VERIFY_WEB_PORT`, do not kill.