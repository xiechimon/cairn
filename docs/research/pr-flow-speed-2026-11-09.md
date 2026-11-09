# Research: why some PRs take hours from open to merge (2026-11-09)

Problem: CI is stable at 5–8 minutes per run on PRs, merge-queue batches and `main`. Clean PRs merge in about 12–13 minutes. The slow tail takes 2–4 hours or more. Five suspected causes: (1) review ping-pong, (2) a 4-deep stacked PR chain, (3) conflicts with a fast-moving `main` and a dequeued PR that did not come back, (4) a serial queue that reruns full CI, (5) waits on humans and on stopped agents.

Labels: **measured** = read or run first-hand in this round; **inferred** = derived from measured facts and reproducible; **guess** = everything else. Repository facts are from `origin/main` at the time of writing (this worktree's branch is older; files were read with `git show origin/main:<path>`). Mergify docs and its JSON schema were fetched on 2026-11-09.

## Measurements

| Fact | Value | Label | Source |
|---|---|---|---|
| Open-to-merge time by size, 81 human/App PRs merged since 2026-11-07 | 0–200 changed lines: median 18 min (n=33); 200–1000: 33 min (n=25); 1000–3000: 88 min (n=14); >3000: 434 min (n=9) | measured | `gh pr list --state merged --search "merged:>=2026-11-07"` |
| Slow PRs are large | #3463 +7937/51 files, #3467 +15049/83 files, #3471 +1354/49, #3488 +1872/-2262/70, #3497 +7399/36, #3489 +1455/-1108/63 | measured | `gh pr view <n> --json additions,deletions,changedFiles` |
| Codex review rounds and findings | #3467: 10 reviews, P1×2 P2×13; #3471: 7, P1×2 P2×8; #3463: 5, P1×1 P2×8; #3488: 4, P1×1 P2×7; #3489: 4, P1×3 P2×2; #3497: 3, P1×3 P2×1. The 59-line #3503 got no finding and merged in 13 min | measured | `pulls/<n>/reviews`, `pulls/<n>/comments` |
| Same class recurs one instance per round | #3463 "setup-drift fingerprint is incomplete": submodule state (r1), hook-staged changes (r2), executable bit (r3), excluded drift before merge (r4), pre-hook agent edits (r5). #3467 "answer delivery lifecycle": after polling stops, on resume, on steer replace, before daemon ack, concurrent steers, orb/recovery runs, dedupe, daemon support, held-question poll. #3489 "token provenance": unattributed user tokens (r1), user-token-only recovery (r2). #3497 "pause record survives every failure path": breaker after main fails, marker publication fails, concurrent record update | measured | PR review comments on [#3463](https://github.com/xiechimon/cairn/pull/3463), [#3467](https://github.com/xiechimon/cairn/pull/3467), [#3489](https://github.com/xiechimon/cairn/pull/3489), [#3497](https://github.com/xiechimon/cairn/pull/3497) |
| P2/P3 findings block the queue | `queue_conditions` contain `'#review-threads-unresolved = 0'`, and `pr-review-findings.ts` converts a PR with any unresolved Codex thread to draft. Added by #3401 on 2026-11-07 after the owner decided every finding must be fixed or answered | measured | `.mergify.yml`, `apps/server/src/services/pr-review-findings.ts`, `docs/research/review-findings-before-ready-2026-11-07.md` |
| The repo rules still say P2/P3 do not block | AGENTS.md "Review guidelines": "Ordinary code-review P2/P3 findings do not block" | measured | `AGENTS.md` |
| Queue CI vs PR CI | Batch PR #3504: 01:38→01:46 (7.4 min, full e2e, 4 shards). Its PR #3503: 01:32→01:45, e2e-affected only. #3501 7.9 min, #3500 PR 14 min end to end | measured | `commits/<sha>/check-runs` |
| Queue depth | 40+ batch PRs from #3352 to #3504: almost all titled "merged #N" with one PR; stacks produce the only multi-PR batches | measured | `gh pr list --author app/mergify` |
| Dequeue reasons on 83 PRs created since 2026-11-07 | PULL_REQUEST_UPDATED 14, PR_MANUALLY_MERGED 4, CHECKS_FAILED 3, GITHUB_REBASE_MERGE_REFUSED 2, PR_DEQUEUED 2, CONFLICT_WITH_BASE_BRANCH 1 | measured | Mergify status-comment payloads |
| Why #3463 did not return to the queue | Dequeued 21:31 for conflict; updated 22:23; every check green at 22:32; a Codex P2 thread opened at 22:30:15 and stayed unresolved, so `#review-threads-unresolved = 0` failed. A manual `@mergifyio queue` at 23:30 was then cancelled twice by the agent's own pushes ("new commits were pushed") | measured (timeline), inferred (cause) | [#3463 comments and events](https://github.com/xiechimon/cairn/pull/3463), GraphQL `reviewThreads` |
| Rebase refusals | Bot rule used `merge_method: rebase`; branches updated by `git merge origin/main` became `rebaseable=false` (#3463, #3467), and #3431/#3422 left the queue with GITHUB_REBASE_MERGE_REFUSED. `main` switched the bot rule to `squash` in c0db41683 (2026-11-08) | measured | `gh api repos/.../pulls/<n>`, `git log origin/main -- .mergify.yml` |
| Stack churn | Merge commits: #3463 3 of 10 commits, #3467 6 of 17, #3471 14 of 23, #3488 2 of 9. #3467 has 83 files, above the queue's `#files <= 80` | measured | `pulls/<n>/commits` |
| Review gate dequeues by command | `codex-gate.mjs` posts `@mergifyio dequeue` when the gate fails on a queued PR | measured | `scripts/ops/review-gate/codex-gate.mjs` `dequeueIfQueued` |
| Two-step CI | `merge_conditions` differ from `queue_conditions`, and `ci.yml` runs the `full` e2e tier only on push and on Mergify batch PRs | measured | `.mergify.yml`, `.github/workflows/ci.yml` `e2e-tier` |

## Conclusions

1. **Review ping-pong is the main cause, and PR size drives it.** Time to merge rises from 18 to 434 minutes with size (measured). Every slow PR is over 1300 lines (measured). Since #3401 every Codex thread, P2 included, holds the PR in draft and keeps it out of the queue (measured), so each P2 costs a push, a CI run and a new review, and the new review finds the next instance of the same class in the fix (measured on four PRs). The rules contradict the mechanism: AGENTS.md says P2/P3 do not block (measured).
2. **The stack makes it worse.** No stacking tool maintains a stack by merging the base into upper branches; all of them rebase (Graphite, git-spice, gh-stack, GitHub native) or keep merge-only branches generated by the tool (ghstack). cairn forbids force pushes, so agents merge up the chain by hand: 14 merge commits in #3471 (measured). After a squash merge of the bottom PR, the next PR still carries the bottom PR's original commits and conflicts with what landed (Mergify, git-spice: measured in docs). Each base push also re-triggers review on every layer (inferred).
3. **The "PR that did not come back" was waiting on an unresolved P2, not on Mergify.** Mergify requeues an auto-queued PR once its conditions match again (measured, lifecycle doc). #3463's conditions did not match because of a fresh P2 thread (measured timeline). `@mergifyio queue` is the wrong remedy: a PR queued by command loses auto-requeue, and any push from someone other than Mergify cancels the pending command (measured, queue command doc). The review gate's own `@mergifyio dequeue` has the same defect: a PR dequeued by command "never rejoins the queue on its own" (measured, dequeue doc), while `check-success = @github-actions/review-gate` in `queue_conditions` already removes a PR whose gate turns red and lets it return on its own (inferred from the lifecycle doc).
4. **The queue is not serial and is not the bottleneck.** It runs in `parallel` mode with 3 parallel checks and `batch_size: 5` (measured). The queue is almost always one PR deep (measured), so batching rarely fires. What a clean PR pays is the second CI run (about 7.5 minutes with the full e2e tier). Mergify's Direct Merge would skip that run for an up-to-date PR or one behind only in other scopes, but it is disabled whenever a queue uses two-step CI (measured, Direct Merge doc), and cairn uses two-step CI on purpose: the full e2e tier runs only in the queue (measured).
5. **Waits are invisible.** A green PR that is not queued shows only a "Waiting for queue conditions" check run (measured, #3463 head). Nothing wakes the owner with the unmet condition. The review round cap (3) exists but only writes a notice (measured, `pr-wakes.ts:284`), and #3467 went to 10 rounds (measured).

## Comparison table

| Source | How it handles the problem | Trade-offs | Link |
|---|---|---|---|
| Mergify batches | `batch_size` integer or `{min, max}`; `batch_max_wait_time` (default 30 s). On failure, splits the first n−1 PRs into N parts tested cumulatively; sizes 1, N+1, N²+N+1 keep all N checks busy (N=3: 1, 4, 13). `batch_max_failure_resolution_attempts` caps rounds. Re-run only failed tests or jobs via `mergify ci queue-info` (measured) | Batching saves CI only when the queue is deep; a failure splits and retests. With N=3, a batch of 5 needs 2 bisection rounds, a batch of 4 needs 1 (measured) | https://docs.mergify.com/merge-queue/batches/ |
| Mergify parallel checks and modes | `max_parallel_checks` (default 5) tests batches speculatively. `serial`, `parallel` (scopes form independent lanes; only identical scope sets share a batch), `isolated` (measured) | RCV trade-off: reliability, cost, velocity, pick two (measured) | https://docs.mergify.com/merge-queue/performance/ ; https://docs.mergify.com/merge-queue/queue-modes/ |
| Mergify Direct Merge | Skips the queue CI run when the PR already contains the base tip, or is behind only by queue merges in other scopes. Needs a batch-PR queue, no two-step CI, no `merge-batch`; the scope case needs scoped PRs and scoped merges (measured) | Not available while `merge_conditions` differ from `queue_conditions` (measured) | https://docs.mergify.com/merge-queue/direct-merge/ |
| Mergify queue vs merge conditions | `queue_conditions` gate entry and are re-checked while queued: a PR that stops matching leaves the queue. `merge_conditions` are evaluated on the batch PR. Two-step CI defers heavy tests to the queue (measured) | Two-step saves PR CI but forces a queue run per PR (measured) | https://docs.mergify.com/merge-queue/rules/ ; https://docs.mergify.com/merge-queue/two-step/ |
| Mergify requeue and commands | Auto-queued PRs (`auto_merge_conditions`) come back on their own once updated. PRs queued by `@mergifyio queue`, its checkbox or the API stay out until queued again. A push from anyone but Mergify cancels a pending queue command. A dequeued PR never rejoins by itself (measured) | Commands break auto-requeue; prefer conditions (inferred) | https://docs.mergify.com/merge-queue/lifecycle/ ; https://docs.mergify.com/commands/queue/ ; https://docs.mergify.com/commands/dequeue/ |
| Mergify conflict handling | A PR conflicting with a PR ahead is held, not removed. `conflict_resolvers` (paths with `union`/`json`/`pnpm`…, or `auto`) settle conflicts for `merge`/`squash` rules by pushing a merge into the PR; never for `rebase` (measured, schema) | Text strategies fit registers and lockfiles, not code (#3463 conflicted on `.ts` files, measured) | https://docs.mergify.com/merge-queue/lifecycle/ ; https://docs.mergify.com/mergify-configuration-schema.json |
| Mergify stacks | Recognizes GitHub-native stacks or `Depends-On:` chains; queues predecessors with the top; keeps a stack in one batch; cascade-dequeues upward. For non-native stacks, remaining members are not rebased after a partial landing and conflict after squash (measured) | Native stacks need Mergify as an `exempt` bypass actor on rulesets (measured) | https://docs.mergify.com/merge-queue/stacks/ |
| Mergify changelog | Dynamic batch size (2026-06-19), Direct Merge for scope-unaffected PRs (2026-07-20), `skip_intermediate_results` in parallel mode (2026-07-08), stacks enter the queue together (2026-10-28), requeue checkbox (2026-06-19), `autoqueue` removed in favor of `auto_merge_conditions` (measured) | — | https://docs.mergify.com/changelog/ |
| GitHub merge queue | Requires the `merge_group` event; groups PRs with the PRs ahead; settings: build concurrency 1–100, "only merge non-failing PRs", status check timeout, merge limits (min, max, wait). Removes a PR on failure, timeout or conflict; jumping the queue rebuilds everything (measured) | No scopes, no Direct Merge equivalent; would replace Mergify and need `merge_group` triggers in `ci.yml` (inferred) | https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue |
| GitHub branch protection (this repo) | `strict: false` (no "up to date" requirement), linear history off, merge commits disabled at repo level, auto-merge on (measured) | `strict: false` is what batch PRs need (Mergify batches doc, measured) | `gh api repos/xiechimon/cairn/branches/main/protection` |
| GitHub native stacked PRs | Each layer targets the one below; server-side cascading rebase; "Rebase stack" button; rebasing keeps approvals when the diff is unchanged; merge bottom-up in contiguous groups; merge queue keeps the stack together (group may exceed max by 50%); `github.event.pull_request.stack` lets CI run expensive jobs only on the bottom or top layer (measured) | Needs `gh stack` or the web UI; same repository only (measured) | https://docs.github.com/en/pull-requests/get-started/about-stacked-prs ; https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/merging-stacked-pull-requests ; https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/optimizing-ci-for-stacked-pull-requests |
| Graphite | Tracks parents; `gt restack` rebases every dependent branch; stack-aware merge queue; reviewers review each layer as an independent change, from the bottom, as soon as tagged (measured) | Rebase-based, force-pushes branches (inferred) | https://graphite.com/docs/restack-branches ; https://graphite.com/docs/graphite-merge-queue ; https://graphite.com/docs/best-practices-for-reviewing-stacks |
| ghstack | One commit per PR on generated `gh/<user>/<n>/{base,head,orig}` branches that are never force-pushed; rebasing adds merge commits to `base`. Says not to `git merge` the stack: conflicts must be resolved per PR. Lands with `ghstack land` (measured) | Requires its own land command; PRs cannot be merged in the GitHub UI (measured) | https://github.com/ezyang/ghstack |
| git-spice | `gs stack submit` and restack; squash merges force restacking the upstack; native stack merges on GitHub avoid it. In fork mode it opens CRs only for branches based on trunk and pushes the rest until their base merges (measured) | Stack merge is experimental (measured) | https://abhinav.github.io/git-spice/guide/cr/ ; https://abhinav.github.io/git-spice/guide/merge/ |
| Google eng-practices | One self-contained change per CL; 100 lines is usually reasonable, 1000 usually too large; reviewers may reject for size alone; stack the next CL while waiting; respond within one business day; "LGTM with comments" to avoid another round (measured) | Human-team guidance; no AI reviewer (inferred) | https://google.github.io/eng-practices/review/developer/small-cls.html ; https://google.github.io/eng-practices/review/reviewer/speed.html |
| trunkbaseddevelopment.com | Short-lived branches last at most a couple of days; review wait counts toward branch life; each agent session is a short-lived branch: keep each agent's change small, integrate one at a time and re-sync the others with trunk (measured) | — | https://trunkbaseddevelopment.com/short-lived-feature-branches/ |
| OpenAI Codex code review | Reviews the PR diff; on GitHub flags only P0/P1 by default; reads `## Code Review Rules` sections in `AGENTS.md`, nested files for scoped rules; a one-off focus by adding `for <focus>` after the review mention; a fix request by mention (measured) | cairn sees P2 badges and uses the heading "Review guidelines", not "Code Review Rules" (measured); whether Codex reads the old heading is unverified (guess) | https://developers.openai.com/codex/cloud/code-review |
| GitHub Copilot code review | Reviews once unless "Review new pushes" is enabled; "Maximum review effort" Lite/Balanced/Max; repository custom instructions (measured) | Re-review on every push is opt-in (measured) | https://docs.github.com/en/copilot/how-tos/use-copilot-agents/request-a-code-review/configure-automatic-review ; https://docs.github.com/en/copilot/concepts/agents/code-review |
| CodeRabbit | Incremental review on each push by default; `@coderabbitai full review` re-reviews from scratch; `auto_pause_after_reviewed_commits` (default 5) pauses automatic review; profiles `chill`/`assertive`; path instructions (measured) | Built-in convergence brake: the vendor stops itself after N reviewed commits (measured) | https://docs.coderabbit.ai/guides/commands ; https://docs.coderabbit.ai/reference/configuration |
| cairn today | Two-step CI, parallel mode, 3 checks, batch 5, every Codex thread blocks via draft hold and `#review-threads-unresolved = 0`, review round cap 3 as a notice only, gate dequeues by command, agents update stacks by merging (measured) | One row of this table, not the baseline | `.mergify.yml`, `scripts/mergify-config.mjs`, `scripts/ops/review-gate/codex-gate.mjs`, `apps/server/src/services/pr-wakes.ts`, `pr-review-findings.ts` |

## The pattern that fits cairn

- **Small slices, one at a time, no open stacks by default.** Google's size guidance and trunk-based development's "one agent session is one short-lived branch, integrate one at a time" match the measured size curve. A clean small PR merges in about 13 minutes, which is cheaper than any restack cost, so the next dependent task waits for the base to merge (git-spice's fork-mode behavior: push the branch, open the PR only once its base merged). When a chain is unavoidable, use a tool that restacks server-side (GitHub native stacks) rather than hand merges, because cairn forbids force pushes.
- **Converge reviews on the author side, then cap.** The author fixes the whole class per push and pushes once per round; the reviewer is told to group instances; after round 3 the vendor-style brake applies (CodeRabbit pauses after 5 commits; cairn's cap already exists and only needs to bind). The owner's 2026-11-07 decision (every finding fixed or answered) stays; answering is the cheap exit the agents are not using.
- **Let conditions, not commands, drive the queue.** Remove `@mergifyio dequeue` from the gate and never post `@mergifyio queue`; surface "Waiting for queue conditions" to the owner agent instead.
- **Keep two-step CI until Direct Merge can be proven safe.** Batching tweaks are cheap but the queue is shallow; the only large queue-side win (skipping the second run) needs single-step CI, which is an experiment, not a config edit.

## Recommendations

### A. Config-only (`.mergify.yml`, generated by `scripts/mergify-config.mjs`)

`.mergify.yml` is generated: change the constants in `scripts/mergify-config.mjs` and regenerate with `node scripts/mergify-config.mjs`; `scripts/mergify-config.test.mjs` fails when the two differ. Both files are protected paths (`**/scripts/**`).

Exact diff against `origin/main`'s `.mergify.yml`, validated with Ajv against https://docs.mergify.com/mergify-configuration-schema.json (both the current and the proposed file pass; negative controls with an unknown `batch_size` key and an unknown `merge_queue` key fail, measured):

```diff
@@ queue_rules: default
     merge_method: squash
-    batch_size: 5
+    batch_size:
+      min: 1
+      max: 4
     batch_max_wait_time: 0 s
@@ queue_rules: bot
     merge_method: squash
-    batch_size: 5
+    batch_size:
+      min: 1
+      max: 4
     batch_max_wait_time: 0 s
@@ commands_restrictions
   dequeue:
     conditions:
-      - or:
-          - sender-permission >= write
-          - sender = github-actions[bot]
+      - sender-permission >= write
```

Generator change: `const batchSize = { min: 1, max: 4 };` rendered as the two-line mapping, and drop `gateBot` from the dequeue restriction.

Why:
- `batch_size {min: 1, max: 4}`: with 3 parallel checks, a light queue tests each PR alone (fast to isolate a culprit), and a backlog grows to 4, which bisects in one round, where 5 needs two (measured, batches doc). Small win, because the queue is usually one deep (measured).
- Dequeue restriction: only meaningful together with code change B1; the gate bot no longer needs to dequeue.

Considered and not recommended now:
- `merge_queue.skip_intermediate_results: true`: helps only when several batches are in flight; the queue rarely has two (measured). Revisit if CHECKS_FAILED on flaky e2e grows.
- `conflict_resolvers`: observed conflicts are in TypeScript sources (measured); text strategies would merge code silently. Possible later for append-only registers (`docs/ops/issue-coverage.json` with `json`).
- `reset_on_external_merge: never`: admin merges (PR_MANUALLY_MERGED ×4) reset the queue, but keeping the reset is what keeps batch results valid (inferred).
- Moving to the GitHub merge queue: no Direct Merge, no scopes, and `ci.yml` would need `merge_group` triggers (measured, GitHub docs).

### B. Code changes (codebase level of the correction ladder)

1. **Gate stops dequeuing by command.** Delete `dequeueIfQueued` and its two call sites in `scripts/ops/review-gate/codex-gate.mjs`; the failing `review-gate` check already breaks `queue_conditions`, which removes the PR and lets it requeue itself (inferred from the lifecycle doc). Red test first in `codex-gate-host.test.mjs`: a red verdict on a queued PR posts no `@mergifyio` comment. Verify once on a scratch PR that a gate turning red while queued removes it with a condition reason and that it re-enters after the gate turns green (the one runtime fact the docs leave implicit).
2. **Make the review round cap bind.** In `apps/server/src/services/pr-wakes.ts`, when `ledger.reviews >= 3` and findings remain, stop auto-fix wakes and post one comment on the PR that lists every finding class raised so far, then request one focused Codex review of every remaining instance of those classes across the whole PR diff (the Codex focus form, measured; the server builds the request string in `focusedCodexReview`, so no one types it). The owner or coordinator then decides: split, answer, or fix in one final push. Red test: a fourth review round with open findings produces a wake today.
3. **Surface queue waits.** In the PR poller (`pr-watch.ts` / `pr-wakes.ts`), when all required checks are green and the `Mergify Merge Queue` check run has read "Waiting for queue conditions" for more than 10 minutes, wake the owning agent with the check run's summary (the unmet conditions), not a generic nudge. Red test: the #3463 shape (green checks, one unresolved thread, no wake) produces no wake today.
4. **Phase 2 experiment, not yet a recommendation: single-step CI for Direct Merge.** Run the `full` e2e tier on PRs (`ci.yml` `e2e-tier`), make `merge_conditions` identical to `queue_conditions`, and make every PR-only check (`commit-author`, `review-gate`, `merge-route`, `pr-evidence`) report success or skipped on `mergify/merge-queue/*` batch PRs so a batch can satisfy them. Expected gain: about 7 minutes per clean PR that is up to date or behind only in other scopes (inferred). Unknowns: how often a PR is still up to date when it reaches the front (guess), extra PR CI minutes per push (inferred: one full e2e run per push), and whether the docs/ops PRs that match no scope block the scope case for PRs behind them (measured: they do, Direct Merge doc). Try it on a scratch repository with the same config before touching this one.

### C. Rule text

Add to `AGENTS.md` (CLAUDE.md is a symlink to it), section `## How to work`, replacing "After three review rounds, rethink the approach or hand the PR to ian.":

```markdown
- Keep each PR to one self-contained change. Aim for under 400 changed lines outside generated files; past 1000, split before asking for review. Measured on 81 merged PRs: median open-to-merge is 18 minutes under 200 lines and 434 minutes over 3000.
- Before code for a lifecycle or state change (delivery, retry, pause, identity, attribution), list in the PR body every path that reads or writes that state and the expected behavior on each, and write one test per row. Review findings on such PRs are usually a missed row.
- When a review finding arrives, name its bug class, search the whole PR diff and every entry path the change touches for other instances, and fix all of them in the same push. Reply on the thread with the class and the sites you changed, then resolve it.
- Push once per review round: collect every open finding on the head, fix or answer each, and push one commit. Do not push between findings.
- Answering is a valid exit: when a finding is not a defect, or is outside this PR's change, reply with the reason, file an issue for anything real that you defer, link it, and resolve the thread.
- After the third review round with findings still open, stop pushing fixes. Post the list of finding classes and hand the PR to the coordinator, who splits it, accepts the answers or asks for one final push.
- Never post `@mergifyio queue` or `@mergifyio dequeue`. A green PR enters the queue by itself; if it does not within 10 minutes, read the `Mergify Merge Queue` check run, fix the unmet condition it lists, and report it.
- Do not open a PR on top of another open PR. Branch the next task from `origin/main` after its dependency merges; if you must start earlier, commit on a local branch on top of it and open the PR only after the base has merged and you have merged `origin/main` into your branch.
```

Fix the contradiction in `## Review guidelines` and rename the section to the heading the Codex docs name, so Codex reads it reliably:

```markdown
## Code Review Rules

- Review only what the PR changes. Report a defect on a line the PR did not add or modify only when the PR's change makes it reachable or worse; otherwise leave it for the nightly scan, which files old-code problems as issues.
- On a later review of the same PR, read only the commits pushed since the last review and do not repeat a finding that is already raised or resolved.
- Name the bug class of each finding and list every instance of it in the diff in one comment, so one push fixes the class instead of one line per round. When a later commit adds another instance of a class already raised on this PR, add it to that class's list instead of opening a new thread.
- Use P0 or P1 only for a defect that breaks behavior, loses data or opens a security hole. P2/P3 findings do not fail `review-gate`, but every review thread must be fixed or answered and resolved before the PR leaves draft and enters the queue (`#review-threads-unresolved = 0`). Canonical security surfaces require zero unresolved security findings at every severity.
```

Agent briefs (dispatch prompts and the PR wake prompt in `pr-wakes.ts`) gain this block:

```text
Review convergence: for each Codex finding, name its bug class, find every other instance in this PR's diff and the entry paths it touches, and fix them all in one push. Reply on each thread with the class and the sites changed, then resolve it. If a finding is not a defect or is outside this change, answer it with the reason (and a linked issue for deferred real work) and resolve it. Push once per round. After round 3 with findings open, stop and hand the PR to the coordinator with the class list.
Queue: never post @mergifyio commands. If the PR is green but not queued after 10 minutes, read the "Mergify Merge Queue" check run and fix the unmet condition.
Stacking: branch from origin/main. If your task depends on an open PR, wait for it to merge or keep your work local until it does; do not open a PR whose base is another PR's branch.
Size: one self-contained change, under 400 changed lines outside generated files; split anything past 1000 before review.
```

Pre-push self-review and the repo's ban on a local `codex exec` / `claude -p` review: the class sweep above is done by the implementing agent in its own session as part of writing the fix, not as a separate review run, so it fits the rule (inferred). The other allowed path is the Codex cloud reviewer itself, asked for a focused full pass (B2), which is the sanctioned other-vendor review on the PR head.

### D. Decisions for the owner

1. **Stacking.** Recommended: ban open stacks by default (rule above). Alternative: enable GitHub native stacks with `gh stack` for chains the coordinator approves, so restacking is server-side and keeps approvals (measured, GitHub docs); needs a check that Mergify treats this repository's classic branch protection like the rulesets its docs describe.
2. **Size gate.** Recommended: a rule now (C), and a `pr-size` check that fails above 3000 non-generated changed lines unless the coordinator labels the PR, once the rule has run a week.
3. **Answer-and-defer for P2/P3.** The 2026-11-07 decision allows "reply explaining why it is not a defect". Recommended: also allow "real but outside this change: deferred to #N" as an answer, which removes most of the measured P2 rounds.

## Failure modes to test before implementing B

- Gate turns red while a PR sits in a batch: the PR must leave the queue without the dequeue command (B1 drill), or the old command stays.
- Gate turns green again after a red verdict: the PR must re-enter without any comment.
- Round cap: a fourth Codex review with findings must not wake auto-fix and must post the class list once (idempotent per head).
- Queue-wait wake: must not fire while checks are pending, while the PR is draft by the findings hold, or with `coordinator-hold`; must fire once per unmet-condition summary.
- Dynamic batch size: a stack of 5 no longer fits one batch of 4; it lands across consecutive batches bottom-first (measured, stacks doc). Acceptable, since stacks become rare under the rule.

## Code areas

`scripts/mergify-config.mjs`, `.mergify.yml`, `scripts/mergify-config.test.mjs`, `scripts/ops/review-gate/codex-gate.mjs` and `codex-gate-host.test.mjs`, `apps/server/src/services/pr-wakes.ts`, `apps/server/src/services/pr-watch.ts`, `apps/server/src/services/pr-review-findings.ts`, `AGENTS.md`, `docs/agent-dispatch-prompts.md`, `.claude/skills/pr-cairn/SKILL.md`, and for Phase 2 `.github/workflows/ci.yml`.
