# #1403 segment 3 plan: checks by head SHA, required checks only, BEHIND / DIRTY, step finish time

Branch `claude/bootstrap-p2-seg3`, stacked on segment 2b (`claude/bootstrap-p2-seg2b`, PR #1509, head a2816746). This is the last P2 segment: its final commit closes #1403.

Scope, from spec 28 §4 P2 and the #1403 list:
1. The CI grind reads check runs by the PR's head SHA, not by branch ref.
2. Only the required-check list decides green; neutral, skipped and cancelled do not count as passing a required check.
3. BEHIND triggers update-branch with `expected_head_sha`. Under `mergePolicy: human` (the only policy today) that is a hint only, so no update-branch request is sent in this segment.
4. DIRTY triggers a same-branch `[merge-conflict]` build step that merges the default branch in, with no force-push (spec 23's same-branch rounds).
5. The exact step finish time: a `step.finishedAt` column, used to order "last pushed checkpoint".
6. The G9 wording, if anything is left. It is not: segment 2 (#1489, 9296b8b) shipped the review-gate wake text and the confirm-phase check, and spec 02 states the 409 since segment 2b.

Out of this segment: the commit-status write, the compare file list and the reads of PR reviews and comments. They belong to the merge gate (P3), and S4a (#1503, open) adds them as raw transport.

## 1. GitHub REST facts (fetched 2026-10-22 from docs.github.com/api/article/body)

List check runs for a Git reference, https://docs.github.com/en/rest/checks/runs#list-check-runs-for-a-git-reference
- "GET /repos/{owner}/{repo}/commits/{ref}/check-runs"
- "Lists check runs for a commit ref. The ref can be a SHA, branch name, or a tag name."
- "`filter` (string) Filters check runs by their completed\_at timestamp. latest returns the most recent check runs. Default: `latest`"
- "`per_page` (integer) The number of results per page (max 100)."
- "If there are more than 1000 check suites on a single git reference, this endpoint will limit check runs to the 1000 most recent check suites."
- Status: "200 - OK"
- Response, items of `check_runs`:
  - "`head_sha`: required, string";
  - "`status`: required, string, enum: `queued`, `in_progress`, `completed`, `waiting`, `requested`, `pending`";
  - "`conclusion`: required, string or null, enum: `success`, `failure`, `neutral`, `cancelled`, `skipped`, `timed_out`, `action_required`, `null`";
  - "`name`: required, string".

Get a branch, https://docs.github.com/en/rest/branches/branches#get-a-branch
- "GET /repos/{owner}/{repo}/branches/{branch}"
- Response:
  - "`protected`: required, boolean";
  - "`protection`: required, `Branch Protection`" with "`required_status_checks`: `Protected Branch Required Status Check`";
  - inside it, "`contexts`: required, array of string", "`checks`: required, array of objects: `context`: required, string; `app_id`: required, integer or null", and "`strict`: boolean".

Get rules for a branch, https://docs.github.com/en/rest/repos/rules#get-rules-for-a-branch
- "GET /repos/{owner}/{repo}/rules/branches/{branch}"
- "Returns all active rules that apply to the specified branch. The branch does not need to exist; rules that would apply to a branch with that name will be returned. All active rules that apply will be returned, regardless of the level at which they are configured (e.g. repository or organization). Rules in rulesets with "evaluate" or "disabled" enforcement statuses are not returned."
- "`per_page` (integer) The number of results per page (max 100). ... Default: `30`"
- Status: "200 - OK"
- The required-checks rule: "`type`: required, string, enum: `required_status_checks`"; under `parameters`, "`required_status_checks`: required, array of `StatusCheckConfiguration`: `context`: required, string; `integration_id`: integer".

Get a pull request (segment 1 and 2b): "`mergeable_state`: required, string". The page gives no value list. Pacman acts only on the two literal values `behind` and `dirty`. Any other value, including `unknown` while GitHub computes mergeability, means no action.

Update a pull request branch, https://docs.github.com/en/rest/pulls/pulls#update-a-pull-request-branch (named in the hint only; this segment sends no request)
- "PUT /repos/{owner}/{repo}/pulls/{pull_number}/update-branch"
- "Updates the pull request branch with the latest upstream changes by merging HEAD from the base branch into the pull request branch."
- "`expected_head_sha` (string) The expected SHA of the pull request's HEAD ref. ... If the expected SHA does not match the pull request's HEAD, you will receive a 422 Unprocessable Entity status."
- Status codes: "202 - Accepted", "403 - Forbidden", "422 - Validation failed, or the endpoint has been spammed."

## 2. Required-check list: transport

S4a (#1503) adds `githubBranchRaw` and `githubBranchRulesRaw`: raw transport for the merge gate, not yet merged. This segment does not wait for it and does not copy those functions. It adds one narrow read to `lib/github.ts`, `githubRequiredChecks(fetch, token, owner, repo, branch)`. It calls the two endpoints above and returns the union of required check names, or null when either read fails (non-2xx, network, malformed). When S4a lands, this function can be rebuilt on S4a's raw reads; the interface stays.

The grind caches the list per repository and default branch for 10 minutes. An unreadable list leaves the candidate untouched this sweep (fail-open, the ci-loop rule).

## 3. Verdict (`verdictOfCheckRuns(runs, required)`)

- Required list non-empty: only check runs whose name is in the list count.
  - A required name with no run yet is pending.
  - Any run of that name not completed: pending.
  - Any `failure`, `timed_out` or `action_required`: red. These are fixable, so a `[ci-fix]` round follows.
  - All `success`: that name passes.
  - Anything else (`cancelled`, `neutral`, `skipped`, `stale`): blocked. No advance and no fix round; one hint per round names the check and its conclusion.
- Required list empty (no protection, no ruleset): every run on the head SHA counts.
  - None: empty (the existing grace, then advance).
  - Any not completed: pending.
  - Any `failure` or `timed_out`: red.
  - Any `cancelled`: blocked.
  - Otherwise green: with nothing required, `neutral` and `skipped` stay non-gating.

## 4. Grind order per building candidate

1. Conditional `GET pulls/{n}` (ETag per PR) gives the head SHA and `mergeable_state`. Unreadable: no move.
2. `dirty`: a `[merge-conflict]` round (§5), then return.
3. The required list for the base repository's default branch (cache). Unreadable: no move.
4. Conditional `GET commits/{headSha}/check-runs` (ETag per head SHA).
5. The verdict from §3. Green goes to review; red goes to a `[ci-fix]` round as before; blocked writes the hint once per round.

## 5. `[merge-conflict]` round (building and review)

- The step is a `build` step on the same build (same branch and PR), with a prompt headed `[merge-conflict]`. The prompt tells the agent to fetch and merge `origin/<default>` into the branch, resolve conflicts, commit, and push to the same branch; no rebase, no force-push, no new branch or PR.
- Review card: `review -> queued` (a legal edge), then the step is queued. The claim moves the card to `building`, the grind takes over, and green brings it back to review.
- At most 2 rounds per round of the build. After that, one hint per round says the conflict is left to a person, and no further step is added.
- Not while a step is in flight (hasActiveStep), and not while an API merge is in flight.
- Phase re-read after the PR read, before any write.

## 6. BEHIND (review only)

`mergeable_state: behind` on an open own PR at review writes one hint per round. The hint says the PR is behind the default branch, that under the human merge policy pacman does not update it, and how to update it: Update branch on GitHub, which is `PUT pulls/{n}/update-branch` with `expected_head_sha`. No request is sent. At building, BEHIND does not stop the grind: the checks on the head decide.

## 7. `step.finishedAt`

- Migration: a nullable epoch-ms column on `step`. It is numbered at the tail of main's `apps/server/drizzle` at merge time; today that is `0045` after `0044_merge_gate_tables`, and it is renumbered if main gains a migration first (CLAUDE.md drizzle rule).
- Written whenever `builds.ts` moves a step to `done`, `failed` or `stopped`.
- `lastPushedCheckpoint` orders by `finishedAt` first, then the old `coalesce(heartbeat, claimed, created)` for rows written before the migration.

## 8. Failure modes (tests first; numbers used in tests as `[s3-Fn]`)

F1. The branch head moves between the PR read and the check-runs read: the verdict is for the head SHA read from the PR, never for a newer or older commit under the branch name.
F2. Check runs for a stale head (a fix round pushed, CI not yet registered on the new head): the new head has no required run, so the state is pending, not green from the old head.
F3. A required check is `neutral`, `skipped` or `cancelled`: no advance, no fix round, one hint per round naming it.
F4. A required check is missing from the runs: pending. After the existing empty-checks grace it stays pending; it does not count as "repo has no CI".
F5. A non-required check fails while every required check succeeds: green.
F6. A required check fails (`failure`, `timed_out`, `action_required`): a `[ci-fix]` round (round cap unchanged).
F7. No required list (unprotected default branch, no rules): the old rule, except that `cancelled` blocks; `neutral` and `skipped` stay non-gating.
F8. The required-list read fails (429, 403, 404, network, malformed): no move, retried next sweep; the PR and check-runs reads still follow the rate-limit and anonymous rules.
F9. Required names from both sources (classic protection `contexts` and `checks[].context`, and ruleset `required_status_checks`) are unioned and deduplicated.
F10. The required list is cached per repository and default branch for 10 minutes: two candidates in one repo read it once per window.
F11. The PR read fails: no check-runs read, no move.
F12. `dirty` at building: one `[merge-conflict]` build step on the same build; its prompt names the default branch and forbids force-push and rebase; no `[ci-fix]` step.
F13. `dirty` at review: the card moves `review -> queued` and gets the step; the claim takes it to building.
F14. `dirty` again after 2 merge-conflict rounds: no third step; one hint per round.
F15. `dirty` while a step is in flight, or while an API merge is in flight: nothing.
F16. The card leaves review or building during the PR read: no write.
F17. `behind` at review: one hint per round, naming update-branch with `expected_head_sha`; no request; phase unchanged. `behind` at building: the grind goes on by checks.
F18. `mergeable_state` `unknown`, missing, `blocked`, `clean`, `unstable`, `has_hooks` or `draft`: no BEHIND or DIRTY action.
F19. The merge-conflict and BEHIND hints, and the blocked-check hint, carry GitHub text only through `githubText`.
F20. `finishedAt` is set when a step reaches `done`, `failed` or `stopped`, and `lastPushedCheckpoint` follows it. A step that finished later but heartbeated earlier wins over one with a later heartbeat that finished first.
F21. Rows from before the migration (null `finishedAt`) are ordered as before.
F22. The migration applies on a database at 0044 and on a fresh one; `db:check` passes.
F23. The `[merge-conflict]` and `[ci-fix]` round counts do not mix: each cap counts its own head.
F24. Anonymous grind: the PR read and the required-list reads count toward the per-IP total like the check-runs read.

## 9. Files

- `apps/server/src/lib/github.ts`: `githubRequiredChecks`; `mergeableState` in `githubPull`.
- `apps/server/src/services/ci-loop.ts`: the grind order of §4, the verdict of §3, the merge-conflict round, the BEHIND and DIRTY handling in the review reconcile, the hints.
- `apps/server/src/services/builds.ts`: `finishedAt` writes and `lastPushedCheckpoint` ordering.
- `apps/server/src/db/schema.ts` and a new migration.
- Tests:
  - `apps/server/test/ci-loop.test.ts`: the mock serves `pulls/{n}`, the branch and the rules;
  - `apps/server/test/pr-seg3.test.ts` (new): F1-F24;
  - `apps/server/test/pr-reconcile.test.ts`: as needed.
- Docs:
  - `docs/spec/02` (the grind and reconcile bullets);
  - `docs/spec/28` §8, the P2 row only;
  - evidence `docs/verify/1403/seg3-*`.

## 10. Failure modes added after the first /code-review (2026-10-22)

The first `/code-review` at medium on `origin/claude/bootstrap-p2-seg2b...HEAD` found ten issues. They change F4 and F14 and add the modes below. Tests were written first. The red leg was 11 failed / 40 passed (`seg3-red-green.txt`).

F4 (changed). A required check is missing from the runs: pending. Past the empty-checks grace it is a blocked hint (conclusion `missing`), never green. The check may be reported as a commit status, or sit past the first 100 check runs; this segment reads neither.
F14 (changed). `dirty` again after 2 merge-conflict rounds at building: no third step. The card goes to failed with the reason, as the `[ci-fix]` round cap does.
F14b. The same at review: no third step, the card stays at review, one hint per round.
F13b. `dirty` at review stops the unclaimed verify and review steps before the card goes back to queued. Those steps check the old head.
F25. At building, the recorded PR is not this build's open PR: a fork PR with the same branch name, a deleted fork (head repo null), a PR from another branch, or a closed PR. No merge-conflict step. Check runs are read by the build's own branch name, as before segment 3.
F25b. The same at review with `dirty`: no merge-conflict round.
F26. Several runs share a name (re-runs, two apps, two workflows): one `success` passes the name. A `cancelled` or `skipped` sibling does not block it, with or without a required list.
F27. The rules read answers 403 or 404 without a rate-limit signal (rulesets are not on this repository's plan): no rules, and the classic list decides. A 403 with a rate-limit signal (header or message) stays unreadable: two more F8 cases.
F28. The check runs answer 304 after the required list was refreshed: the verdict is recomputed from the cached runs against the current list. The cache keeps runs, not a verdict.
F29. Housekeeping, with no behaviour test: required-list entries past the TTL are pruned in the sweep; the hint memo keeps grind builds too, not only review builds.

## 11. S4a landed on main (#1503, c99de106), 2026-10-22

S4a's `githubBranchRaw` and `githubBranchRulesRaw` require a token: `commonInvalid` answers `invalid: token` for anything that is not a header-safe token string. The CI grind also runs without a GitHub connection, reading public repositories anonymously (`githubCommitCheckRuns` and `githubPull` take `token: string | null`). So `githubRequiredChecks` stays on the existing `conditionalGetJson` path and is not rebuilt on S4a's raw reads. It is one narrow read with a different contract (a list of names or null), not a copy of S4a's functions. The merge gate (P3) keeps S4a's raw reads for its own decisions.

## 12. Second /code-review (2026-10-22, medium, on origin/claude/bootstrap-p2-seg2b...a5cbcf5a)

Eight findings. Five are fixed (tests first), three are not, with the reasons below. The red leg was 6 failed / 54 passed (`seg3-red-green.txt`).

F6 (changed). A required check concluding `action_required` waits for a person (a fork workflow approval, a deployment). The agent cannot fix it, so it is now a blocked hint (F6b), not a `[ci-fix]` round.
F8c. A failed required-list read is remembered for the rest of the sweep: the next candidate in the same repository does not read it again. The next sweep reads again.
F13c. A verify step that the merge-conflict round stopped at review is queued again when the grind brings the card back to review. The round leaves a marker row, `CI_MERGE_CONFLICT_VERIFY_NOTE`, in that round. `maybeEnqueueVerifyStep` takes `reverify` and then only checks for a queued or running verify step.
F13d. A verify step stopped another way (a person) is not queued again: one verify per build, as before.
F13e. If the card reaches review again in the same round while that verify is still queued, there is no second verify.
F25 / F25b (extended). A PR whose base is not the default branch is not this build's own PR: no merge-conflict round, and the grind reads check runs by the branch name.
F26b. A blocked hint names a check once when several runs share its name (conclusions are joined with `/`).

Not fixed:
- Required checks concluding `neutral` or `skipped` stay "not passing". The coordinator's segment-3 scope sets this ("neutral / skipped / cancelled no longer count as green"). GitHub's own merge box accepts them, so a required job skipped by a path filter leaves the card at building with a hint each round. This goes into the PR's Risk section for the user to confirm.
- The merge-conflict round cap counts every `[merge-conflict]` step of the build, not consecutive ones. That is the same lifetime count per build as the `[ci-fix]` cap (`countMarkedRounds`); a rerun starts a new build.
- A required context reported only as a commit status (or past the first 100 check runs) becomes a blocked hint after the grace, not green. The hint names it and a person moves the card. Reading the combined status is left for the merge gate (P3), which has S4a's `githubCombinedStatusRaw`.

## 13. Third /code-review (2026-10-22, medium, on origin/claude/bootstrap-p2-seg2b...85aadc84)

Ten findings. Seven are fixed (tests first), two are not, and one is handled at the next merge. The red leg was 5 failed / 61 passed (`seg3-red-green.txt` leg 4). Mutations P1-P6 were all killed.

F8 (extended). A rules read answering 403 with `x-github-sso` (SAML SSO not authorised for the token) is unreadable, not "no rules".
F9b. Classic protection whose `required_status_checks.enforcement_level` is `off`: its contexts are not required. The branch docs give `enforcement_level: string` with no value list, so only the literal `off` is acted on.
F13f. The re-verify marker is looked up after the latest verify step, not after `roundStart`: a `[ci-fix]` round after the merge-conflict round no longer hides it.
F13g. A verify step that already ran on the pre-conflict head is also queued again after a merge-conflict round at review. The merge commit changes the delivery.
F13h. A pending AI review step stopped by the round is stated in the timeline (`CI_MERGE_CONFLICT_REVIEW_NOTE`). It is not queued again automatically, because a person chose the reviewers when they started it.
The own-PR predicate is one function, `isOwnOpenDefaultPull` in `lib/github.ts`, used by the grind and the review reconcile.
The verdict doc comment now matches FIXABLE (action_required is not fixable).

Not fixed:
- Anonymous grind cost: the head-SHA read adds one `pulls/{n}` read per sweep per candidate, plus two required-list reads every 10 minutes per repository. Before segment 3, one anonymous grinding PR already used 60 check-runs reads an hour, GitHub's whole unauthenticated limit. Connecting GitHub (token reads, where 304s are free) is the remedy. This goes into the PR's Risk section.
- A PR read that fails, or lacks the default branch, leaves the card untouched (F11, by design): the card is not advanced on a head it cannot name.

At the next merge: the migration number. main now has `0045_model_fallback_chain` (#1493, after this branch was planned), so `0045_step_finished_at` is renumbered to the tail of main when segment 2b's new head (which merges main c99de10) is merged in.

## 14. Fourth /code-review (2026-10-22, medium, on origin/claude/bootstrap-p2-seg2b...46e40de0)

Ten findings. Eight are fixed (tests first), one is a cleanup done along the way, and one is not fixed. The red leg was 5 failed / 67 passed (leg 5). Mutations Q1-Q7 were all killed.

F30. Right after pacman pushed (a build or merge step finished within CI_EMPTY_CHECKS_GRACE_MS and reported a commit), a PR read whose head is not that commit is waited out. There is no fix round on the old head's red and no merge-conflict round on its stale `dirty`. GitHub recomputes the head and `mergeable_state` after the push.
F30b. Past the grace the PR head decides, because a person may have pushed on top. Waiting for ever would lock the card.
F30c. The same applies to DIRTY / BEHIND at review.
F7b. With no required list, `action_required` blocks as `cancelled` does: the workflow has not run.
F26c. A name with one `success` passes, even when a sibling run of that name failed. No fix round is sent for it, consistent with F26.
F13i. A merge-conflict round at building on a build that already has a verify step (#931 rework reuses the build) also queues the verify again.
The two required-list reads run in parallel (`Promise.all`). A lookup takes at most one timeout, and the anonymous count of two reads is always exact.
`stopUnclaimedGateSteps` returns the kinds it stopped. The round uses that instead of a second query to decide on the AI review note.

Not fixed: ruleset rules are read as one page of 100 (`per_page=100`, the documented maximum). More than 100 active rules on one branch is left out of this segment.

## 15. Fifth /code-review (2026-10-22, medium, on origin/claude/bootstrap-p2-seg2b...9f179024)

Eight findings (candidates, not verified by the reviewer). Seven are fixed and one is not. The red leg was 4 failed / 72 passed (leg 6). Mutations R1-R5 were all killed.

F12b. The merge-conflict prompt puts the default branch name in single quotes for the shell (`git fetch origin '<branch>'`, `git merge 'origin/<branch>'`), and passes it through `githubText` in prose. Git ref names may contain `;`, `$`, `|`, `&` and backticks.
F27 / F27b (changed). A rules read answering 403 means "no rules" only when its message says the feature is not on the plan (`Upgrade to GitHub Pro or make this repository public to enable this feature.`). A permission 403 such as `Resource not accessible by integration` is unreadable. 404 still means no rules. The docs' status table for this endpoint lists only 200, so the 403 wording is GitHub's general paid-feature message, matched by /upgrade to github|enable this feature/i. If GitHub uses other wording, the card stays at building (no move) rather than being judged on a partial list.
F30d. pushNotSeen counts every step except review steps as a pacman push, the same as lastPushedCheckpoint, so a verify step that pushed is waited out too.
F4c. The missing-check grace keeps its start while another required check re-runs on the same head.
The step published by stopUnclaimedGateSteps carries its finishedAt. No behaviour test: the published row only feeds the web step stream.
recordGrindAnonRead takes a count.
The BEHIND hint no longer names a merge policy. It says pacman does not update the branch and a person merges.

Not fixed: re-verifying after a person moves the card to review by hand (not through the grind). The marker row stays in the timeline, and a person can start the verify.

## 16. Merge of segment 2b at efea0f26 (2026-10-22): migration renumbered to 0046

Segment 2b's head efea0f26 merges main c99de106, which carries `0045_model_fallback_chain` (#1493) and S4a's gate transport (#1503). The merge took main's `0045_snapshot.json` and `_journal.json` and removed this branch's `0045_step_finished_at.sql`. `pnpm db:generate --name step_finished_at` on the merged schema then produced `apps/server/drizzle/0046_step_finished_at.sql` (``ALTER TABLE `step` ADD `finishedAt` integer;``), which is the tail after main's 0045, as the CLAUDE.md drizzle rule requires. `pnpm db:check` passes ("snapshot 链线性、无父子冲突"). If main gains another migration before this branch lands, it is renumbered again at that merge.

The other conflicts: `lib/github.ts` (both sides appended at the end of the check-runs section; both kept: `githubRequiredChecks` and S4a's raw gate transport) and spec 02 (this branch's segment-3 bullet kept, segment 2b's updated merge bullet taken from 2b: this branch had not changed it).

## 17. Merge of segment 2b at ff4c4247 (2026-10-22)

Segment 2b's round-3 head ff4c4247 merges main 2ff0b937. main's drizzle folder still ends at `0045_model_fallback_chain`, so `0046_step_finished_at` stays at the tail (`db:check` passes). Conflicts:
- `apps/server/src/services/builds.ts`, the failed-step write: both kept. 2b brings #1492's non-empty `errorMessage` fallback; this branch writes `finishedAt` with the status.
- Spec 02: this branch's segment-3 bullet kept; segment 2b's merge bullet taken from 2b, since this branch's copy was identical to efea0f26.
`ci-loop.ts` merged without conflict. 2b changed only the adoption rejection floor (it counts every own PR), which the segment-3 grind and DIRTY paths do not touch. Server suite on the merge: 132 files, 2338 passed, 1 skipped.

## 18. /code-review on the two merges (2026-10-22, medium, cbbf2faf and b7ed77d0)

The reviewer confirmed both resolutions:
- the 0046 snapshot chains to main's 0045, and the only schema difference is `step.finishedAt`;
- the failed-step write keeps #1492's fallback and adds `finishedAt`.
Eight findings. Four are fixed (tests first; red leg 3 failed / 76 passed, leg 7; mutations S1-S3 all killed), one is handled in a comment, and three are not fixed.

F30e. pushNotSeen skips steps without a commit (`isNotNull(step.checkpointCommit)`, as lastPushedCheckpoint does), so a later verify or no-change step does not hide pacman's push. This also covers the reviewer's duplicate-query note: the two queries now share the filter.
F13j. A merge-conflict round at building also stops unclaimed verify and review steps, so a verify queued on a reused build does not run on the pre-merge head and block the re-verify.
F9c. `githubRequiredChecks` encodes the branch per segment with S4a's `encodedPath`: `release/main` stays `release/main`, not `release%2Fmain`.
The `githubRequiredChecks` doc comment says why it is not built on S4a's reads (they require a token).
The `step.finishedAt` schema comment now says that builds.ts writes it for build steps, and that chief turn steps do not. The chief step's write is in `services/machines.ts`, a file on the security-review list. It is left unchanged; no query reads `finishedAt` for chief steps.

Not fixed:
- A development or verify database that applied this branch's earlier `0045_step_finished_at` (journal `when` 1792674802072, later than main's 0045) would skip main's `0045_model_fallback_chain` and fail on 0046's duplicate column. Only databases that ran this unmerged branch before the renumber are affected; main never had the old number, and the CLAUDE.md rule requires the renumber. Such a database is reset. This goes into the PR's Risk section.
- A PR read that keeps failing leaves the card at building (F11, decided).

## 19. Merge of origin/main at f8483f73 (2026-10-22)

main gained #1525 (P3 S4b, the merge gate's GitHub shell) and no new migration: the tail is still `0045_model_fallback_chain`, so `0046_step_finished_at` stays. The only conflict was spec 28 §8: this branch's P2 row kept, main's P3 row taken. `lib/github.ts` merged cleanly. Server suite on the merge: 135 files, 2396 passed, 1 skipped; `db:check` passes.
