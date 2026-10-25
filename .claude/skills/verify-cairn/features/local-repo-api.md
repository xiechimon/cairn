# Local-repo projects and GitHub connection (server API surface)

Users bring an existing local git repo into cairn as a project (one of spec 12's three forms), plus the GitHub authenticated repo-selection connection data surface. G2-T1 (#359) landed the server half: local-path three-state validation, the github_connection sealed table, the repo-picker proxy endpoint. The web form entry landed with G2-T3 (#360), the UI-surface verification goes through [project-new-form.md](./project-new-form.md); the OAuth auth + picker UI surfaces landed with G2-T4 (#361), see [github-oauth-picker.md](./github-oauth-picker.md) — this entry keeps only the API data surface.

## Sub-features

- `local-create` — `POST /api/projects {kind:'local', localPath}`: server-side `~` expansion + existence + git-worktree judgment, any failure 400s (reason codes: not_found / not_git / not_absolute, #386); on pass 201, the record/DB row carries the normalized localPath.
- `hosted-compat` — the legacy `repoKind:'hosted'` creation surface does not regress (bare repo provisioning + cloneUrl).
- `repos-proxy` — `GET /api/github/repos?q=`: the token comes from github_connection (SecretBox ciphertext), 404 when not connected; once connected it proxies GitHub `/user/repos` (the connection write surface is in github-oauth-picker.md).
- `connection-table` — the github_connection table shape: one row per teamId, accessToken only as a cipher column, no plaintext token column.

## How to get to it (user POV)

- Direct API: `curl -X POST http://127.0.0.1:<VERIFY_PORT>/api/projects -H 'content-type: application/json' -d '{"name":"x","kind":"local","localPath":"/abs/path/to/repo"}'`.
- The web new-project form's `本地文件夹` entry: landed (G2-T3/#360), the driving recipe is in [project-new-form.md](./project-new-form.md).
- Driving (`vp.mjs list local-repo-api` lists all cases and usage):
  - `node .claude/skills/verify-cairn/scripts/vp.mjs drive local-repo-api local-repo-api`: local-project API three-state validation + GitHub-unconnected 404.

## Driving it with probe-local-repos.mjs

Preconditions: `launch.mjs` has the isolated stack up (fresh DB); all proxy env unset (loopback through a proxy = 502 false positive); `git` available locally.

- One-shot full chain: `env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY NO_PROXY='*' VERIFY_REPO_ROOT=<worktree> node .claude/skills/verify-cairn/scripts/probe-local-repos.mjs` -> 11 PASS/FAIL lines on the console + `evidence:<directory>` (result.json + responses.json).
- The script builds its own props (mkdtemp + `git init` + an empty-commit real repo / a non-git directory) and cleans up after itself; the three-state assertions = 400+reason=not_found (nonexistent) / 400+reason=not_git (non-git) / 201 (a real repo, record.localPath = the original value).
- Second pair of eyes: `responses.json` collects all HTTP responses; the SQLite read-only assertions cover the project.localPath column value + `PRAGMA table_info('github_connection')` whose column set is exactly teamId/login/accessTokenCipher/scope/createdAt.

## Gotchas

- **This entry = the server API data surface**: the web form surface is in [project-new-form.md](./project-new-form.md) (G2-T3 landed); the OAuth + picker live surfaces are in [github-oauth-picker.md](./github-oauth-picker.md) (G2-T4 landed); the local clone execution surface (daemon) belongs to G2-T2 — name the owning surface when claiming coverage.
- `~` expansion walks the server process's HOME — a live probe does not change HOME (the integration test `apps/server/test/project-local.test.ts` covers it by injecting homeDir / changing env).
- The repos proxy's "connected" path needs a github_connection row for a live run; the REST write surface landed with G2-T4 (authorize -> callback), but walking it through needs a real GitHub App credential + a human in the loop for authorization, do not hand-INSERT to fake it (the in-process proof of the sealing discipline is in `apps/server/test/github-connection.test.ts` and `github-oauth.test.ts`: ciphertext-column scan + the Authorization header's sole consumption point + the token-never-enters-wire assertion).
- 8791/5273 is often held by another lane — switch `VERIFY_PORT`/`VERIFY_WEB_PORT`, do not kill.
