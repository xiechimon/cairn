# Branch model: a thread owns one stored work ref

Question: should cairn's git branch model be redesigned? Today the work branch is derived from the build id. No task can work on an existing branch or open PR, and a dispatch asking to "push to the existing PR branch" was blocked.

Base: origin/main `5633aae6d9232ca8f1bd9bccd1b5df3578a900a5` (links below use `M` = `https://github.com/xiechimon/cairn/blob/5633aae6d9232ca8f1bd9bccd1b5df3578a900a5`). Marks: `实测` = read or run first-hand this session; `推断` = derived from `实测`; `猜测` = everything else.

Sources row: no `SOURCES.md` row fits exactly. The nearest rows are "CI, merge queues, repo automation" (GitHub docs, the action's own source) and "Chat / agent product UX" (t3code, Cursor, Amp). Every product in the brief is covered below. Gaps are listed in §2.

## 1. Current model

| # | Fact | Mark | Where |
|---|---|---|---|
| C1 | The branch name is a pure function of the build id: `conversationBranch(id) = BRAND.branchPrefix + id`, with `branchPrefix: 'cairn/conv-'`. It is not stored anywhere. | `实测` | `M/packages/shared/src/brand.ts#L37`, `#L91-L93` |
| C2 | The same derivation is repeated in about 15 consumers: daemon `workspace.ts`, `runner.ts`, `orb/{worker,delivery}.ts`; server `builds.ts`, `ci-loop.ts`, `git.ts`, `local-merge.ts`, `machine-finish-step.ts`, `blocker-handoff.ts`; web `api/mappers.ts`. | `实测` | `git grep conversationBranch origin/main` |
| C3 | Spec 23 states it outright: "buildId ≡ conversationId ≡ branch name … a new build necessarily means a new branch". | `实测` | `M/docs/spec/23-rework-to-original-branch-and-pr-convergence.md#L7` |
| C4 | Workspace: `prepare` derives the branch and puts the worktree at `<workspacesRoot>/<buildId>`.<br>• Existing worktree: reused. It throws `RemoteBranchDivergedError` if the remote is ahead and HEAD is elsewhere.<br>• Otherwise: deletes the local branch and runs `worktree add` from `origin/<branch>` if that exists, else from `origin/<base>`. | `实测` | `M/apps/daemon/src/workspace.ts#L109`, `#L229-L276` |
| C5 | The agent opens the PR itself with `gh pr create --head <work branch>`. The prompt note says: never create or switch branches, never open another worktree, the PR head must be this branch. | `实测` | `M/packages/shared/src/records/prompts.ts#L291-L305` |
| C6 | Contradiction: `GITHUB_OVERLAP_RULE` asks the agent to list overlapping open PRs and "choose: build on that branch, wait, or proceed". The work-branch note forbids the first option. This is the likely cause of the blocked dispatch. | `实测` (both texts); `推断` (the cause) | `prompts.ts#L287` vs `#L293` |
| C7 | End of step: the daemon detects "work branch drift" (HEAD ≠ contract branch) and only logs it. It commits with `agent displayName <machineId@cairn.local>`, rewrites unpublished commits to add the human `Co-authored-by`, and pushes without force (`push origin ref:ref`). | `实测` | `M/apps/daemon/src/runner.ts#L1950-L2003`; `step-attribution.ts`; `git.ts#L571` |
| C8 | Artifact detection is widened to any branch with new commits that is the contract branch or does not start with `cairn/conv-`. The PR probe then tries up to 3 heads (contract, drift, artifacts). | `实测` | `runner.ts#L2026-L2031`, `#L2118-L2124` |
| C9 | PR linking: at finish, the server lists open PRs with `head=<owner>:<conv branch>`, keeps same-repo ones, takes the newest and writes `build.prNumber/prUrl`. | `实测` | `M/apps/server/src/services/machine-finish-step.ts#L243-L270` |
| C10 | `thread_pr` (D109) has `UNIQUE(buildId)` and `UNIQUE(teamId, repo, number)`. `pr-watch` only watches `todo.latestBuildId` builds with a `prNumber`, and prunes rows whose build is no longer latest. | `实测` | `M/apps/server/drizzle/0111_thread_pr.sql`; `pr-watch.ts#L141-L156` |
| C11 | Rounds inside one thread:<br>• Review rejection or restart with feedback reuses the newest PR build, so the same branch and same PR (spec 23 R1).<br>• A closed PR gets a new build and a new branch (R3).<br>• A merged PR: the server refuses with "Create a new task …; this task cannot merge a second delivery".<br>• Locally merged: a new build and new branch. | `实测` | `M/apps/server/src/services/builds.ts#L326-L362`, `#L414-L437` |
| C12 | CI fix rounds: 3 per head. Conflict rounds: 2, using a prompt to merge base in, with no rebase or force-push. Gated on `isOwnPull`. `adoptPull` re-records a different PR found on the same conv branch. | `实测` | `M/apps/server/src/services/ci-loop.ts#L56`, `#L77`, `#L434-L456`, `#L551-L575` |
| C13 | Merge (`requestMerge`):<br>• `isOwnPull` requires a same-repo head and `headRef === conv branch`.<br>• Requires opener write association and base = project base.<br>• On xiechimon/cairn, a bot opener is refused (it goes to `merge-pr.sh`).<br>• `pull.headSha` must equal the last checkpoint cairn pushed, else 409 ("someone pushed, or clicked Update branch").<br>• Merge is pinned with `sha: checkpoint`. | `实测` | `builds.ts#L2191-L2275`; `M/apps/server/src/lib/github.ts#L138-L140` |
| C14 | Cleanup: the daemon removes the worktree and the local branch after a 7-day TTL. cairn never deletes remote branches. The repo has `delete_branch_on_merge: true`, `allow_update_branch: true` and `allow_merge_commit: false`. 5 `cairn/conv-*` heads remain on origin. | `实测` | `workspace.ts#L408-L458`; `gh api repos/xiechimon/cairn`; `git ls-remote` |
| C15 | Coordinator: `create_todo(projectId, title, spec, output)`, `open_thread(todoId)`, `message_thread(todoId, content)`. There is no branch, PR or base parameter. It can read `pull_requests` (headRef, baseRef) but cannot act on one. | `实测` | `M/packages/shared/src/protocol/chief-tools.ts#L375-L389`, `#L711-L733` |
| C16 | Bot identity: the dispatch side pushes and opens PRs as `cairnwright[bot]` through `as-bot.sh`. #3413 moved step git credentials and the App token cache into server and daemon (`step-app-credential.ts`, `github-app-token.ts`). Step commit author is still the agent name at `@cairn.local` (C7), not `cairnwright[bot]`, so commits are unverified. | `实测` (doc, PR file list, runner.ts#L827-L830); `推断` (unverified) | `M/docs/ops/agent-bot-identity.md`; PR #3413 |

Root cause (`推断` from C1, C3, C9, C13): one identifier, the build id, stands for three things: the run, the branch and the PR key. Every "continue X" request therefore needs a new id, which means a new branch. A branch cairn did not name can never be the work branch, the PR key or the merge target.

## 2. Prior art

| Source | Naming | Follow-up / fix round | Existing PR by others | Several tasks | Base moved | Forks | Cleanup | Identity |
|---|---|---|---|---|---|---|---|---|
| Codex cloud | `codex/<slug>`, not configurable (`实测` forum [1]; `推断` from live PR heads) | `@codex fix …` on a PR "can push a fix back to the branch when it has permission" (`实测` [2]). The early web UI could not update a PR (`实测` forum [3]) | Uses the PR as context (`实测` [2]) | One container per task at a branch or SHA (`实测` [4]) | not documented | not documented | not documented | Acts as the user, unverified commits (`实测`, gh api) |
| Copilot coding agent | `copilot/`, and the agent "can only push to that branch" (`实测` [5]) | "By default, Copilot pushes commits directly to the pull request branch"; it opens a new PR only when asked (`实测` [6]) | Works on PRs "you or others created", with write access to that branch; it only answers commenters with write access (`实测` [6]) | "one branch at a time … one pull request per task" (`实测` [7]) | "Fix with Copilot" resolves conflicts; merge vs rebase is not stated (`实测` / `猜测` [8]) | Agent Merge "does not support stacked pull requests or pull requests opened from a fork" (`实测` [8]) | not documented | Bot author plus human co-author, signed (`实测` [9]) |
| claude-code-action | `claude/{issue\|pr}-N-<ts>`, prefix configurable, validated by a whitelist (`实测` [10]) | On an open PR it checks out `headRefName`, pinned to `headRefOid`, and aborts if the head moved after the trigger. On a closed or merged PR it creates a new branch (`实测` [10]) | Any open same-repo PR. It restores `.claude/`, `CLAUDE.md` and `.husky/` from base (`实测` [11]) | One branch per issue trigger; PR triggers share the head (`推断`) | "does not merge branches, rebase, force push" (`实测` [12]) | The token is "sandboxed to the current repository"; fork heads become a local alias `pr-N` (`实测` [10][12]) | Deletes its branch if it has no Claude commits; nothing after merge (`实测` [10]) | `claude[bot]`, API-signed (`实测` [10]) |
| Cursor cloud agents | `cursor/<slug>-<hex>` unless `workOnCurrentBranch` (`实测` [13]) | Follow-ups reuse the workspace; one active run (`409 agent_busy`); subscriptions wake it on comments and CI (`实测` [13][14]) | `prUrl` + `workOnCurrentBranch` pushes to the PR head (`实测` [15]) | `git.branches[]`, one per pushed branch (stacked) (`实测` [13]) | Does not auto-fix CI on human commits; stops after 10 rounds (`实测` [14]) | not found | not found | `cursor[bot]`, verified (`实测`) |
| Devin | `devin/<unix-ts>-<slug>` (`实测`, observed PRs) | Answers comments on its PRs while the session lives (`实测` [16]) | `/devin` on any open PR takes it over, routed to the live session (`实测` [16]) | Deliberate stacked PRs; merging one lands the lower ones and GitHub retargets the rest (`实测` [17]) | "resolves the conflicts silently"; method not stated (`实测` / `猜测`) | not found | not found | Configurable: as Devin or as the user (`实测` [16]) |
| Conductor | One workspace is one branch; the agent renames it on first chat (`实测` [18]) | Same workspace | Create a workspace "from a branch, pull request, GitHub issue" (`实测` [18]) | One branch checked out in one workspace only (git rule) (`实测` [18]) | Asks an agent to resolve (`实测` [19]) | not found | Archive the workspace (`实测` [19]) | Local user |
| Sculptor | `<user>/<slug>`, configurable (`实测` [20]) | Same workspace; "Create PR" pushes and opens (`实测` [20]) | not found | One worktree per workspace (`实测` [20]) | Babysitter rebases and force-pushes; never merges (`实测` [21]) | not found | Branch delete never / when safe / always (`实测` [20]) | Local user |
| Crystal | Session name; reuses an existing branch via `worktree add <path> <branch>` (`实测` [22]) | Same worktree | Existing local branches only (`实测` [22]) | One worktree per session | Local rebase plus ff-only merge (`实测` [22]) | n/a | `worktree remove --force` (`实测` [22]) | Local user |
| t3code | `t3/<slug>`, static / semantic / custom (`实测` [23]) | Same thread and worktree | Checks the PR out "here" or in its own worktree; same-repo uses `headBranch`, a fork becomes `t3code/pr-<n>/<head>` (`实测` [24]) | Threads can share a worktree; cleanup refuses while another thread uses it (`实测` [24]) | not found | Local alias only (`实测` [24]) | Worktree cleanup (`实测` [24]) | Local user |
| Amp | Trunk "Ship" pushes to base; "Push to Branch" gets a short name (`实测` [25]) | Subscribes to comments and CI of its own or followed PRs; subscriptions do not "grant permission to push" (`实测` [26]) | Can follow any PR (`实测` [26]) | One runner, many worktrees; the name is both branch and folder (`实测` [27]) | Ship rebases and retries (`实测` [25]) | not found | Archive removes the worktree and deletes the branch (`实测` [27]) | As the user, or a bot that "can never write where the thread creator could not" (`实测` [26]) |
| Sweep | `sweep/<title>` with numbered retry suffixes (`实测` [28]) | Comment handler commits to `pr.head.ref` (`实测` [28]) | Its own PRs only (`推断`) | One branch per ticket | A periodic job merges base into its `sweep/` PRs (merge, not rebase) (`实测` [28]) | n/a | `branch_ttl` (`推断`) | Sweep bot |
| Renovate | `renovate/`, configurable (`实测` [29]) | Regenerates one commit on the new base: a force-push (`实测` / `推断` [30]) | Never. "If you push a new commit to a Renovate branch … Renovate stops all updates" (`实测` [30]) | One branch per update group | `rebaseWhen` auto / conflicted / behind (`实测` [29]) | n/a | `pruneStaleBranches`, except branches others modified ("- abandoned") (`实测` [29]) | App, `platformCommit` signed (`实测` [29]) |
| GitHub platform | – | `PUT /pulls/{n}/update-branch` merges only, guarded by `expected_head_sha` (`实测` [31]) | Maintainer edits on fork PRs are for people with push access (`实测` [32]) | When a merged head is deleted, dependent PRs are retargeted to its base (`实测` [33]) | UI "Update branch" defaults to merge (`实测` [31]) | An App needs "permissions to write the contents of the head repository" (`实测` [31]); `GITHUB_TOKEN` is read-only on fork PRs (`实测` [34]) | `delete_branch_on_merge`; for forks the fork's setting applies (`实测` [35]) | Bot signature verified only for API commits without custom author or committer (`实测` [36]) |

Gaps (blocked or not found): fork behavior of Codex, Cursor and Devin; Conductor's default branch name; post-merge cleanup for Copilot, Cursor and Codex. Exa search was rate-limited during the run, so the doc pages were fetched directly. `ampcode.com/manual` returns a JS shell, so ampcode.com/docs and /news were used instead.

Patterns (`推断` from the table):

- **P1. A follow-up on an open PR pushes to that PR's head; a closed or merged PR gets a new branch.** Copilot, claude-code-action, Cursor, Devin and Codex all do this.
- **P2. Ownership is explicit.**
  - A prefix marks branches the bot created: Copilot, claude-code-action, Renovate.
  - Adopting anyone else's open PR is a deliberate trigger: Copilot, Devin, Cursor, claude-code-action, t3code, Conductor.
- **P3. The bot never rewrites someone else's history and steps back when a human commits.**
  - Renovate stops updating.
  - Cursor skips CI auto-fix on human commits.
  - claude-code-action aborts if the head moved and never rebases or force-pushes.
- **P4. Bots do not push to fork heads.** An App installed on the base repo cannot (GitHub API rule). Copilot excludes forks; claude-code-action and t3code use local aliases.
- **P5. When the base moves, the bots that keep other people's history intact merge base into head.** That is GitHub's update-branch, Sweep and claude-code-action. Rebasing is done only by tools that own the branch outright.

## 3. Recommended model (one rule set, no modes)

**A thread owns exactly one work ref at a time. The ref is stored, not derived. Every build of the thread reads it.**

`thread_ref` (one row per thread, current ref; history lives in `build.workRef`):

- `threadId`
- `repo`
- `headRef`
- `baseRef`
- `createdByCairn` (bool)
- `prNumber` (nullable)
- `lastPushedSha`
- `state` (`active` | `merged` | `closed`)

Constraint: `UNIQUE(teamId, repo, headRef) WHERE state='active'`.

1. **New work from a thread.** On the first build, the server allocates `cairn/<seqNum>-<slug>` from the project base and stores it. The prefix stays as the ownership marker (P2). The slug is the thread title, validated with a strict charset, and a numeric suffix is added on collision, as Sweep and claude-code-action do (`实测` [10][28]). The worktree directory moves to `<workspacesRoot>/<threadId>`, so every build of a thread shares one checkout. That avoids git's one-branch-one-worktree rule (`实测` [18]).
2. **Fix rounds (review comments, CI, conflicts).** These use the same `thread_ref` and the same PR. That is current behavior (C11, C12), but now keyed by the thread instead of by "latest build with a PR".
3. **Continuing any existing open PR or branch.** `create_todo` gains one optional field, `continuePr` (PR number). On `open_thread` the server reads the PR:
   - **Open, same-repo head:** stores `headRef = pull.headRef`, `baseRef = pull.baseRef`, `createdByCairn = false`, `prNumber`, and records the adoption head SHA.
   - **Fork head:** stores a new `cairn/<seq>-<slug>` branched from the fork's head SHA and opens a new PR that references the original (P4: the App cannot write fork heads).
   - **Closed or merged:** refused, with a message to create a normal thread.
   - **Head already active in another thread:** refused, naming that thread. The unique index enforces this.

   The agent never chooses a branch. Delete "build on that branch" from `GITHUB_OVERLAP_RULE` and replace it with "report the overlapping PR and stop", so the Coordinator decides with `continuePr` (fixes C6).
4. **Several tasks in one thread.** One thread holds at most one open PR (spec 23 R1, kept). Parallel tasks are separate threads. A follow-up after the thread's PR merged or closed allocates a fresh `cairn/<seq>-<slug>-<n>` ref from base (P1, claude-code-action [10]). This replaces the C11 refusal "Create a new task" and the separate "merged locally → new branch" path with a single rule.
5. **Stacked PRs.** `create_todo` also takes `stackOn` (todo id). The new thread's `baseRef` is that thread's `headRef`, and its PR targets it.
   - The merge gate keeps `baseRef === project base` (C13), so only the bottom of a stack can merge.
   - After it merges, `delete_branch_on_merge` (`实测` true) lets GitHub retarget the next PR to main (`实测` [33]).
   - pr-watch re-reads `baseRef` from the pull, so no cairn code moves bases.
6. **Base moved or conflicts.** Merge `origin/<baseRef>` into the head, commit, and push without force. That is the existing conflict round (C12) plus REST update-branch semantics (P5). It never rebases and never force-pushes, on any ref. Before each step the worktree fast-forwards to `origin/<headRef>`. A non-fast-forward push is answered by fetch, merge `origin/<headRef>`, push once, and otherwise the step fails (claude-code-action head pin; C7 already pushes without force).
7. **Human or foreign commits on the ref.** Auto wakes (CI fix, conflict, review-comment fix) fire only while `pull.headSha === lastPushedSha` or the adoption SHA. Otherwise the thread raises Needs-you and waits for a message (P3: Renovate, Cursor). This one rule replaces the merge-time 409 in C13 as the first line of defence. The `sha: checkpoint` merge pin stays.
8. **Forks and permissions.** Covered by rule 3. The step credential stays scoped to the project repo (#3413). `continuePr` is honored only when the Coordinator's requester has write association, which matches Copilot's write-access gate (`实测` [6]).
9. **Cleanup after merge.**
   - Worktree: removed when `thread_ref.state` leaves `active`, not after the 7-day TTL. The TTL stays for orphans only.
   - Remote branch: if `createdByCairn` and the branch still exists after merge (a repo without auto-delete), cairn deletes it.
   - Adopted refs and closed-unmerged refs are never deleted remotely (Renovate's "abandoned" rule [29]).
10. **Identity.** Push and open PRs as `cairnwright[bot]` through the #3413 step App credential. The step commit author becomes `cairnwright[bot] <347615582+cairnwright[bot]@users.noreply.github.com>`, with the human co-author trailer already added by `ensureStepCoauthor`, matching Copilot's model [9].
    - Commits made by the agent stay locally authored and therefore unverified.
    - Verified bot commits would need API commits without custom author ([36], Renovate `platformCommit`). That is a separate change; leave it out here.
    - On adopted PRs, the opener stays the human, so the xiechimon/cairn human-opener rule (C13) passes unchanged.

Why this and not the alternatives (`推断`): every surveyed hosted agent follows P1 and P2, and cairn already follows P5 and the no-force part of P3. The only missing piece is that the ref cannot be anything other than `f(buildId)`. Storing it fixes adoption, follow-up after merge, stacking and multi-build worktrees with one data change. Only one new Coordinator field is truly needed (`continuePr`), and `stackOn` is the other.

Decisions for ian (an intended-behavior change): rule 4 replaces "a merged task cannot take a second delivery" (`builds.ts#L358`) with "the follow-up opens a new branch in the same thread". The recommended default is to adopt rule 4.

## 4. Code areas

| Area | Change | Protected path |
|---|---|---|
| `packages/shared/src/brand.ts` | Delete `conversationBranch`; add `cairnBranchName(seq, slug)` plus a validator | – |
| `packages/shared/src/protocol/executor.ts` `WORKTREE_CONTRACT`, `WorktreePrepareInput` | `taskDirLayout` becomes `<threadId>`; prepare takes `branch` and `baseRef` | – |
| `apps/server/src/db/schema.ts` + migration | `thread_ref` table; `build.workRef`; backfill `cairn/conv-<latestBuildId>` for existing threads; `thread_pr` unique on `threadId` | – |
| `apps/daemon/src/workspace.ts` | Use `input.branch`; fast-forward to `origin/<ref>`; remove the "delete local branch then re-add" path for adopted refs | – |
| `apps/daemon/src/runner.ts` (L240-270, L470-490, L1925-2135) | Branch note from the claim; drift compares against the stored ref; delete the artifact-branch widening and the multi-head probe; non-ff retry with merge | – |
| `apps/daemon/src/orb/{worker,delivery}.ts` | Bundle ref equals the claimed ref | – |
| `apps/server/src/services/machine-finish-step.ts` | PR lookup by stored ref; write `thread_ref.prNumber/lastPushedSha` | **yes** (`services/machine*.ts`, owner-routed) |
| `apps/server/src/routes-machine.ts` / claim payload | Carry `workRef` in the claimed step | **yes** |
| `apps/server/src/services/builds.ts` (L326-437, L1426-1530, L2191-2275) | Continuation by `thread_ref.state`; `requestMerge` reads the ref | – |
| `apps/server/src/lib/github.ts` `isOwnPull` | `(pull, ref)` with a same-repo check | – |
| `ci-loop.ts`, `pr-watch.ts`, `pr-wakes.ts`, `pr-feedback.ts`, `local-merge.ts`, `git.ts`, `blocker-handoff.ts` | Key on `thread_ref`; add the rule 7 head guard to wakes | – |
| `packages/shared/src/protocol/chief-tools.ts`, `services/chief-tools.ts` | `create_todo.continuePr`, `create_todo.stackOn` | – |
| `apps/server/src/services/mcp-face.ts` | Expose the same fields over MCP | **yes** (`externalEntryAuth`) |
| `packages/shared/src/records/prompts.ts` | Rewrite the work-branch note (ref from the claim); remove "build on that branch" | – |
| `apps/web/src/api/mappers.ts`, fixtures | Read `workRef` from the record | – |
| `docs/spec/23-…md` | Fold R1-R4 into this model; delete §5's "rerun = new branch" boundary | – |

## 5. Tests, failure modes first

| # | Failure | Test |
|---|---|---|
| F1 | Two threads push the same head | Second `continuePr` on an active head → 409 naming the first thread (server unit) |
| F2 | cairn pushes to a fork | `continuePr` on a cross-repo PR → new `cairn/` ref from the fork SHA; no push to the fork remote (github emulator, `integration/test/github-emulator-case.ts`) |
| F3 | Force-push or rebase rewrites a human's commits | Remote moved during a step → fetch, merge, push; git args never contain `--force`/`rebase`; human commits stay ancestors (daemon git integration) |
| F4 | Auto-fix wakes on a human-pushed head | `headSha ≠ lastPushedSha` → no wake, Needs-you row (pr-wakes unit) |
| F5 | Merge lands an unjudged head | Existing sha-pin tests plus an adopted-ref case (`pr-merge-api.test.ts`; run `verify-merge-gate` TLC because `requestMerge` changes) |
| F6 | Follow-up after merge reuses the merged ref | Merged → new `-2` ref from base; closed → new ref; open → same ref (`rework-branch-reuse.test.ts` extended) |
| F7 | Two builds of one thread collide on worktree | Second build reuses `<threadId>` dir; no "already checked out" (workspace unit) |
| F8 | Legacy threads lose their PR | Migration backfills `cairn/conv-<latestBuildId>`; existing D109 tests unchanged |
| F9 | Hostile branch or slug name | Validator rejects `..`, leading `-`, control chars, over 100 chars (shared unit) |
| F10 | Stack merges out of order | `stackOn` PR with base ≠ project base → merge refused; after retarget it passes (server unit with emulator retarget) |
| F11 | Agent drifts to its own branch | Drift is reported against the stored ref and nothing else is probed as a PR head (runner unit) |
| F12 | Remote branch deleted that cairn didn't create | Adopted ref merged → no `DELETE refs/heads` call (emulator) |

Real e2e: one `integration/test` journey covers create thread → PR → CI-red wake → fix push → base moves → merge-in → merge. A second covers `continuePr` on a human PR → push → merge (spec 19 layering: a cross-process mechanism).

## 6. Old code deleted in the same change

- `conversationBranch` and every call site (C2). `BRAND.branchPrefix` remains only as the prefix in `cairnBranchName`.
- `runner.ts`:
  - the `artifactBranches` widening by prefix (L2026-2031);
  - the multi-head PR probe (L2118-2124);
  - the drift "relaxed artifact" wording.
- `machine-finish-step.ts`: head-pattern PR discovery by the conv branch, replaced by the stored ref.
- `ci-loop.ts` `adoptPull` (a different PR on the same branch): with a stored `prNumber` plus the head lookup, it folds into pr-watch's single read.
- `builds.ts`:
  - the "merged locally → new branch" special case;
  - the "already merged. Create a new task" 409, replaced by rule 4;
  - `latestPrBuild`-style newest-PR-build search (spec 23 §3).
- `pr-watch.ts` `pruneSuperseded` (rows whose build is not latest): `thread_pr` keyed by thread makes it unnecessary.
- `prompts.ts` `LEGACY_WORK_BRANCH_NOTE_TAIL`, `PRE_REVIEW_WORK_BRANCH_NOTE_TAIL` and the "build on that branch" clause.

## Links

[1] https://community.openai.com/t/branch-naming-is-there-any-way-to-set-it/1315157
[2] https://developers.openai.com/codex/integrations/github
[3] https://community.openai.com/t/prs-opened-by-codex-are-not-updated-with-latest-changes/1266174
[4] https://learn.chatgpt.com/codex/environments/cloud-environment
[5] https://docs.github.com/en/copilot/concepts/security-governance-and-network-settings/risks-and-mitigations
[6] https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/use-cloud-agent-on-github
[7] https://docs.github.com/en/copilot/concepts/copilot-surfaces/copilot-on-github
[8] https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/watch-and-fix-pull-requests
[9] https://docs.github.com/en/copilot/concepts/security-governance-and-network-settings/risks-and-mitigations (commit authorship, signing)
[10] https://github.com/anthropics/claude-code-action/blob/main/src/github/operations/branch.ts, `branch-cleanup.ts`, `src/utils/branch-template.ts`
[11] https://github.com/anthropics/claude-code-action/blob/main/docs/security.md
[12] https://github.com/anthropics/claude-code-action/blob/main/docs/faq.md
[13] https://cursor.com/docs/cloud-agent/api/endpoints.md
[14] https://cursor.com/docs/cloud-agent/capabilities
[15] https://cursor.com/docs/cloud-agent
[16] https://docs.devin.ai/integrations/gh
[17] https://docs.devin.ai/work-with-devin/stacked-prs
[18] https://www.conductor.build/docs/concepts/workspaces-and-branches
[19] https://www.conductor.build/docs/concepts/workflow
[20] https://github.com/imbue-ai/sculptor/blob/main/docs/help/workspaces.md
[21] https://github.com/imbue-ai/sculptor/blob/main/docs/help/ci_babysitter.md
[22] https://github.com/stravu/crystal/blob/main/main/src/services/worktreeManager.ts
[23] https://github.com/pingdotgg/t3code/blob/main/packages/contracts/src/settings.ts
[24] https://github.com/pingdotgg/t3code (`GitManager.ts` `preparePullRequestThread`, `resolvePullRequestWorktreeLocalBranchName`; `worktreeCleanup.ts`)
[25] https://ampcode.com/docs/orbs/shipping
[26] https://ampcode.com/docs/github
[27] https://ampcode.com/news/one-runner-many-worktrees
[28] https://github.com/sweepai/sweep (`on_ticket.py`, `github_utils.py`, `on_comment.py`)
[29] https://docs.renovatebot.com/configuration-options/
[30] https://docs.renovatebot.com/updating-rebasing/
[31] https://docs.github.com/en/rest/pulls/pulls#update-a-pull-request-branch ; https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/proposing-changes-to-your-work-with-pull-requests/keeping-your-pull-request-in-sync-with-the-base-branch
[32] https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/working-with-forks/allowing-changes-to-a-pull-request-branch-created-from-a-fork
[33] https://github.blog/changelog/2020-05-19-pull-request-retargeting/
[34] https://docs.github.com/en/actions/writing-workflows/choosing-when-your-workflow-runs/events-that-trigger-workflows
[35] https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-the-automatic-deletion-of-branches
[36] https://docs.github.com/en/authentication/managing-commit-signature-verification/about-commit-signature-verification
