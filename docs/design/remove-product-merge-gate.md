# Remove the product merge gate

Status: approved by the coordinator on 2026-11-16, including legacy stop/report handling, no unattended remote cleanup, and an unchecked merge default. Owner decision: 2026-11-16. Source audit: [product merge-gate removal](../research/remove-product-merge-gate-2026-11-16.md).

Agents deliver their results; the user decides whether to merge. Cairn must not demand a second agent, a different model, a review verdict, a recording or a gate evaluation before the user can decide. There is no replacement gate setting.

## Remove and retain

Remove automatic review/verify dispatch after delivery and CI, review-driven replanning, readiness evaluation/status writes/mismatch issues, gate-dependent ownership, local/custom readiness checks, gate APIs and UI dependencies, model-independence rules and obsolete product instructions. Remove Cairn's review-findings hold-label and draft/ready enforcement. User-controlled feedback auto-fix may remain but cannot impose a review requirement or change PR readiness on its own.

Retain ordinary implementation testing, CI results, repository-owned GitHub requirements, authentication, task/build ownership checks, correct repository/base/head checks, duplicate merge prevention, dirty-worktree protection and atomic ref updates. Retain research citation checking and standalone eval execution; they are not code-review admission. Information-only tasks keep their existing report acceptance behavior. This repository's own development CI/merge queue is outside scope.

## Lifecycle and migration contract

Keep task phase `review` as the existing user handoff; do not add a new phase. Successful code delivery enters it with the actual `hasChanges` result, regardless of whether a PR exists or any reviewer is configured. Existing failure, question and blocked-task states keep their meaning. Merging still needs an explicit user action; neither green CI nor an old autonomous policy grants new merge authority.

| State reader/writer or entry path | Required behavior and regression test |
| --- | --- |
| Build completion (`build-step-complete`) | Local, hosted and GitHub code deliveries enter user review without creating review/verify steps. A single-model fresh user works. Preserve no-change/info delivery contracts. |
| CI green/red (`ci-grind-outcome`, `ci-review-reconcile`) | CI can report/fix failures under the existing setting and reconcile a merged/closed PR; green CI never queues mandatory review/verify or authorizes merging. |
| Ownership (`owner`, notifications, task serialization) | Delivered code belongs to the user even with absent, stale, passing, blocking or transient `gate_state`. It appears in ready-for-review, not indefinitely working. |
| Retired queued review/verify work | Stop only retired system-generated gate steps, using existing stop machinery. Never cancel an implementation session or an ordinary user-requested review session. Repeated startup is idempotent. |
| Retired claimed review/verify work | Request stop through the existing machine protocol. Late reports retain historical messages but cannot clear changes, replan, fail the delivered task, or make a merge decision. Preserve claim/stop ownership rules. |
| Existing in-progress builds | Continue implementation; their completion uses the new handoff. Do not move a task with a live implementation or blocking question into review prematurely. |
| Existing building tasks stalled only on gate work | Once retired work is stopped, hand the latest successfully delivered build to the user. Never revive done, closed, archived, failed or superseded builds. |
| `gate_*` data, review messages and applied migrations | Preserve historical rows and messages without using them for admission or current status. Do not edit applied SQL migrations or drop history. Remove runtime gate readers/writers and retire schema exports only after historical consumers are detached. |
| Project merge policy and ship-route records | Old `human`, `shadow`, `autonomous` and `merge-gate` values must no longer control admission. Normalize obsolete route/policy metadata while preserving unrelated autonomy settings, plan approval and local checks. Update schema/API consumers together. |
| Explicit GitHub merge (`requestMerge`, `mergeThroughGithub`) | Reuse the existing human-triggered path. No gate/reviewer read. Preserve exact checkpoint pin and external repository requirements. Missing auth or a changed target/head is actionable refusal, not a request to configure reviewers. |
| Explicit local merge (`local-merge`, daemon landing) | Prepare a command from the user's current delivered changes and base, without review/eval/recording readiness. Preserve integrity rechecks and atomic compare-and-swap; drift asks the user to retry, not to obtain a verdict. |
| Explicit hosted/custom ship, machine claim/finish/abandoned recovery | No retired readiness evaluation. Preserve correct-target, commit pin, actual-landing and duplicate-operation checks. Already claimed merge operations are reconciled, not silently replayed. Pending user-requested merges keep their explicit authority. |
| PR findings (`pr-review-findings`, `pr-wakes`, worker prompt) | Feedback is informational or follows user-controlled auto-fix. Do not add review-hold labels or change draft/ready. Existing review holds are explained to the user; no unattended remote label/ready mutation during upgrade. |
| External Cairn status already required by the user's repository | Stop writing the retired status. Explain that the repository owner must remove that retired required context. Do not change branch protection, forge a pass, or override unrelated repository requirements. |
| Gate endpoint and frontend cache | Remove requests and endpoint together; old cached gate data has no effect on the user's selection. Old clients must refresh after upgrade; no new success-shaped readiness shim. |
| PR watch, verified indicator, retry lessons, correction and daily reports | Preserve historical facts or use current delivery/verification facts; never convert absence of an agent review into an error or falsely claim verification passed. |

