# Mergify merge queue spike

> **Question.** Can Mergify's merge queue replace the coordinator and the omarchy batch merger as the way PRs land on cairn's `main`?
>
> **Background.**
> - GitHub's native merge queue is unavailable here: creating a `merge_queue` ruleset on `xiechimon/cairn` (user-owned, public) returns 422.
> - Strict up-to-date branches were rejected as too slow.
> - On 2026-11-01, `main` broke twice from semantic conflicts between PRs that were each green on their own (#2440, #2461).
>
> **Method.**
> - Repo: a scratch public repo, `xiechimon/mergify-spike`, owned by the same personal account.
> - The Mergify GitHub App was installed on that repo only, and the tests used real PRs.
> - Nothing was installed on or changed in `xiechimon/cairn`.
> - Measured 2026-11-01 between 06:40 and 07:16 UTC.

## 0. Recommendation

**Go, as a pilot on cairn — not yet a drop-in replacement.**

The queue did what cairn currently lacks:

- it caught a semantic conflict between two green PRs before it reached `main`;
- `main` stayed green;
- the PR that did not break anything still merged.

Three integration costs stand between this spike and replacing the coordinator. None is a blocker, and each has a known fix:

1. **CI runs on Mergify's draft PRs too.** Every workflow triggered by `pull_request` also runs on Mergify's draft PRs (branches `mergify/merge-queue/*`).
   - cairn's `pr-evidence` reads the PR body, so it and `gates` would fail on those PRs unless they skip those branches.
   - The full CI suite runs twice for every PR that lands.
2. **Bot-opened PRs get the wrong commit author.** Squash merges go through the GitHub API (committer `GitHub <noreply@github.com>`). Bot-opened PRs therefore hit the same `commit-author` problem as GitHub squash does today (`docs/ops/agent-bot-identity.md`, #2136), so they need a rebase or fast-forward queue rule.
3. **Label entry needs a second product.** Entering the queue by label (`pull_request_rules`) needs Mergify's Workflow Automation product switched on per repo. `@mergifyio queue` comments work without it.

## 1. Install on a free personal-account public repo (measured)

- I signed in to `dashboard.mergify.com` with GitHub as xiechimon and installed the App on "Only select repositories" = `mergify-spike`.
  - GitHub asked for a sudo confirmation during install.
  - No plan, card or trial prompt appeared.
- **Installing the App alone does nothing.** On PR #2 the queue stayed idle until Merge Queue was activated for the repo in the dashboard (Merge Queue → Status → Activate). After that, a `Mergify Merge Queue` check run appeared on every PR.
- The pricing page (fetched 2026-11-01) says "Zero cost for open source projects and private teams of up to 5" and "Every plan includes CI Insights, Test Engine, and Merge Queue" (https://mergify.com/pricing). I found no page that treats personal accounts differently from organizations; the install above is the evidence that it works.
- Permissions the App requested:
  - read: administration, commit statuses, merge queues, metadata;
  - read and write: actions, checks, code, deployments, issues, pages, pull requests, workflows.

## 2. Commit author and committer (measured)

From `git log origin/main` on the scratch repo after the queue merged:

| Commit | Author | Committer | Merged by |
|---|---|---|---|
| `84c0009` Rename greet to salute (#2) | `Xmon Dai <xiechimon@qq.com>` | `GitHub <noreply@github.com>` | `app/mergify` |
| `1c7f879` Docs note (#4) | `Xmon Dai <xiechimon@qq.com>` | `GitHub <noreply@github.com>` | `app/mergify` |
| `245bf82` Add feat-a (#10), with `merge_bot_account: xiechimon` | `Xmon Dai <xiechimon@qq.com>` | `GitHub <noreply@github.com>` | `xiechimon` |

- The squash commit matches what `gh pr merge --squash` produces: the author comes from the PR, the committer is `GitHub`, and ` (#N)` is appended to the subject.
- `merge_bot_account` was accepted on the free plan. It changed only the merging account (`mergedBy`), not the author or committer. The named user must have logged in to the dashboard once.
- **Effect on cairn's `commit-author` check:**
  - Human-opened PRs pass unchanged.
  - When the API squashes a bot-opened PR, the author becomes `cairnwright[bot]` (the #2136 incident). Bot-opened PRs therefore need their own queue rule with `merge_method: rebase` or `fast-forward`. This was not measured here.

## 3. Semantic conflict caught, with batching (measured)

**Setup.**

| Item | Setting |
|---|---|
| CI | job `ci` runs `sleep 45`, then `node --test`; about 50 s per run |
| Branch protection on `main` | required check `ci`, `strict: false` |
| Queue rule | `squash`, `batch_size: 2`, `batch_max_wait_time: 30 s`, `max_parallel_checks: 2` |

**The PRs.** Each was green on its own:

- #2 renames `greet` to `salute` in `lib.mjs` and its test.
- #3 adds `caller.mjs`, which imports `greet`.
- #4 changes the README.

All three were queued with `@mergifyio queue` at 06:58:29 UTC.

| Time (UTC) | Event |
|---|---|
| 06:58:50 | All three enter the queue |
| 06:59:22 | Draft PR #5 opens: `merge queue: checking #2 + #3 together on main (b0416c6)` |
| 06:59:58 | Draft PR #6 opens: `checking #4 on main, stacked on #2 and #3` (a speculative run) |
| 07:01:11 | `ci` fails on #5 (`SyntaxError: The requested module ./lib.mjs does not provide an export named greet`); #5 and #6 are closed and a bisect starts |
| 07:01:29 | Draft PR #7 opens: `checking #2 on main` |
| 07:02:37 | #2 is merged |
| 07:02:40 | #3 is removed from the queue: "Left the queue · `ci` failed … Bisecting to identify the failing PR (round 1/1)" |
| 07:03:36 | Draft PR #8 opens: `checking #4 on main (84c0009)` |
| 07:04:53 | #4 is merged |

**Results.**

- `main` never received #3, and every `push` run on `main` stayed green.
- Wall time was 6 min 3 s from entering the queue to the last merge: 3 PRs, including one bisect.
- The cost of batching on a failure: one extra CI round (the batch, then #2 alone), and the speculative run for #4 was thrown away.
- Mergify's comment on #3 says "Not proven to be this pull request's failure. It failed in a batch with #2, and was not tested alone." With `batch_size: 2`, one bisect round was enough to land #2.

## 4. Queue entry and gating (measured)

**How a PR enters the queue:**

- An `@mergifyio queue` comment works with only Merge Queue activated. So does ticking the checkbox Mergify posts on every PR.
- `label = queue` in `queue_conditions` alone does **not** queue anything.
- A `pull_request_rules` entry with the `queue` action does queue on the label, but only after **Workflow Automation** is activated for the repo. Before that, the configuration check reported "Workflow Automation is not activated, so its rules will not run".

**Gating entry on a commit status** (`status-success = review-gate` in `queue_conditions`):

- #10 had the label and a success status (set with `gh api repos/.../statuses/<sha> -f state=success -f context=review-gate`). It entered the queue 58 s after being labeled.
- #11 had the same label and no status, and stayed out. Its check run listed `[ ] status-success = review-gate` as unmet.
- A gate that flips while queued removes the PR. #11 got `review-gate` = success and entered the queue at 07:13:46. Setting the status to `failure` at 07:14:30 removed it at 07:15:06 ("Left the queue · checks failed") and closed its draft PR.

**How CI runs on the queued result:**

- CI ran through ordinary `pull_request` events on draft PRs from `mergify/merge-queue/<hex>` branches.
- No `merge_group` trigger was involved; the `merge_group` trigger in the scratch workflow never fired.
- Required GitHub checks are added to the queue conditions automatically ("any of [GitHub branch protection]: check-success = ci").

## 5. Branch protection and outside merges (measured)

- `strict: false` with a required `ci` check worked unchanged. Mergify tests each candidate against the current `main` itself, so branches do not need to be up to date.
- **Outside merge during a check.**
  - At 07:10:52, #12 was merged with `gh pr merge --squash` while #10 was being checked.
  - Within 15 s the queue closed draft #13 (based on `ce87e38`) and opened #14 against the new `main` (`ea0cf45`).
  - It then merged #10 at 07:12:40.
  - Outside merges are therefore safe but restart the current check. The setting is `merge_queue.reset_on_external_merge`, default `always`, per https://docs.mergify.com/merge-queue/rules/.
- If cairn uses rulesets, Mergify must be added to their bypass list in `exempt` mode (https://docs.mergify.com/merge-queue/github-rulesets/). This was not measured, because the scratch repo used classic branch protection.

## 6. What a cairn pilot needs

- **Split the checks between the PR and the draft PR.**
  - Run `pr-evidence`, `gates` and the review gate as entry conditions on the PR (`queue_conditions`).
  - Keep only build and test jobs (`check`, `pack-smoke`, `e2e-gate`) as `merge_conditions` on the draft PR.
  - Make `pr-evidence` and `gates` skip `mergify/merge-queue/*` heads.
- **Publish the review-gate verdict as a status.** Today the verdict is a PR comment. Publishing it as a commit status or check run on the PR head lets `status-success = review-gate` gate entry, and lets a BLOCK remove the PR from the queue.
- **Use two queue rules:** `squash` for human-opened PRs and `rebase` for bot-opened PRs.
- **Budget CI.** Each PR that lands runs its full suite at least twice (on the PR and on the draft), and a failed batch adds one bisect round per level.
- **Shrink the coordinator's job.** It becomes adding the PR to the queue (label or comment) after the gate passes. The batch merger and `coordinator-merge.mjs` retire once the pilot holds.

## Sources

- Scratch repo: https://github.com/xiechimon/mergify-spike (PRs #2–#14, draft PRs #5–#8, #13 and #14; Actions runs on `mergify/merge-queue/*`).
- Mergify docs, fetched 2026-11-01:
  - https://docs.mergify.com/merge-queue/setup/
  - https://docs.mergify.com/merge-queue/lifecycle/
  - https://docs.mergify.com/merge-queue/rules/
  - https://docs.mergify.com/configuration/file-format/
  - https://docs.mergify.com/merge-queue/github-rulesets/
  - https://mergify.com/pricing
