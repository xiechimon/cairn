# Remove the product merge gate

Status: approved by the coordinator on 2026-11-16, then revised with the owner's explicit approval: successful code tasks finish immediately; remove the merge-choice UI and its prompts. Preserve legacy stop/report handling and do not perform unattended remote cleanup. Source audit: [product merge-gate removal](../research/remove-product-merge-gate-2026-11-16.md).

Agents finish their tasks and retain the work branch or PR. Cairn must not demand a second agent, a different model, a review verdict, a recording or a gate evaluation. Only an explicit conversational user instruction authorizes a merge. There is no replacement gate setting or merge-choice UI.

## Remove and retain

Remove automatic review/verify dispatch after delivery and CI, review-driven replanning, readiness evaluation/status writes/mismatch issues, gate-dependent ownership, local/custom readiness checks, gate APIs and UI dependencies, model-independence rules and obsolete product instructions. Remove Cairn's review-findings hold-label and draft/ready enforcement. User-controlled feedback auto-fix may remain but cannot impose a review requirement or change PR readiness on its own.

Retain ordinary implementation testing, CI results, repository-owned GitHub requirements, authentication, task/build ownership checks, correct repository/base/head checks, duplicate merge prevention, dirty-worktree protection and atomic ref updates. Retain research citation checking and standalone eval execution; they are not code-review admission. Information-only tasks keep their existing report acceptance behavior. This repository's own development CI/merge queue is outside scope.

## Lifecycle and migration contract

Successful code delivery enters `done` with the actual `hasChanges` result and retains the work branch and PR. It does not wait for user acceptance or merge selection. Existing failure, question and blocked-task states keep their meaning. Information-only delivery keeps its report contract. The Coordinator never asks whether to merge and never decides to merge. Only an explicit user merge instruction authorizes `merge_builds`, which calls the existing `requestMerge` service for the current delivered build, including an already completed task. The authenticated MCP tool uses the same service and existing grants. Neither green CI nor an old autonomous policy grants merge authority.

An explicitly requested merge does not reopen a completed task. Claim, finish, stop and abandoned recovery must continue handling that merge without treating `done` as cancellation. Closed, archived and superseded deliveries remain ineligible. Preserve target/head pinning, GitHub-owned requirements, dirty-worktree checks, atomic ref updates and duplicate-operation protection. Local, hosted and custom repositories retain the conversational route before the merge UI is deleted.

| State reader/writer or entry path | Required behavior and regression test |
| --- | --- |
| Build completion (`build-step-complete`) | Local, hosted and GitHub code deliveries finish without creating review/verify steps or merging. A single-model fresh user works. Preserve no-change/info delivery contracts. |
| CI green/red (`ci-grind-outcome`, `ci-review-reconcile`) | CI can report/fix failures under the existing setting and reconcile a merged/closed PR; successful CI-fix delivery finishes. Green CI never queues mandatory review/verify or authorizes merging. |
| Ownership (`owner`, notifications, task serialization) | Delivered code is done with no active owner even with absent, stale, passing, blocking or transient `gate_state`. It appears in resolved, not ready-for-review or indefinitely working. |
| Retired queued review/verify work | Stop only retired system-generated gate steps, using existing stop machinery. Never cancel an implementation session or an ordinary user-requested review session. Repeated startup is idempotent. |
| Retired claimed review/verify work | Request stop through the existing machine protocol. Late reports retain historical messages but cannot clear changes, replan, fail the delivered task, or make a merge decision. Preserve claim/stop ownership rules. |
| Existing in-progress builds | Continue implementation; their completion uses the new handoff. Do not move a task with a live implementation or blocking question into review prematurely. |
| Existing tasks stalled only on gate work | Once retired work is stopped, finish the latest successful code delivery. Never revive done, closed, archived, failed or superseded builds, and never finish information reports through this migration. |
| `gate_*` data, review messages and applied migrations | Preserve historical rows and messages without using them for admission or current status. Do not edit applied SQL migrations or drop history. Remove runtime gate readers/writers and retire schema exports only after historical consumers are detached. |
| Project merge policy and ship-route records | Old `human`, `shadow`, `autonomous` and `merge-gate` values must no longer control admission. Normalize obsolete route/policy metadata while preserving unrelated autonomy settings, plan approval and local checks. Update schema/API consumers together. |
| Explicit conversational merge (`chief-tools`, MCP, `requestMerge`) | Check team/build ownership and invoke `requestMerge`; accept current completed code deliveries without reopening them. Test completed, superseded, cross-team, archived and duplicate requests. Prompts require explicit user authority and prohibit merge suggestions. |
| Explicit GitHub merge (`requestMerge`, `mergeThroughGithub`) | Reuse the existing human-triggered path. No gate/reviewer read. Preserve exact checkpoint pin and external repository requirements. Missing auth or a changed target/head is actionable refusal, not a request to configure reviewers. |
| Explicit local merge (`local-merge`, daemon landing) | Prepare a command from the user's current delivered changes and base, without review/eval/recording readiness. Preserve integrity rechecks and atomic compare-and-swap; drift asks the user to retry, not to obtain a verdict. |
| Explicit hosted/custom ship, machine claim/finish/abandoned recovery | No retired readiness evaluation. Preserve correct-target, commit pin, actual-landing and duplicate-operation checks. Already claimed merge operations are reconciled, not silently replayed. Pending user-requested merges keep their explicit authority. |
| PR findings (`pr-review-findings`, `pr-wakes`, worker prompt) | Feedback is informational or follows user-controlled auto-fix. Do not add review-hold labels or change draft/ready. Existing review holds are explained to the user; no unattended remote label/ready mutation during upgrade. |
| External Cairn status already required by the user's repository | Stop writing the retired status. Explain that the repository owner must remove that retired required context. Do not change branch protection, forge a pass, or override unrelated repository requirements. |
| Gate endpoint and frontend cache | Remove requests and endpoint together; remove merge-selection controls rather than replacing them. Old clients must refresh after upgrade; no new success-shaped readiness shim. |
| PR watch, verified indicator, retry lessons, correction and daily reports | Preserve historical facts or use current delivery/verification facts; never convert absence of an agent review into an error or falsely claim verification passed. |