Startup migration uses the existing data-migration mechanism and is repeatable. It preserves work branch commits, PR links, reports, attachments, user configuration unrelated to the gate and task history. Stopping claimed work is a runtime reconciliation, not a SQL-only rewrite that lets late completions mutate tasks. A migration failure leaves the transaction unchanged and reports the failure; no remote writes occur during migration.

## User-visible changes and UI brief

Surface: thread and review, Tasks panel, completion dialog, public introduction and first-task guide. Goal: show the result and let the user choose; do not imply a missing model review is unfinished work. Rules: P1-P5, C1, C5, C10, C14, C15, V1, V5, V10, T1, T2, A1-A4, R1.

References to open before screenshots: `docs/design/references/thread-review/t3code-done-changed-file-card.png` (changes and diff as the deliverable), `docs/design/references/thread-review/t3code-worked-expanded-with-diff.png` (separate diff), and `docs/design/references/coordinator-chat/claude-duet-task-thread-ready-for-review.jpg` (the user's pending decision). This is removal on existing screens, not a new surface; use real components for the draft, not a generated image.

Remove review PASS/BLOCK, judged-head, stale-review, missing-review and owner-route explanations from current PR cards. Show PR open/draft/merged/closed, conflicts, CI running/failed/unread, branch and diff. No verdict means an ordinary open PR, not waiting for review. The task waiting on the person uses the existing user-review state. Keep current merge/no-merge choices and genuine errors; remove the gate-dependent merge default. Propose an unchecked merge choice on every repository kind so completing a task alone never implies merging. Existing failed-task recovery retains its explicit merge-only explanation. Show these choices in the screenshot draft before implementation.

| Affected element | States to render with the real component |
| --- | --- |
| Task row/header and user attention section | Delivered local/hosted/GitHub, no changes, no reviewer configured, old blocked gate, long title, pending question, offline runner |
| PR line and hover details | Open without any review, CI unread/running/failing/passing, conflicts, draft, behind, merged, closed, long title/branch |
| Completion dialog | Merge selected and deselected, no changes, info task, merge pending, authentication/head-change error; no PR while loading or absent |
| Public landing introduction and first-task guide | Both languages, changed explanatory sections and captions, narrow wrapping |

Every changed element/state is captured at 1440px and 390px, light and dark; mark fixture/seeded captures as such. Empty/loading/error are produced where the component supports them; a PR-less task has no PR row rather than a placeholder. Use a live stack for the main delivered-task state. Inspect captures, then give each affected element to an independent read-only subagent for a score; fix and repeat until every element scores strictly above 9/10 in all four combinations. Send the draft screenshots to the Space for mon X before landing visible changes. No score is claimed before these runs.

## Delivery sequence and proof

1. Get coordinator review of this lifecycle/migration design before product edits. Produce real-component UI drafts and show them to mon X through the Space before final UI implementation.
2. Stop compulsory dispatch and gate-owned handoff, including restart/late-completion handling; keep each intermediate state runnable. Include migration tests and code-delivery/owner regression tests.
3. Detach explicit local/custom ship from verdict admission while retaining write safety; detach evaluation/status writes and external review-hold enforcement. Cover each entry path above through its public interface. Split self-contained changes below 1000 changed lines, with tests counted.
4. Remove dead gate-only modules/contracts/tests in bounded cleanup PRs; preserve shared development-policy data and non-gate consumers. Update public copy, current specs/designs, feature map and retirement notes. Do not leave an optional gate behind.
5. Each dependent PR starts from updated `origin/main` after its predecessor merges. No stacked PR bases. Use the xiechimon local `gh` identity for PR bodies and draft/ready, as requested.

Run targeted Vitest with `--maxWorkers=1`, affected Playwright with `workers=1`, `pnpm lint`, `pnpm typecheck` and `pnpm spec:parse`. Exercise an isolated real-stack delivery-to-user-decision path with fresh-user and upgrade seeds; test no-reviewer, blocked historical verdict, user merge/no-merge, moving heads/bases and late retired reports. Stop test stacks after use. Run the merge/claim formal checks for retained integrity/claim code; explicitly retire model promises that required agent verdicts rather than presenting old model success as proof of the new contract. Keep evidence out of PR branches.

Implementation and verification are tracked in the removal thread; design approval alone does not claim any behavior is already removed.
