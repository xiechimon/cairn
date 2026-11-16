# Product merge-gate removal audit

The product must deliver changes to the user without requiring an agent review. This audit follows the owner's removal decision, not a proposal to introduce a replacement gate. All observations below are first-hand source reads at `bb9a36df9`; no external product behavior is being copied.

## Existing paths and trade-offs

| Source | Observed behavior | Removal consequence |
| --- | --- | --- |
| `apps/server/src/services/build-step-complete.ts`, `ci-grind-outcome.ts`, `build-review-enqueue.ts` | Observed: a delivered GitHub build remains building, queues an independent Codex review, and the passing CI path also queues review and verification. | Finish successful code delivery directly into `done`, retaining its branch or PR. Preserve implementation-time testing and CI monitoring. |
| `apps/server/src/services/build-gate-steps.ts` | Observed: a blocking review automatically queues replanning and clears `hasChanges`. | Old review completions must not overwrite delivery state or restart work. |
| `apps/server/src/services/merge-gate-run.ts`, `merge-gate/readiness.ts`, `ci-loop.ts` | Observed: a sweep evaluates verdicts, evidence, paths, model identity, harness evaluation and policy, persists gate state, writes a GitHub status and may create mismatch issues. | Remove evaluation and its side effects, not just the independent-model predicate. |
| `apps/server/src/services/build-merge-request.ts`, `ship-gate.ts`, `local-merge.ts`, `local-merge-facts.ts` | Observed: local and custom ship routes require product readiness; custom merge commands are rechecked at claim and completion. | A user's merge action must not require review, verification, recording or a gate verdict. Keep target/head/base and write-safety checks. |
| `apps/server/src/services/build-github-merge.ts` | Observed: manual GitHub merging already uses task/current-build, branch, author, base, checkpoint SHA and required-check checks without consulting review verdicts or a patch digest. | Reuse this path's safety checks; do not introduce a new reviewer or claim that manual GitHub merging currently checks verdicts. |
| `apps/server/src/services/owner.ts` | Observed: missing or transient gate state can suppress review ownership; policy and human blockers select the owner. | Successful code delivery is complete with no active owner, independently of models, project policy or cached gate data. |
| `apps/server/src/services/pr-review-findings.ts`, `pr-wakes.ts`, `packages/shared/src/records/prompts.ts` | Observed: unresolved external review findings can add a hold label and turn a PR into draft even with auto-fix disabled; prompts forbid the worker from marking it ready. | Remove Cairn-imposed draft/ready and label enforcement. Preserve review feedback as information and existing user-controlled auto-fix. |
| `apps/server/src/legacy/agent-layer/{routing-rules,data-migration,routing-migration}.ts`, `apps/server/src/services/routing-migration.ts` | Observed: old agent migration filters review models; current startup only seeds session/coordinator defaults and a review work policy, not `seedReviewRules`. | Do not mistake legacy seed code for the current startup path. Old upgrades and fresh installs must both work without a reviewer. |
| `apps/server/src/db/schema.ts`, `apps/server/drizzle/0044_merge_gate_tables.sql` | Observed: `gate_digest`, `gate_round`, `gate_verdict` and `gate_state` are persisted. Verdicts also feed reports and verification indicators. | Stop live readers/writers before retiring contracts. Retain historical data and immutable applied migrations; do not drop user history. |
| `apps/server/src/services/{verified,correction,chief-report,retry-lessons,pr-watch}.ts` | Observed: these are secondary gate-state/verdict consumers. | Preserve honest historical reporting and correction behavior without treating old verdicts as authority. |
| `apps/server/src/routes-builds.ts`, `apps/web/src/api/hooks.ts`, `board/accept-task-dialog.tsx`, `detail/merge-gate.ts` | Observed: the gate endpoint affects the accept dialog's default merge selection. | Delete the completion dialog and merge choice rather than changing their defaults. Only an explicit conversational merge request reaches the existing merge service. |
| `apps/web/src/components/thread/{pr-card-model,pr-panel-model,pr-card,task-pr-line}.tsx` and corresponding `.ts` modules | Observed: no verdict maps to review-pending; stale/blocking verdicts and owner-route language appear in PR status and details. | Show GitHub state, CI and changes, not a compulsory agent-review lifecycle. |
| `README.md`, `README.zh.md`, `site/src/components/copy.ts`, both locales of `site/src/content/docs/*/docs/{intro,first-task}.mdx` | Observed: public introduction and first-task guidance promise a merge gate. | Describe completed work and retained branches or PRs, without asking for a merge decision. |
| `docs/spec/{18-positioning-and-differentiation,28-bootstrap-closed-loop-self-authored-self-merged,29-evaluation-and-data-loop}.md` and merge-related design documents | Observed: current positioning, merge policy and eval dispatch describe the gate. | Supersede current product requirements. Mark historical rationale rather than rewriting historical claims as if the gate never existed. |

## Boundaries

- Observed: `packages/shared/merge-gate-paths.json` is shared with this repository's development merge tooling. Removing the product gate does not authorize removing this repository's CI or merge queue.
- Observed: `apps/daemon/src/merge-decision.ts` prevents dirty-worktree writes, base movement and patch drift; these are repository-integrity checks, not demands for an agent reviewer.
- Superseded: the initial proposal retained `review` as a user handoff. The owner explicitly rejected that handoff and its UI; successful code tasks instead become `done` immediately. Information reports retain acceptance.
- Inferred: old externally written `cairn/merge-gate` or `pacman/merge-gate` statuses cannot be erased by a local SQLite migration. The upgrade must explain any user-configured required status without silently changing branch protection or publishing a fake pass.

## Recommendation

Use the existing delivery and human merge paths. Remove the automatic agent-review lifecycle and readiness authority, keep historical records, and keep low-level Git and GitHub write safety. The design is `docs/design/remove-product-merge-gate.md`.
