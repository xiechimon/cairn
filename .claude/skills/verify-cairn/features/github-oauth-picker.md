# GitHub connection auth + repo picker (new project)

Users pick `GitHub 仓库` in the new-project form: unauthenticated -> the `认证 GitHub` button goes through OAuth (a same-tab jump to the GitHub authorization page, the callback 302s back to this page and auto-opens the picker); authenticated -> the picker trigger button opens an anchored popup (search / repo-row single-select backfilling owner/repo and the project name / a disconnect button); all three degradations (public repo needs no auth / org repo not in the list / OAuth not configured) go back to the status-quo input via the `手动输入 owner/repo` link (the isGithubRepoRef submit gate is unchanged). #361 (spec 12 G2-T4); the connection data surface (schema/DAO/repos proxy) is in [local-repo-api.md](./local-repo-api.md).

## Sub-features

- `auth-face` — unauthenticated, picking `GitHub 仓库` = the auth button + the manual-fallback link; clicking auth live = POST github/oauth/authorize -> a same-tab jump to the authorization page; OAuth env unset = the authorize 400's raw text lands in an inline error row.
- `connection-status` — `GET /api/teams/{id}/github/connection`: unconnected `{connected:false}` exact shape; connected `{connected:true,login,scope}` (no token field, 02 §8).
- `disconnect` — `DELETE` on the same path: row deletion idempotent (204 when missing); the UI = the picker's header `断开连接` button -> back to the unauthenticated face.
- `picker` — the authenticated face: the trigger button opens the popup, the search box filters full_name locally (data = `GET /api/github/repos`, a single page of 100), row single-select -> backfills owner/repo + the project name (the backfill rule: the name is overwritten only when empty or equal to the last backfilled value).
- `manual-fallback` — the manual link -> the owner/repo input (the status-quo face); a legal ref + a name -> the create button unlocks -> submitting creates a repoKind=github project (the public-repo-no-auth full chain).
- `callback-landing` — the callback 302s back to `/app/project/new?oauth=connected|error&reason=…&github=connection`: connected auto-opens the picker; the error reasons fall into three translations landing in an inline row; the parameters are read then cleared, not replayed. (A real OAuth loop needs real App credentials + a human in the loop, see Gotchas.)

## How to get to it (user POV)

- Web: sidebar / project page `新建项目` -> `/app/project/new` -> the repo row -> `GitHub 仓库`.
- API: `GET|DELETE /api/teams/{id}/github/connection`, `POST /api/teams/{id}/github/oauth/authorize`, `GET /api/github/repos?q=` (the T1 surface).
- Driving (`vp.mjs list github-oauth-picker` lists all cases and usage):
  - `node .claude/skills/verify-cairn/scripts/vp.mjs drive github-oauth-picker oauth-and-manual-repo`: the unauthenticated face's auth button + the manual-fallback full chain of creating a github project.

## Driving it with probe-github-oauth.mjs

Preconditions: `launch.mjs` has the isolated stack up (fresh DB); all proxy env unset; chromium available (the repo ships @playwright/test).

- One-shot full chain: `env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY NO_PROXY='*' VERIFY_REPO_ROOT=<worktree> node .claude/skills/verify-cairn/scripts/probe-github-oauth.mjs` -> per-line PASS/FAIL on the console + `evidence:<directory>` (result.json + responses.json + auth-face/error-face/created-project screenshots).
- The authorize dual-form adaptive: OAuth env (`CAIRN_GITHUB_OAUTH_CLIENT_ID/SECRET`) unset -> break at 400 not-configured + clicking auth in the UI lands the inline error row; set -> break at 200 with the authorization-URL shape (scope=read:user repo) and the UI segment skips clicking auth (it does not follow the jump to the real authorization page).
- Second pair of eyes: the project created via the manual fallback is judged through the `GET /api/projects` projection as repoKind=github + githubRepo at its original value.

## Gotchas

- **A real OAuth loop cannot be automated**: the authorization page -> callback -> token sealed into a row -> the picker list stretch needs a real GitHub App credential + a human in the loop for login/2FA. The in-process full-chain proof is in `apps/server/test/github-oauth.test.ts` (14 mock-upstream cases: happy path lands a row / GET /user failure attributed to exchange / denied / state expired / the two families do not cross / the token never enters the wire); the live probe only verifies the surfaces that need no credentials, do not pretend it is full coverage.
- The callback landing branches by state kind: the connection family -> `/app/project/new`, the provider family (#231) -> `/app/resources/providers`; a state not in the registry (kind undecidable) defaults to the providers page. Verify the landing with a server test, do not hand-craft a state on live.
- The picker list has live data only when the github_connection row holds a real token (after the disconnect-face verification, return to unconnected); on a no-credential stack `GET /api/github/repos` can only verify the 404 face.
- The fixture surface (scenario=github-picker) behavior is pinned in `apps/web/e2e/project-new-github.spec.ts` (15 cases), the live probe does not repeat it.
- 8791/5273 is often held by another lane — switch `VERIFY_PORT`/`VERIFY_WEB_PORT`, do not kill.
