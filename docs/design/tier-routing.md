# Automatic Tier Routing Across Model Sources — plan, 2026-11-28

- Owner approval (2026-11-28): `"如果用户接入了一个provider就自动从中抽2～3个作为简单/中等/复杂任务"` ("when a user connects a provider, automatically pick 2-3 of its models for simple/medium/complex tasks") and `"不应该让用户知道，让coordinator里自行挑选"` ("should not let the user know, let the Coordinator pick on its own").
- Prior art: [docs/research/tier-routing-2026-11-28.md](../research/tier-routing-2026-11-28.md).

## User scenario

A user who installed Cairn today connects any model source in Settings > Model (an API key provider such as Anthropic, OpenAI, OpenRouter, DeepSeek, or a custom relay, or a subscription runtime such as Claude Code, Antigravity, or Devin) and sends requests to the Coordinator in chat. Because Cairn keeps `routing_rule` (`use = 'session'`) synced with the Coordinator model via `taskRuleFollowsCoordinator` and exposes no per-difficulty settings, today every worker task runs on that single model regardless of complexity.

With this change, the user configures nothing and sees no new setting, mode picker, or tier label.

- **What they must already know**: nothing beyond connecting a model source and messaging the Coordinator.
- **Accounts, payments, and keys**: uses only the model source(s) and credentials the user already connected (`provider.apiKeyCipher` or existing Claude Code / Antigravity / Devin subscription connections). Adds no new accounts, billing, or database tables.
- **Storage**: reuses existing `provider`, `claude_subscription`, `antigravity_subscription`, `devin_subscription`, `routing_rule`, `team.providerOrder`, `todo.request`, `step.ranModel`, `step.fallback`, and `step_route`.
- **What they see**: each task row still shows the actual model that ran it (`step.ranModel`). Routine tasks (`easy`) run on a lighter/cheaper model from the active source, moderate tasks (`standard`) run on a balanced middle model, and hard tasks (`hard`) run on the source's flagship model. If the user explicitly picks a model for a task (`todo.request.model`), that pinned model always runs. If a source lacks differentiating metadata (e.g. opaque aliases with no price, context, reasoning, or size/class differences), Cairn preserves the configured default instead of guessing arbitrary tiers. When a tier model is rate-limited, over quota, dead, or unsupported on the available runner, Cairn falls back to the next nearest tier or another connected source and posts the existing fallback notice (`"已换备用模型"` / `Switched to fallback model`). If no runnable model remains anywhere, the step enters `waiting_quota`, waits for a compatible runner, or fails with a clear reason.

### Tier selection algorithm (zero hand-kept model list)

`selectSourceTiers(models, preferredDefaultId?)` in `packages/shared/src/tier-selection.ts` computes `{ easy, standard, hard, ordered }` purely from catalog metadata with zero hardcoded model IDs:

