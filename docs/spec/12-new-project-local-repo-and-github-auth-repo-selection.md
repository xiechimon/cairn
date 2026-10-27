# 12 · New-Project Local Repo and GitHub Auth Repo Selection

> Upstream reference = the todos.dev current new-project form (measured 2026-09-28). This spec locks the web new-project form's final state, the schema/executor/auth four seams, the real execution surface for GitHub binding, the 3 causes of death and guardrails. Parent issue = #352; construction tickets G2-T1..T4 unfold under #352 (blocking edges).
>
> Upstream reference router URL = `/app/projects/new`. The repo route alias `PROJECTS_NEW_HREF` = the module-exported path of `project-new-page`.

## Problem Statement

New-project form current state: the repo selector has two shapes — `新的 Todos 托管仓库` (hosted, the untouched-form submit default) and `GitHub 仓库` (manual owner/repo entry). This causes four user pain points:

1. **Cannot create a local-repo project**: a local git repo that wants to onboard pacman and run tasks has no matching shape.
2. **GitHub binding has no real execution surface**: tasks run in a bare task directory, not in the repo; commit and write-back are all in-place, diff / push unreachable.
3. **The OAuth silver bullet is not introduced**: private owner/repo or joining as a collaborator both require fork-then-paste, a heavy experience.
4. **Form chrome and input-primitive fold-in incomplete**: the project-name input's focus-visible is the UA default blue, inconsistent with the repo's indigo border token.

## Solution

The web new-project form converges to two selectable paths + one fallback:

- **GitHub repo**: after OAuth auth (reuse the #231 web flow, add the `repo` scope), pick from the user's own repo list via a picker, single-select backfill.
- **Local folder**: paste an absolute path (with `~` expansion), the server fs-validates it is a git repo and copies it to the executor workspace via a mirror clone.
- **Submit with nothing selected**: a plain no-repo project (repoKind null, the executor bare-task-directory degraded shape already supported end to end).

Supplementary terminal semantics:

- Delete the `新的 Todos 托管仓库` web entry (server REST and MCP create_project still accept `kind: 'hosted'`, existing projects unaffected).
- Name auto-backfill: local = `basename(localPath)`; github = repo name. Override only when the name field is empty or still equals the last backfilled value (never touch a user-edited name).
- Inputs drop the default blue: the same focus-visible as the shared input primitive (outline none + indigo border + 1px ring) + `-webkit-autofill` override.
- The daemon-side `kind === 'local'` branch goes through a hardlink mirror clone + conv-branch push back to the user's repo is the landing (#1211: the user's main-checkout branch/worktree is never advanced by pacman); GitHub binding goes through per-step `GIT_CONFIG_*` env credential.helper injection (does not enter argv / is not written to disk), and the conv branch pushes back to the remote.

## User Stories

1. As a developer with a local git repo, I paste my repo's absolute path in the new-project form, pacman validates it is a git repo and auto-fills the project name as the path basename, then I can save and immediately start building.
2. As a GitHub user, I click the `GitHub 仓库` button in the new-project form, get guided through OAuth once (a GitHub App, adding the `repo` scope), and after auth a search + list picker opens, single-selecting one of my repos backfills owner/repo and the project name.
3. As a developer who tested OAuth but changed machines, I only need to log in once on that machine, come back and re-select OAuth, and the project-creation flow is seamless.
4. As a developer who selected no repo, after submit it is a no-repo project (repoKind null), the executor runs in the bare task directory, matching the v1 default shape.
5. As an admin, I do not want the web form to be able to create any new `新的 Todos 托管仓库` project; existing hosted projects stay usable.
6. As a UI reviewer, I see the new-project form inputs (project name, GitHub owner/repo, local path) focus-visible highlight in the repo-unified indigo border, not the UA default blue.
7. As a developer, when web-triggered OAuth fails, pacman gives me a clear failure reason (denied / state expired / token-exchange failed) and keeps the manual owner/repo entry as a fallback, so I can always complete the GitHub binding.
8. As a developer, in a local-repo project I commit the conv branch after edits, and pacman pushes the conv branch back to my original repo (my repo gains a `pacman/conv-<id>` branch); my currently checked-out branch and worktree are never touched by pacman, merging the branch into the default branch is my own call.
9. As a developer, in a GitHub-bound project I commit the conv branch after edits, and pacman pushes the conv branch up to the GitHub remote; the initiating credential (the OAuth-injected GitHub token) is used only in that step and cleared at step end.
10. As a security reviewer, I see the github_connection table's accessToken sealed with the same SecretBox AES-256-GCM as secrets, never written to argv or logs, never leaving the server outbound boundary.
11. As a multi-machine ops person, I see the server's local-path validation degraded to "invisible means skip" (the daemon-side real-existence fallback), avoiding a false negative that kills the new-project flow.
12. As a regression tester, I see the verify-pacman feature map expanded first (GitHub OAuth + picker + local clone + local landing), and the implementation tickets' web spec / integration locator / visual geometry sync flip red-to-green with evidence entering review.

