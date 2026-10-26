# trajectoryPack field sources

One pack corresponds to build.id. This file defines the contract only; it does not add collectors or database columns. Per this task's rule against adding code comments, the field-source records live here.

- buildId: build.id.
- input.spec / sourceRef: todo.spec / todo.sourceRef, joined via build.todoId. The run input must be saved at collection time; a task edited later must not serve as the historical snapshot.
- input.baseSha: the Git SHA of the run's starting point. The existing build / step tables have no corresponding column; it must be collected and saved later; the close-out checkpointCommit must not be passed off as it.
- input.persona / agentId / model: agent.persona / agent.id / agent.provider + agent.modelId; they must be snapshotted at dispatch time; a degraded model goes by the run's facts, and the current config must not be read after the fact to impersonate them.
- input.skillInjection: step.skillInjection, null means not computed, hits=[] means zero hits. When a multi-step change occurs, input saves the starting injection snapshot.
- input.harnessHash: a digest of the runtime harness contents; there is no corresponding database column today, to be collected later; it describes only the prompts, skills, tool descriptions, context assembly and routing, and does not involve model weights.
- process.steps[].stepId / kind / checkpointCommit: step.id / kind / checkpointCommit.
- process.steps[].transcript: message.role / content plus the extended fields in the upload records, including stopReason, usage and tool calls. The existing message table has no stepId column, and receiveUpload saves only role / content / createdAt, not the top-level stopReason / usage; the per-step attribution and these extended facts must be saved by the collector from the raw upload records, and cannot be reconstructed from the message table alone or guessed from conversationId.
- process.plans: plan.id / buildId / version / createdAt / content, keeping every version.
- process.token_usage: the full token_usage rows, joined by buildId.
- judgments.plan / diff: the confirm, reject and restart actions and their feedback. The existing message.content declarations and step.prompt allow retrospective lookup, but there is no independent, complete structured verdict column; the future collector must record the actions and reasons, with null for a missing reason.
- judgments.gate_verdict: the full gate_verdict rows, joined by buildId.
- judgments.ciFixRounds: counted by the [ci-fix] header marker on step.prompt, consistent with the round counting in services/ci-loop.ts.
- outcome.merged (#1659): taken from the most recent delivery record in the build's session. The completion row (services/delivery-rows.ts's DONE_ROW) is true, a PR closed without merging is false, and null when neither exists. Reads in-DB data only, does not call GitHub.
- outcome.revertedWithin7d (#1659): when merged=true, true if a later build of the same ticket whose first-step prompt starts with [revert] appears within 7 days after the merge. False when the window has elapsed with no such marker; null when the export moment is earlier than the window's end, and the export summary counts revert_window_open. null when merged is not true.
- outcome.fixedByLaterPr (#1659): when merged=true, true if a later build of the same ticket after the merge carries a PR number and is not a rollback. False when there is no such signal and the window has elapsed; null when the window has not elapsed. A CI-fix ticket is a GitHub issue, not in the DB, and a ci-fix green event occurs before the merge — neither counts as a signal.
- outcome.costTotal: token_usage.costTotal summed by buildId, in USD; null when bookkeeping is incomplete.

The outcome block must exist and may be null as a whole; once backfilling starts, its individual fields may also be null. All other fields must exist; only fields explicitly declared nullable may be null. An empty array means "collected, no records", not a missing field.
