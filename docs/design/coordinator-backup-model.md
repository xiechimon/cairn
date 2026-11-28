# Coordinator backup model — plan, 2026-11-29 (local date; 2026-11-28 in UTC)

## User scenario

Newcomer first: someone who installed Cairn today, connected one provider with an API key and picked the Coordinator's model in Settings → Models. One morning that key is revoked, the subscription is out of quota, or the provider is down. Today the Coordinator answers nothing: the thread shows an error row for the turn (an unfinished-turn row that names the model and offers to fix the API key) and the message waits until they fix the account or hand-pick another model in Settings. Even when they had already connected a second provider — which Cairn already uses as the backup for tasks — the Coordinator does not use it, because only imported routing rules ever carry a backup chain and the settings page offers no way to add one.

After this change that same turn runs on the next model the user has connected, and the thread shows one quiet divider line: "Main model doubao person-deepseek-v4-1-flash failed to authenticate, so this turn uses anthropic-ultra claude-opus-5-5". The next message tries the main model again; when it answers, one line says the main model is back. The user should know before this happens that the backup is a model they connected too, so the turn's text goes to that vendor and is billed there, possibly a different price and a smaller model than the one they picked; the line says which model answered, and removing that provider or giving the Coordinator an explicit backup list in its routing rule changes it back. They should also know that with a second model connected, a quota-blocked Coordinator turn no longer waits behind the Coordinator unavailable banner: it answers on the backup at that vendor's price instead. No new setting, no key, no new storage. A user with a single connected model sees exactly what they see today.

## Scope

1. A Coordinator turn (home thread or project thread) whose main model fails with a provider error (quota used up, auth failed, provider outage, model gone, network, per-model capacity) and that has no explicit backup list runs on the next connected model instead of ending; the pin lasts that turn only. The list is derived once by `withBackupChain` (`apps/server/src/services/model-fallback.ts`), used by `requeueChiefStepOnFallback` (`apps/server/src/services/agent-turn-kernel.ts`) and by the claim path in `machine-claim.ts`, and walked by `planModelFallback`.
2. The derived list is the user's connected sources in the provider order they already have: the main provider's other tiers first, then each other provider's standard tier and then its other tiers — the same `tierFallbackChain` order task routing uses. When the main provider is not among the connected sources at all, every model of every connected source stays a candidate. It may include a Claude Code, Antigravity, Devin or Doubao subscription when that is what the user connected; the turn then runs on a machine that has that runtime.
3. An explicit `fallbackModels` list on the Coordinator route wins, and an explicit empty list means no backup; `routeProfile` passes it through unchanged and `withBackupChain` only derives a list when it is `null`.
4. Provider-wide failures (quota, auth, provider outage) skip a sibling model of the failed provider, so a revoked key does not burn a turn on another model of the same provider; a per-model capacity limit may use a sibling first. Quota counts as provider-wide whether it comes from a quota block or from the error text. The same rule applies to task steps that already carry a fallback list.
5. The thread shows one divider line naming the main model, the failure class and the backup model. The 15-minute quiet rule and the "main model is back" line are unchanged. The row carries `reason`; `apps/web/src/api/mappers.ts` turns it into a translatable sentence, `apps/web/src/i18n/en.ts` holds the English copy, and `apps/web/src/chief/chief-message-rows.tsx` renders it as the existing separator line.
6. Rows written before this change (no `reason` field) keep the old "temporarily unavailable" sentence.
7. Unchanged: the Coordinator model setting, project model overrides, provider and subscription settings, the waiting banner when no backup is available, stall recovery, and task-step routing.

## Where it lives

- Writers: `requeueChiefStepOnFallback` writes the `chief-fallback-*` row (`from`, `to`, `reason`, `announced`) and `requeueTurnStep` pins the step's `fallback`; `chief-model-switch.ts` keeps the quiet window and writes the `chief-model-restored-*` row.
- Readers: `apps/web/src/api/mappers.ts` maps the row to a note item, `chief-message-rows.tsx` renders the note, `chiefThreadFallbackModel` feeds the live fallback banner, and `models.ts` runs the turn on the pinned model.

## Edge cases