Startup migration uses the existing data-migration mechanism and is repeatable. It preserves work branch commits, PR links, reports, attachments, user configuration unrelated to the gate and task history. Stopping claimed work is a runtime reconciliation, not a SQL-only rewrite that lets late completions mutate tasks. A migration failure leaves the transaction unchanged and reports the failure; no remote writes occur during migration.

Abandoned local merge recovery retains a current claimed command and its pending admission when the landing is unknown, irrespective of the legacy project merge policy. A timeout is not evidence that the write failed. Repeated sweeps must not release or quarantine that command for another execution; daemon recovery can still report the original claim's result. Closed, archived, stop-requested and superseded tasks take the existing stop path before this retention rule, while retaining the unknown admission. Ordinary abandoned implementation steps keep their existing retry behavior. Regression coverage exercises both legacy policies, repeated sweeps and each cancellation path; the existing step-claim model does not model local merge commands or their landing state.

## User-visible changes and UI brief

Surface: thread and review, Tasks panel, completion dialog, public introduction and first-task guide. Goal: finish the task without a merge decision prompt; do not imply a missing model review is unfinished work. Rules: P1-P5, C1, C5, C10, C14, C15, V1, V5, V10, T1, T2, A1-A4, R1.

References to open before screenshots: `docs/design/references/thread-review/t3code-done-changed-file-card.png` (changes and diff as the deliverable), `docs/design/references/thread-review/t3code-worked-expanded-with-diff.png` (separate diff), and `docs/design/references/coordinator-chat/claude-duet-task-thread-ready-for-review.jpg` (the user's pending decision). This is removal on existing screens, not a new surface; use real components for the draft, not a generated image.

Remove review PASS/BLOCK, judged-head, stale-review, missing-review and owner-route explanations from current PR cards. Show PR open/draft/merged/closed, conflicts, CI running/failed/unread, branch and diff. No verdict means an ordinary open PR, not waiting for review. Remove the completion dialog, merge checkbox, complete-and-merge action, task-row instruction to decide whether to merge, and code progress line that falsely marks checking and merging complete. Do not replace them with another merge-choice UI. Successful code tasks appear as completed. Users may inspect retained changes or PRs and independently request a merge in conversation or use GitHub. Information reports retain their acceptance action and progress.

| Affected element | States to render with the real component |
| --- | --- |
| Task row/header and user attention section | Delivered local/hosted/GitHub, no changes, no reviewer configured, old blocked gate, long title, pending question, offline runner |
| PR line and hover details | Open without any review, CI unread/running/failing/passing, conflicts, draft, behind, merged, closed, long title/branch |
| Deleted completion dialog and code progress line | Assert absent for completed code tasks; report acceptance completes directly without a dialog or merge request. Preserve plan approval and information progress. |
| Public landing introduction and first-task guide | Both languages, changed explanatory sections and captions, narrow wrapping |

Every changed element/state is captured at 1440px and 390px, light and dark; mark fixture/seeded captures as such. Empty/loading/error are produced where the component supports them; a PR-less task has no PR row rather than a placeholder. Use a live stack for the main delivered-task state. Inspect captures, then give each affected element to an independent read-only subagent for a score; fix and repeat until every element scores at least 9/10 (≥9) in all four combinations. Send the screenshots to the Space for mon X before landing visible changes; no further screenshot confirmation is required. No score is claimed before these runs.

## Delivery sequence and proof

1. Get coordinator review of this lifecycle/migration design before product edits. Produce real-component UI drafts and show them to mon X through the Space before final UI implementation.
2. Stop compulsory dispatch and gate-owned handoff, including restart/late-completion handling; keep each intermediate state runnable. Include migration tests and code-delivery/owner regression tests.
3. Detach explicit local/custom ship from verdict admission while retaining write safety; detach evaluation/status writes and external review-hold enforcement. Cover each entry path above through its public interface.
4. Remove dead gate-only modules/contracts/tests in bounded cleanup batches; preserve shared development-policy data and non-gate consumers. Update public copy, current specs/designs, feature map and retirement notes. Do not leave an optional gate behind.
5. Fetch and integrate current `origin/main`, run directly related single-worker checks, then push each self-contained batch directly to `main` without force. Close the superseded draft PR #5287 after delivery. This replaces the earlier PR-based sequence under the owner's explicit authorization.

Run targeted Vitest with `--maxWorkers=1` and directly affected Playwright with `workers=1`; do not queue broad regression suites for this batch. Exercise an isolated real-stack delivery-to-done path with fresh-user and upgrade seeds; test no-reviewer, blocked historical verdict, explicit conversational merge, no automatic merge, moving heads/bases and late retired reports. Stop test stacks after use. Completed merge/claim formal checks describe retained integrity/claim code; old verdict properties do not prove the new user-authority contract. Keep verification evidence uncommitted.

Implementation and verification are tracked in the removal thread; design approval alone does not claim any behavior is already removed.