## Implementation Decisions

### Module change list (decision points, no concrete file paths)

**shared**
- `PROJECT_REPO_KINDS` vocabulary adds `'local'`; the same-source extension reaches the projectRecordSchema + createProjectBodySchema wire shape.
- New schema: the project table adds a `localPath` nullable text column. One drizzle migration; the ticket does not hardcode the number, numbered main's tail +1 at merge time.

**server**
- `GET /api/github/repos?q=` new proxy endpoint (calls GitHub `GET /user/repos` inside the lib/github.ts seam, the attached token fetched by the server from github_connection), with rate-limit and filtering.
- `POST /api/projects` validation extension: when `kind === 'local'`, `fs.existsSync` + is-git-repo (through the systemGitOps seam), failure 400; the multi-machine deployment `[designed]` degradation = skip.
- New table `github_connection` (teamId unique, login, accessToken sealed with SecretBox AES-256-GCM, scope, createdAt); DAO = re-auth overwrites, disconnect deletes the row.
- The OAuth web flow reuses the #231-family callback route, only adding the `repo` scope; state distinguishes gitHubConnection vs existingUses.

**web**
- project-new-page form: two menu rows `GitHub 仓库` / `本地文件夹`; delete the hosted-row creation entry; name backfill: local=`basename(localPath)`, github=repo name, override only when empty or still equal to the last backfilled value.
- Input focus-visible fold-in (same as the shared input primitive): outline none + indigo border + 1px ring; `-webkit-autofill` override.
- Picker panel (search + repo list); a bottom `手动输入 owner/repo` small link switches back to the current input (three degradations: public repo without auth / org repo not in list / OAuth not configured).
- Failure reasons (denied / state expired / token-exchange failed) land in the picker header/inline error row through the #243 three-way translation.