1. **Deduplicate and filter non-chat utility models**: deduplicate by `id`; drop non-chat/utility models (`isInternalAntigravityModelId(id)` or matching embedding/tts/whisper/moderation/rerank/dall-e/imagen/audio/speech/transcribe/orchestrator/auto/adaptive patterns). If zero chat models remain, return `null`.
2. **Exclude banned prefixes unconditionally**: filter out `BANNED_PREFIXES` (`packages/shared/src/capability-routing.ts`). If all remaining models are banned, return `null` so banned models are never chosen.
3. **Collapse version snapshots without erasing size differences**: compute `tierFamilyKey(id)` by normalizing trailing date stamps (`-20\d{6}`), `-latest`, and standalone version numbers while preserving parameter-size tokens (`7b`, `70b`, `8b`, `72b`, `1t`, `a3b`, etc.) so `acme-7b` and `acme-70b` stay distinct. Keep the newest version per `tierFamilyKey`.
4. **Filter short-context and clamp large-catalog free outliers**: exclude models with `contextWindow < 32_000` whenever any `>= 32_000` model exists (regardless of catalog size) so short-context models never get complex tasks. When more than 6 models remain, also exclude real zero-cost entries (`cost` defined with `input === 0 && output === 0`) if any paid model (`blendedCost > 0`) exists, keeping unpriced models (`cost === undefined`) distinct from `$0` free models.
5. **Require genuine capability signal before splitting tiers**: extract per-model signals (`blendedCost = input * 0.25 + output * 0.75`, `classSignal`, `paramSignal`, `reasoningSignal`, `contextSignal`, `versionSignal`; ignoring suffix thinking presets like `-medium`/`-high`). Check whether the remaining candidates have at least one differentiating non-version capability signal (distinct known pricing, distinct `reasoning`/`thinkingLevels`, distinct parameter count, distinct `contextWindow`, or non-zero `classSignal`). If **zero** differentiating signals exist (e.g. opaque aliases with identical/absent metadata), preserve the default (`preferredDefaultId` if present in filtered set, else `candidates[0].id`) for all three tiers instead of guessing by array order.
6. **Total-order scoring & picking when signal exists**:
   - If >= 80% of candidates (and >= 2) have pricing, sort primarily by `log10(blendedCost)` (placing any unpriced minority at `medianLogCost + classSignal * 0.4 + reasoningSignal * 0.3` and real `$0` models below paid models), breaking ties by `reasoningSignal`, `contextSignal`, `versionSignal`, and catalog index.
   - Otherwise (subscriptions or sparse-pricing relays), sort by `classSignal + paramSignal + reasoningSignal + priceHint + contextSignal + versionSignal`, breaking ties by catalog index.
   - From sorted `asc` (`N` models):
     - `N === 1`: all 3 tiers = `asc[0].id`.
     - `N === 2`: `easy = asc[0].id`, `hard = asc[1].id`, `standard = classSignal(asc[0]) < 0 ? asc[1].id : asc[0].id`.
     - `N >= 3`: for `N > 10`, `lowIdx = floor(N * 0.1)`, `highIdx = min(N - 1, floor(N * 0.9))`; else `lowIdx = 0`, `highIdx = N - 1`. `easy = asc[lowIdx]`, `hard = asc[highIdx]`. For `standard`, inspect strictly `asc[lowIdx + 1 .. highIdx - 1]`: if both endpoints have positive cost and any middle candidate has positive cost, pick the priced middle candidate closest to `(log10(easyCost) + log10(hardCost)) / 2`; otherwise pick `asc[floor((lowIdx + highIdx) / 2)]`.

### Where the Coordinator's difficulty judgment lives

- `COORDINATOR_SYSTEM_PROMPT` (`apps/server/src/services/chief.ts`) and `create_todo` / `update_todo` schemas (`packages/shared/src/protocol/chief-tools.ts`) instruct the Coordinator to evaluate task difficulty (`easy` | `standard` | `hard`) silently and pass `difficulty` on `create_todo` (and optionally `update_todo`), passing `model` only when the user explicitly requests a model and never mentioning tiers to the user.
- Direct Coordinator inline replies without `create_todo` create no task.
- Board tasks, GitHub-imported issues, and legacy tasks without `todo.request.difficulty` fall back to `classifyDifficulty` in `packages/shared/src/capability-routing.ts`. When `update_todo` updates unstarted segments (`addMessageIds` / `replaceMessageIds`) without an explicit `difficulty`, `updateRequestTodo` (`apps/server/src/services/coordinator-request.ts`) resets `request.difficulty = null` so `classifyDifficulty` re-evaluates from the updated text.

### State, transitions, readers, and writers

No new database tables or columns are introduced. `primarySource` is defined as `base.provider` from `ruleProfileForStep(db, todoRow, kind)` (`routing_rule(session)` if present, else `defaultSessionRule`); if `base.provider` is absent from `listConnectedTierSources` (deleted, disabled, or expired), `profileForStep` marks `switchedFrom` (`服务商不可用`) when falling back to a remaining connected source (`team.providerOrder` then deterministic runtime order).

