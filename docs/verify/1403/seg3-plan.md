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