**daemon executor**
- runner adds the `kind === 'local'` branch: `git clone <localPath>` → `workspacesRoot/<projectId>/repo` (the local clone goes through hardlinks, near-zero cost); the worktree contract unchanged; the conv branch pushes back to the user repo.
- merge step = in a separate worktree `git merge origin/<default>` then push the conv branch back to the user repo refs/heads (#1211: landing = branch delivery, the user main-checkout branch/reflog/worktree get zero change; merging into the default branch is the user's own).
- The application surface `applyMergeLanding` stays hosted-only; the local landing surface is daemon-side.
- GitHub execution: the server fetches the token from `github_connection`, per-step issues `GitCredentials{username:'x-access-token', password:token}` reusing the `GIT_CONFIG_*` env credential.helper injection seam (not into argv, not on disk; cleared at step end).
- The daemon opens a worktree for `kind === 'github'` (https clone, contract unchanged); the conv branch pushes up to GitHub.
- v1 removal: the Files tab hidden/disabled for local projects (with a one-line disable hint); chief-tools/MCP create_project does not support local. [2026-10-08 #1030 overturns the first half: the Files tab is unblocked (read surface = server reads the localPath worktree directly; unreachable → categorized degradation)]

**i18n**
- en/zh sync the added/modified copy; goes through the read PR under the repo's i18n-coverage gate.

**verify / e2e**
- verify-pacman feature map adds GitHub OAuth + picker + local clone + local landing + path validation one entry each; G2-T1..T4 sync web spec + integration locator + visual geometry (the four pinned surfaces).

### Data contracts (ticket-internal final adjustments allowed)

- `GET /api/github/repos?q=` → `{ repos: [{id, owner, name, full_name, private}] }`
- `POST /api/projects` body new surface: `{ kind: 'github'|'local'|'hosted', localPath?: string, githubRepo?: { owner, repo } }`; validation per above
- `github_connection` table schema = `{ teamId: recordId unique, login, accessTokenSecret: SecretBox ciphertext, scope: string, createdAt: epochMs }`

## Testing Decisions

Testing leans end to end, verifiable visible behavior, not implementation details.

- **daemon executor E2E**:
  - the local mirror clone's hardlink count is below a direct copy (reasonable threshold decided by the OS fs)
  - local landing happy path: conv branch pushes back to the user repo refs/heads, the user main-checkout HEAD/reflog/worktree zero change (#1211)
  - dirty worktree (user has uncommitted changes) → push still succeeds, the user worktree untouched
  - GitHub execution: mock server serves `/api/github/repos`; daemon per-step token-consumption verification (capture fork+exec argv, assert no token in argv)
- **web e2e**:
  - click `GitHub 仓库` without OAuth first → shows the `认证 GitHub` button
  - OAuth callback success → picker panel opens
  - picker single-select → backfills owner/repo and the project name
  - manual-fallback link → switches back to the current input, the isGithubRepoRef gate unchanged
  - local path paste + basename backfill + submit
  - input-focus screenshot (visual geometry assertion: indigo border not UA blue)
- **server integration tests**: localPath validation three cases (not existing / not git / is git); github_connection add/overwrite/disconnect/repo proxy; OAuth callback reason three-way translation

## Out of Scope

- **PR/merge landing**: the post-build PR/merge UI of a GitHub project goes to a later ticket; this round's done semantics = the conv branch pushed up to GitHub
- **the Files-tab-hidden completion UI**: only disable + one line of copy, detailed list/editor responsiveness later [#1030 overturned: Files tab unblocked]
- **chief-tools / MCP create_project supporting local**: v1 refuses; a later spec ticket
- **the multi-machine server local-path validation alternative**: v1 degrades to skip; the alternative implementation goes to a later ticket [#1030 onward the read surface handled it positively: unreachable = 404 + categorized reason degradation (the create-validation surface is still single-machine assumption); #1210 onward the execution surface handled it positively: a local step's repo path unreachable on the execution machine = explicit failure before clone/fetch, the step errorMessage names the machine, path, reason and remedy]
- **the GitHub App registration/configuration guide itself**: the env slot `config.githubOauth` is user-configured (already configured in v0); this ticket's premise = "env App already configured"

## Further Notes

### Premortem (three causes of death + guardrails)

- **Landing writes into the user's main checkout** → guardrail: landing = conv-branch push (`refs/heads/pacman/…`), pacman performs zero writes on the user repo's worktree and current branch — the main-checkout branch/reflog/worktree is never touched (#1211)
- **server misjudges the local path under a multi-machine deployment** → guardrail: the single-machine assumption labeled `[designed]` in the ticket; validation implemented as "invisible means skip", the execution surface (daemon side) is the backstop error
- **the OAuth App scope/callback conflicts with the existing GitHub Copilot provider OAuth config** → guardrail: reuse the same App and only add scope, the callback route distinguishes families by state; the not-configured error family already exists; the manual owner/repo fallback guarantees the GitHub binding is always available

### Relationship to #347 and #350

- #347 (detail-page send button covered by the chief floating button, fixed) = real occlusion; this spec is not involved.
- #350 (providers/machines row "button unclickable" = row-clickability misdirection, wontfix) = this spec and spec 11 are sibling files, the row-clickability fold-in (A7 in spec 11) is already in action.

### Cadence

Construction tickets G2-T1..T4 unfold under #352:
- G2-T1 (shared + server schema/API) = unblocked, built first
- G2-T2 (daemon executor) = blocked by G2-T1 + G2-T4 (github execution credentials depend on the connection row having a token)
- G2-T3 (web form) = blocked by G2-T1
- G2-T4 (GitHub auth + picker) = blocked by G2-T1

Frontier initial `{G2-T1}`; T1 done opens `{T2, T3, T4}` three-way concurrent.