**Precedence for worker steps (`isSessionStepKind`: `plan`, `build`, `session`, `verify`)**:
1. **In-flight continuity** (`step.status !== 'pending'` OR `step.sessionId !== null` OR `step.checkpointCommit !== null` when no `step.fallback.model` override is active): keeps recorded `step.ranModel` / `step_route` (`in-flight: keeps recorded model`).
2. **Active fallback target** (`step.fallback?.model != null`): uses `step.fallback.model` when still runnable on at least one eligible machine; if `routeIsReleasable` (`status === 'pending' && sessionId === null && checkpointCommit === null`) and `step.fallback.model` became unrunnable before claim, `claimStep` advances to the next runnable untried candidate in `agentRow.fallbackModels` / `decideStepRoute` excluding `step.fallback.tried`, updating `step.fallback` atomically at claim instead of wedging in `pending`.
3. **Explicit task pin** (`todo.request.model`): always runs the exact pinned model with zero tier downgrade; inherits only `rule.fallbackModels`.
4. **Source tier routing**: `decideStepRoute` picks the highest-ranked runnable tier in `primarySource` first (`tierFallbackOrder`), then `secondarySources`, and sets `fallbackModels = tierFallbackChain(...)`.
5. **Base rule fallback**: if no candidate is runnable on any machine (e.g. all runners offline or unkeyed), returns `base` with `tierFallbackChain` attached; `claimStep` leaves `pending` for offline/transient waits and fails with `unassignedStepReason` when no profile exists.

**State transition table**:

| Event / Transition | Atomic writer(s) | Readers | Wake / Session / Reset semantics |
|---|---|---|---|
| Task created or updated (`create_todo` / `update_todo`) | `coordinator-request.ts`, `todos.ts` | `classifyDifficulty`, `routing-rules.ts` | Stores `todo.request.difficulty` (`null` on text update unless set) and optional `todo.request.model`; `step.fallback` starts `null` |
| Source added, edited, renamed, or deleted | `providers.ts` (`renameProviderReferences` updates `routing_rule`, `project.modelOverrides`, `step_route.provider`, `step.fallback`, `step.ranModel.provider`), `*-subscriptions.ts` | `source-tiers.ts`, `builds.ts` (`stepQueueProjector`), `claude-rate-limit.ts` (`profileForStep`) | Pending unstarted steps re-evaluate dynamically on next projection and claim; `machineHub.wake` triggers claim |
| Claim pending worker step | `machine-claim.ts` (`step.status='claimed'`, `step.ranModel`, `step.fallback` on route switch or stale-fallback advance, `step_route` via `recordStepRoute`) | `builds.ts` (`listBuildStepRoutes`), `runtime-otel.ts`, `machine-finish-step.ts`, `machine-routing.ts` (`priorSessionOf`) | `recordStepRoute` receives `stepId = null` when `step.fallback.model` is active so `checkpointCommit` does not revert `step_route` back to the failed model |
| Worker `finishStep` fails with `quota` / `capacity` / `model_unavailable` / `provider_outage` / `auth` / `network` | `machine-finish-step.ts` (`planModelFallback` -> `requeueStep` sets `step.status='pending'`, `step.sessionId=null`, `step.fallback`) or falls through to `recoverClaudeRateLimitFailure` / `applyQuotaWaitStep` / `applyStepFailure` | `machine-claim.ts`, `quota-wait.ts`, `claude-rate-limit.ts` | On account-wide `quota`, `planModelFallback` jumps to next connected source; on `capacity`/429/`model_unavailable`, tries next tier on same provider first. Clears `sessionId` (new session on model change); `tried` accumulates per step until `waiting_quota` release or new step |
| Worker `finishStep` 0-token silent success (`isZeroUsageSilentSuccess`) | `machine-finish-step.ts` (`requeueStep` sets `model: stepRow.fallback?.model ?? stepRow.ranModel ?? null`, `zeroUsageRetried: true`, then `applyStepFailure` on 2nd strike) | `machine-claim.ts` | Guarantees retrying the exact model that returned 0 tokens even if catalog order changes |
| Stall monitor diagnoses `quota` before `finishStep` | `stall-monitor.ts` (`handleQuotaDiagnosis` -> `planModelFallback` / `requeueTurn`, or clears `ranModel` -> `applyQuotaWaitStep`) | `machine-claim.ts`, `quota-wait.ts` | Uses same `planModelFallback` chain; wakes on recovery |
| Quota wait probe / manual retry (`waiting_quota` -> `pending`) | `quota-wait.ts` (`sweepQuotaWaitSteps`, `retryQuotaWaitNow` set `status='pending'` and clear `step.fallback.model = null`, `step.fallback.tried = []` preserving `zeroUsageRetried`) | `machine-claim.ts`, `builds.ts` | Prevents stale `tried` from blocking recovered primary source when waking from exhaustion |