| Edge case | What the user sees | Proving test | Slice/Status |
|---|---|---|---|
| Main model auth fails and another connected model exists | The same turn is retried on the backup; one divider line names the main model, the reason (authentication failed) and the backup model | `apps/server/test/coordinator-backup-model.test.ts` | this change |
| Provider-wide failure while several models of the same provider are connected | No sibling retry; the line names the other provider's model, and only one line appears for the turn | `apps/server/test/coordinator-backup-model.test.ts` | this change |
| Per-model capacity failure (429 on one model) | A sibling model of the same provider may answer first, still with one line | `apps/server/test/coordinator-backup-model.test.ts` | this change |
| The user has only one connected model | Today's error row for the turn with its "fix the API key" action; the message is kept; no divider line | `apps/server/test/coordinator-backup-model.test.ts` | this change |
| Every backup is rejected (model dead, provider circuit open, or no host can run it) | Same as above: the existing error row, no divider line | `apps/server/test/coordinator-backup-model.test.ts` | this change |
| The route carries an explicit empty backup list and another provider is connected | Same as above: no backup, no divider line | `apps/server/test/coordinator-backup-model.test.ts` | this change |
| The backup model fails too | The next candidate answers the same turn; when none is left the turn ends with the existing error row | `apps/server/test/coordinator-backup-model.test.ts` | this change |
| Backup answered, the next turn's main model works | One "main model is back" line, then the reply from the main model | `apps/server/test/coordinator-backup-model.test.ts` | this change |
| Several failed turns inside 15 minutes, or the same backup again | At most one divider line per switch; no repeating line | `apps/server/test/coordinator-backup-model.test.ts` | this change |
| A project thread's main model fails | The backup answers inside that project and the line carries the project's scope | `apps/server/test/coordinator-backup-model.test.ts` | this change |
| A configured task step whose fallback list starts with a sibling of the failed provider, failing auth or outage | The task is retried on the other provider, not the sibling (proves the selection rule the done path calls) | `apps/server/test/coordinator-backup-model.test.ts` | this change |
| A configured task step with a sibling fallback and a per-model capacity failure | The task is retried on the sibling (proves the selection rule the done path calls) | `apps/server/test/coordinator-backup-model.test.ts` | this change |
| A task step's quota failure is read from the error text, not from a quota block | The sibling of the failed provider is skipped, as for the account quota case | `apps/server/test/coordinator-backup-model.test.ts` | this change |
| A task step's quota block reports capacity instead of quota | The sibling model is used first | `apps/server/test/coordinator-backup-model.test.ts` | this change |
| The main provider is deleted, has no key, or its subscription stopped working, so it is not among the connected sources | The other connected providers are all candidates; the main provider's absence does not drop the first backup | `apps/server/test/coordinator-backup-model.test.ts` | this change |
| The pinned backup cannot run on any online host when the step is claimed | The claim walks the same backup list for another candidate; when none can run, the turn waits as today. The explicit-list advance is tested; a derived-list advance is not yet | `apps/server/test/chief-queue-steer-stop.test.ts` | later: derived-chain claim advance |
| Thread rows written before this change carry no reason | The generic "temporarily unavailable, this turn uses Y" line, no crash; this is a forward-compatibility guard, so it also passes on the parent | `apps/web/e2e/chief-home-busy.spec.ts` | this change |
| English locale and an `auth` reason | The English sentence names the main model, the reason and the backup | `apps/web/e2e/chief-home-busy.spec.ts` | this change |
| A stalled Coordinator turn diagnosed as quota (no provider error response) | The stalled turn moves to another connected model with a fresh session; when the route carries its own empty backup list it keeps parking and waiting | `apps/server/test/stall-monitor.test.ts` | this change |
| The backup needs another runtime (Claude Code, Antigravity, Devin, Doubao) | Runs on a machine that has it; when none can run it, the claim waits or fails as today | `apps/server/test/chief-queue-steer-stop.test.ts` | later: coordinator on a subscription fallback runtime |

## Out of scope

- A settings control to edit the backup chain by hand; the derived chain is the only default path for now.
- Task-step routing changes beyond the provider-wide skip (C1 on the dogfood checklist owns task quota hand-off).
- Stall recovery for the Coordinator (a stalled turn, not a provider error) keeps its current path.
- Changing the waiting banner copy or its retry timing.
- Raw provider error text in the thread; the line names the failure class only.
- A user with no connected model at all (first-run setup already asks for one).

## Review

- Verdict: CONCERNS
- Plan-SHA256: 5c66a17e0b484d06369fffaaa42b733a9d5b6424054e932fa976494971a4ddc1
- Author-Model: deepseek-v4.1-flash
- Reviewer: pi-review.sh plan (Opus 5.5), one full review
- Reviewer-Model: anthropic/claude-opus-5-5
- Findings: 9 should-fix, 2 notes. (1) `providerWide` also changes task steps, contradicting scope 5 with no row or test — fixed: scope 4 names it and two task-path tests prove it. (2) The single-model row promised a waiting banner while the test asserts the error row — fixed: row 4 now says the existing error row. (3) The explicit empty list had no row or test — fixed: row 6 and its test. (4) `stall-monitor` bypasses the derived chain — fixed: marked `later: coordinator stall recovery`. (5) The derived chain can pick a subscription runtime or a weaker tier with no row — fixed: scope 2 names the runtimes and the tier order. (6) The user scenario never said the conversation goes to another vendor at another price — fixed: the scenario now says it. (7) English copy was unasserted — fixed: the English e2e row and test. (8) The old-row e2e test passes on the parent — fixed: the row now says it is a compatibility guard. (9) The Review block claimed PASS before any review — fixed: this block records the real verdict and hash. (10) No row for project threads or for every candidate filtered out — fixed: two rows and their tests. (11) No files, readers or writers named — fixed: the "Where it lives" section.
- Fix-check: PASS
- Fix-check-Plan-SHA256: fbc2f3bca89c41432c8d45c31a531593529da1c23926f8b4c8958b6674e01cbd
- Later body edits after the second confirmation: the Chinese examples were replaced with English wording, and the stall and claim rows were reworded to match the code confirmed by the head review. No new plan finding is implied.
- Body edits after the second confirmation were language only: the Chinese example sentences in the scenario and the edge rows were replaced with their English wording, so the findings above still stand.
