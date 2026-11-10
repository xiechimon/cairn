# Coordinator steer consumption and durable receipts

Date: 2026-11-10. Scope: #3857 under #3843. Implementation baseline: `8fea96eac6bd131d1880038496482c7ab0bba02a`. Research only; no product changes or upstream tests were run.

## Recon and evidence boundary

Measured means source or official documentation read in this investigation, not a claim that the external runtime was exercised. Inferred identifies recommendations derived from those reads. External material was fetched through agent-reach's documented GitHub/gh and webpage/Jina channels. The selected designated-source row is agent runtime; every designated source appears below. No UI pattern is borrowed.

Measured: the worktree lockfile pins `@earendil-works/pi-agent-core` and `pi-coding-agent` to 1.4.0 and `pi-durable` to 1.5.0. Installed package code was inspected in the main checkout because the new worktree initially had no dependencies. These package versions match; their transitive dependency versions need not be identical. The installed artifacts are evidence of package behavior, not a test of a complete production invocation.

## Prior-art comparison

| Source | Measured mechanism | Limits and trade-offs |
| --- | --- | --- |
| [Claude Code interactive mode](https://code.claude.com/docs/en/interactive-mode#when-claude-code-sends-what-you-queued) | Documentation says messages queued during tools are passed after those tools finish, within the same turn; remaining queued messages run in input order when the turn ends. An attached IDE selection is captured when the message is queued. | Documents queue timing and a frozen input snapshot, not a durable consumption receipt or idempotency protocol. |
| [Anthropic tool-use overview](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview) and [context editing](https://platform.claude.com/docs/en/build-with-claude/context-editing) | Client tools are run by the application, which returns results in subsequent model input. Context editing curates the conversation supplied to the model. SDK compaction may remove a pending tool-use block and cause the model to issue it again after summarization. | These APIs do not supply Cairn's host-level message-consumption acknowledgment. Inferred: model output and queue admission cannot substitute for application-owned delivery identity or side-effect deduplication. |
| [OpenAI Codex source, pinned head](https://github.com/openai/codex/tree/36e074a2fb365aa788886495c82e6ea612226cd9) | The steer integration test targets an expected turn, carries `client_user_message_id`, returns the accepted turn ID, and observes a user-message item with the same client ID. Persistence tests distinguish input admission, checkpoint policy, current inference completion, and the next request. They assert the first model request excludes later steered input while the next request includes it. | Source/tests read, not executed. User input can overlap background checkpointing under one policy; this is not a blanket exactly-once or synchronous durability guarantee. |
| Installed `@earendil-works/pi-agent-core` / `pi-coding-agent` 1.4.0 | `AgentSession.steer()` queues input. The coding-agent queue removes a pending steer when its user `message_start` arrives. The core loop drains steering before the next model call, including after preparation. | Its `steer()` promise proves admission into a queue, not consumption. Matching display queue entries by text is insufficient as a cross-process deduplication key. |
| Installed `@earendil-works/pi-durable` 1.5.0 | A conversation-scoped `requestId` returns the existing submission on retry. Admission creates a durable submission; a boundary places selected inbox inputs as transcript entries, records submission-to-entry links, and removes selected inbox positions in one transaction. Submission states distinguish queued, placed, done, and unanswered. Opening reconciles surviving running tasks to pending. | Fits persistent input delivery. `Submission.wait()` waits for done/unanswered, not placement. Placement means entered the run's model context; it does not prove semantic understanding or completed work. |
| [Amp manual](https://ampcode.com/manual), resolving to [Amp docs](https://ampcode.com/docs), and [CLI guide](https://ampcode.com/docs/cli) | Documentation describes persistent/shareable threads across clients and local/orb/runner execution surfaces. | These retrieved pages do not specify a consumption receipt, request-id deduplication, or crash-window guarantee. Do not infer one. |
| Cairn current implementation | [`fetchSteer`](../../apps/server/src/services/machines.ts) removes pending content on fetch; [`takeChiefSteer`](../../apps/server/src/services/chief-turns.ts) adds waiting owners to the running step before actual runtime consumption. The daemon awaits the backend's enqueue-style `steer()` and acknowledges it. | Inferred: lost responses, enqueue-only success, acknowledgment loss, and process exit can be confused with consumption. A mutable running-step owner set is not the input boundary of every answer already produced. |
| Cairn candidate | Inferred: immutable identified batches, request-keyed durable admission, exact input-entry placement receipts, idempotent acknowledgment of named batches, and entry-ordered provenance. | Requires a single ordered path between runtime placement, host mapping persistence, transcript mirroring, and tools that resolve provenance. It should not add a second delivery mode. |

Codex evidence: [turn_steer.rs](https://github.com/openai/codex/blob/36e074a2fb365aa788886495c82e6ea612226cd9/codex-rs/app-server/tests/suite/v2/turn_steer.rs), especially `turn_steer_returns_active_turn_id`; [pending_input_persistence.rs](https://github.com/openai/codex/blob/36e074a2fb365aa788886495c82e6ea612226cd9/codex-rs/core/tests/suite/pending_input_persistence.rs), especially `steered_input_checkpoint_controls_next_request` and `steer_during_final_flush_reaches_the_model_before_turn_completion`.

Installed evidence paths, relative to each package root under the main checkout's `node_modules/.pnpm`:

- `pi-coding-agent` 1.4.0: `dist/core/agent-session.js`, lines 729–746 and 1769–1806.
- `pi-agent-core` 1.4.0: `dist/agent-loop.js`, steering collection before requests and after tool execution.
- `pi-durable` 1.5.0: `dist/harness/inbox.js`, `prepareBoundary` and `applyBoundary`; `dist/harness/submissions.js`, `admitSubmission` and `isSettled`; `dist/harness/harness.js`, `openTasks`; `dist/harness/generation.js`, input settlement at run completion.

## Exact installed pi-durable API

Measured from `dist/harness/types.d.ts`, `dist/types.d.ts`, and their implementations:

```ts
Conversation.submit(draft: SubmissionDraft, context: Context): Promise<Submission>;
Conversation.submit(tx: Tx, draft: SubmissionDraft): Promise<SubmissionId>;

interface Submission {
  readonly id: SubmissionId;
  status(context: Context): Promise<SubmissionRecord>;
  wait(context: Context): Promise<SettledSubmissionRecord>;
  abort(context: Context): Promise<'aborted' | 'already_placed' | 'settled'>;
}

Harness.submission(id: SubmissionId, context: Context): Promise<Submission | undefined>;
Tx.submissionByRequest(conversationId: ConversationId, requestId: string): Promise<SubmissionRecord | undefined>;
Session.observeCommits(observer: CommitObserver): CommitObservation;
```

Measured: `SubmissionDraft` accepts `requestId?: string`; input drafts accept `whenBusy?: 'steer' | 'followUp' | 'reject'`, `whenIdle?: 'reject'`, and an application-owned `entry?: { kind: string; data?: JsonValue }`. `kind` must not start with `pi.`. An input record is queued without an entry; placed with `entry: EntryId`; done with `entry` and `answer`; or unanswered with an optional entry and a reason. Recovery can repeat `submit()` with the same request ID, reacquire a stored submission ID through `Harness.submission()`, or read `Tx.submissionByRequest()` inside a harness commit. The similarly named three-argument `Storage.submissionByRequest()` belongs to Storage, not Harness; do not call it on Harness.

Measured: there is no public wait-for-placement method on `Submission`. `wait()` resolves only for done/unanswered; waiting for it delays provenance until an answer or terminal failure. A host needing earlier consumption observes a stored commit whose change is `type: 'submission'` and whose input record has an `entry`. The first such normal transition is placed. The boundary stores the input entry and placement link together.

Measured: `observeCommits` publishes stored changes in line order; `advance(publication, context)` runs synchronously and must not block or call Session APIs. Publication change order inside one commit is unspecified. Attaching has no initial snapshot. Thus an adapter must attach before admission, read/reconcile existing records for recovery, and process all placement records in a publication before allowing dependent transcript work. A check-then-subscribe arrangement can miss a placement.

Inferred: enqueue placement persistence and transcript mirroring on one ordered host pipeline. The host's owner-to-entry mapping must commit before an answer can be mirrored or used for task dispatch. An asynchronously detached listener is insufficient. If the adapter cannot guarantee this ordering through its existing commit/mirror seam, expose the placement boundary there rather than pretending `wait()` or `steer()` already supplies it.

## Recommended single path

Inferred from the comparison:

1. Freeze batch identity and its exact message members before delivery. Retain the batch while delivery is unconfirmed. A later arrival belongs to a later batch.
2. Use a stable conversation-scoped request key for durable admission. A retry must recover the same submission, not append duplicate input.
3. At actual input placement, persist the batch's owner-message-to-conversation-entry mapping. Keep placement distinct from admission and final answer settlement.
4. Acknowledge that exact batch idempotently after its receipt exists. Retrying the acknowledgment must neither re-inject text nor acknowledge a newer batch.
5. Recover the same batch/submission after process or network failure. Reconcile runtime placement with the host receipt before replay; when placement is unknown, do not claim exactly-once delivery.
6. Resolve an answer's owner context using its immutable transcript position and earlier placed input entries. Preserve the existing [`task-reply-context.ts`](../../apps/server/src/services/task-reply-context.ts) entry-order filter. Never retroactively assign later inputs to an earlier answer by reading the running step's final owner set.

Implementation seams: `apps/server/src/services/chief-turns.ts`, `machines.ts`, `task-reply-context.ts`, Coordinator runtime submission/commit observers and mirroring, `apps/daemon/src/machine-loop.ts`, relevant backend bridges, and shared machine protocol schemas. Read the complete current files and consumers before editing; these are investigation targets, not approval to expand scope.

## Red-first acceptance cases

Inferred necessary negative controls: fetch response lost; process death before runtime admission; admission succeeds but consumption has not happened; consumption succeeds and acknowledgment is lost; identical retry after restart; a second steer arrives while the first batch is in flight; the original answer is emitted before the steer is consumed; a tool dispatches from the first post-consumption answer before final run settlement; a placed input ends unanswered; delayed receipt arrives for a stale step. Assert exact batch membership, stable submission identity, absence of duplicate model input, durable entry mapping, and ordering of mapping before mirror/dispatch. A passing enqueue promise alone cannot pass these cases.