## Scope

1. Add `packages/shared/src/tier-selection.ts` (exported via `packages/shared/src/index.ts`) implementing metadata-driven `selectSourceTiers`, `tierFallbackOrder`, and `tierFamilyKey` with zero hand-kept model lists, unconditional `BANNED_PREFIXES` and `< 32_000` short-context filtering, and default preservation on zero-signal opaque catalogs.
2. Generalize `routeWork` in `packages/shared/src/capability-routing.ts` to select across caller-ordered `(provider, modelId)` tier+source candidates with `desired` and `fellBack` flags while preserving `BANNED_PREFIXES`, `classifyDifficulty`, and `inFlight` stickiness.
3. Add `catalogModelMetadata` in `apps/server/src/coordinator/runtime/provider.ts` and `apps/server/src/services/source-tiers.ts` (`listConnectedTierSources`, `tierFallbackChain`) covering API providers and subscription runtimes (`claude-code`, `antigravity`, `devin`).
4. Update `apps/server/src/services/step-route.ts`, `apps/server/src/services/routing-rules.ts`, and `apps/server/src/services/machine-claim.ts` so unpinned worker steps (`isSessionStepKind`: `plan`, `build`, `session`, `verify`) route by difficulty within `primarySource` first, advance past removed/dead `step.fallback.model` before claim, suppress `"已换备用模型"` on normal tier selection, and emit `"已换备用模型"` only on real fallback.
5. Update `apps/server/src/services/model-fallback.ts`, `apps/server/src/services/machine-finish-step.ts`, `apps/server/src/services/quota-wait.ts`, and `apps/server/src/services/providers.ts` so runtime failures walk `tierFallbackChain`, zero-usage retry pins `stepRow.ranModel`, `waiting_quota` release resets `tried`, and provider rename updates `step.ranModel.provider`.
6. Update `COORDINATOR_SYSTEM_PROMPT` (`apps/server/src/services/chief.ts`), `create_todo` / `update_todo` schemas (`packages/shared/src/protocol/chief-tools.ts`), and `updateRequestTodo` (`apps/server/src/services/coordinator-request.ts`) so the Coordinator silently passes `difficulty` and unstarted text edits refresh stale `difficulty`.
7. Keep unchanged: `coordinatorProfile`, `merge`, `review`, and `compaction` routing, `chief` / `review` fallback behavior, Settings UI (zero new controls), task row `step.ranModel` display, `routingRuleIssues`, and explicit `todo.request.model` pins.

## Edge cases

