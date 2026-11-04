⌘K search project line on live rows: new probe `scripts/drive-search-project-line.mjs`.

Pure live stack, no daemon, no LLM. Seeds two projects (`verify-1400`, `atlas`) with one todo each over REST, then three browser legs: no interception with samples at +0 / +500 / +3000ms after typing, `/api/search` held to assert the pre-response frame and then released, and `/api/projects` held so the rows have no project line. Truth: `/api/search` and `/api/projects` JSON, SQLite `project` / `todo` rows.

Run: `VERIFY_REPO_ROOT=<worktree> VERIFY_EVIDENCE_DIR=<worktree>/docs/verify/search-project-line node .claude/skills/verify-pacman/scripts/drive-search-project-line.mjs` after `launch.mjs`. Evidence: `docs/verify/search-project-line/`.

Gotcha: `page.unroute()` releases routes still held by its handler, so a later `route.continue()` on them throws `Route is already handled!`. Continue the held routes first, then unroute.
