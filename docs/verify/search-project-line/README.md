# ⌘K search: project line on live rows before /api/search answers

Bug: on the live stack, ⌘K task rows read `r3-lifecycle` (the fixture capture project) until `GET /api/search` answers about 500ms later. Fix in `apps/web/src/overlays/search-panel.tsx`: in live mode the client-filtered rows look up each todo's project in the live project list (`useProjects`); while that list is pending or failed the row has no project line. Fixture mode is unchanged.

## Live stack (verify-pacman, fresh database)

Probe `.claude/skills/verify-pacman/scripts/drive-search-project-line.mjs`, 12/12 checks in `result.json`. Seeds `verify-1400` and `atlas` with one todo each over REST.

- `00-natural-3000ms.png`: no interception. Samples at +23ms (before `/api/search` answered at +290ms), +503ms and +3006ms all read `#1 副行探针 alpha → verify-1400`, `#2 副行探针 beta → atlas`.
- `01-pre-response.png`: `/api/search` held. Rows carry their own project names.
- `02-server-frame.png`: `/api/search` released. Same rows, same names.
- `03-projects-pending.png`: `/api/projects` and `/api/search` both held. Rows have no project line. The board cards behind the panel still read `r3-lifecycle` here; that is `board/todo-card.tsx`, outside this fix.
- `search-api.json`, `search-response-browser.json`, `projects-api.json`, `sqlite-rows.json`: server and SQLite truth for the same names.

Rerun after `launch.mjs`:

```sh
VERIFY_REPO_ROOT=$PWD VERIFY_EVIDENCE_DIR=$PWD/docs/verify/search-project-line node .claude/skills/verify-pacman/scripts/drive-search-project-line.mjs
```

## Fixture mode, byte for byte

`fixture-dom-dump.mjs` opens ⌘K on five fixture pages (`/app?scenario=01`, `board-repos`, `newtask-projects`, `/app/todo/r3-legacy-1?scenario=01`, `/app/team?scenario=01`), types 13 queries in total and records the panel `innerHTML`. Run on a `vite build --mode fixture` of `origin/main` and of this change: both dumps hash to `767292bcf43a18b9ef4ad4b6d87ab520bf73a071` (`fixture-dom-diff.txt`). `fixture-dom-panel.json` is the dump.

```sh
node docs/verify/search-project-line/fixture-dom-dump.mjs http://127.0.0.1:<preview port> /tmp/out.json $PWD/apps/web
```

## e2e

`apps/web/e2e/search-live-project-name.spec.ts` boots the live face on stubs and holds `/api/search`.

- `e2e-old-code.txt`: both tests fail on `origin/main` code, receiving `#1 search probe alphar3-lifecycle...`.
- `e2e-new-code.txt`: the new spec plus the four existing search specs, 17 passed.