| Edge case | What the user sees | Proving test | Slice/Status |
|---|---|---|---|
| Empty, all-non-chat, or all-banned catalog | Source returns `null`; falls back to secondary source or fails unassigned when no source remains | `packages/shared/src/tier-selection.test.ts` ("empty, non-chat, and all-banned catalogs return null") and `apps/server/test/tier-routing.test.ts` ("empty or non-chat provider falls back to secondary source") | this change |
| Size-differentiated family (`acme-7b` vs `acme-70b`) and 3+ collapsing to 1–2 | Parameter sizes stay distinct (`easy` vs `hard`); collapsing version snapshots match 1-model or 2-model placement | `packages/shared/src/tier-selection.test.ts` ("preserves parameter size tokens across version dedup" and "3+ collapsing to 1 or 2") and `apps/server/test/tier-routing.test.ts` ("size-differentiated models pick distinct tiers") | this change |
| Short-context (`< 32k`) in 3-model catalog, `$0` vs unpriced, and zero-signal opaque relay | Short-context model is filtered out; `$0` free differs from unpriced; opaque zero-signal relay preserves rule default | `packages/shared/src/tier-selection.test.ts` ("short-context filtered even on 3 models", "unpriced vs zero-cost free", "zero-signal opaque relay preserves default") and `apps/server/test/tier-routing.test.ts` ("zero-signal custom relay keeps rule default") | this change |
| 1-model, 2-model, and 3+ sources (API, Antigravity, Claude Code, Devin) | 1 model runs all difficulties without fallback notice; 2 models split easy/hard without underpowering medium; 3+ pick 3 distinct tiers | `packages/shared/src/tier-selection.test.ts` ("1 model", "2 models", "3+ priced and subscription catalogs") and `apps/server/test/tier-routing.test.ts` ("one source with 1/2/many models across API, Antigravity, Claude Code, and Devin") | this change |
| Coordinator `difficulty` prompt, `update_todo` refresh, and board/GitHub/legacy tasks | `create_todo` `difficulty` drives `step.ranModel`; `update_todo` clears stale `difficulty`; board/legacy tasks use `classifyDifficulty`; inline reply creates no task | `apps/server/test/tier-routing.test.ts` ("Coordinator create_todo difficulty drives claimed ranModel", "update_todo refreshes stale difficulty and board tasks fall back to spec length") | this change |
| Two sources, primary removed/disabled, provider renamed, and pending reorder | Primary serves all tiers when healthy; secondary takes over with `"已换备用模型"` when primary is removed/disabled; provider rename updates `ranModel` and `step_route` | `packages/shared/src/capability-routing.test.ts` ("primary source serves all tiers when healthy and secondary takes over on outage") and `apps/server/test/tier-routing.test.ts` ("two sources failover, source removal, rename, and pending reorder") | this change |
| Pre-claim dead/quota, mid-step 429/quota/`model_unavailable`/auth/outage, stale `step.fallback.model`, quota recovery, and 0-usage retry | Retries next tier or secondary source with `"已换备用模型"` and new session; jumps provider on account quota; advances removed `step.fallback.model`; `waiting_quota` release clears `tried`; 0-usage pins `ranModel` | `apps/server/test/tier-routing.test.ts` ("mid-step 429/quota/outage/auth fallback", "stale fallback target advances on claim", "quota-wait release clears tried", "zero-usage silent retry pins ranModel") | this change |
| Old protocol runner, legacy sandbox, old Claude CLI, machine/MCP pin, and total exhaustion | Old-protocol runner does not claim; legacy sandbox / old Claude CLI skips incompatible models; machine/MCP pin filters hosts first; total exhaustion parks in `waiting_quota` or fails unassigned | `apps/server/test/tier-routing.test.ts` ("old runner protocol, legacy sandbox, old Claude CLI, capability pin, and total exhaustion") | this change |
| Explicit task pin (`todo.request.model`), `checkpointCommit` continuity, and `merge`/`review` unchanged | Task pin runs exact model regardless of difficulty; `checkpointCommit` / `sessionId` keeps recorded model; `merge` and `review` ignore tier routing | `apps/server/test/tier-routing.test.ts` ("explicit task model pin, checkpoint continuity, and merge/review unchanged") and `apps/server/test/model-route-silent-switch.test.ts` ("T1: explicitly pinned task model stays on Opus") | this change |

## Out of scope

- User-facing tier configuration UI, toggles, or optimization mode pickers in Settings > Model.
- Tiering Coordinator turns (`chief`), `review` steps, `compaction` steps, or `merge` steps.
- Mid-turn model switching inside an already active agent session.
- Learned or telemetry-based ML routing classifiers.

## Review

- Verdict: PASS
- Plan-SHA256: 63550d6afd69981d67ce7e8e5843d2deb1f28cf5107bc7703da6440fcd2fe81e
- Author-Model: gemini-4-neon
- Reviewer: pi-review (openai-codex/gpt-6.2-sol)
- Reviewer-Model: openai-codex/gpt-6.2-sol
- Findings: 0 open blocking; resolved all findings from initial plan review and confirm pass (tierFamilyKey size preservation, zero-signal default, unconditional BANNED_PREFIXES and short-context filter, quota-wait tried reset, zero-usage ranModel pin, update_todo difficulty refresh, stale fallback advance, provider rename ranModel sync, full state contract)
