# Claude Code context limits in the Coordinator context ring

Status: reviewed (gpt-6.1-sol, read-only, two rounds: go after changes; all five findings are folded in below). Builds on PR #5169, which makes Claude Code Coordinator turns report `contextTokens`.

## Problem

The composer context ring reads `context` from `GET /api/teams/:id/chief` (`lastTurnContext` in `apps/server/src/services/coordinator-context.ts`). For a turn run on the Claude Code route (usage model `claude-code/<model>`) the server derives both limits from Cairn's own tables:

- `contextWindow`: `contextWindowOf` looks up provider `claude-code` in the team's `provider` rows and the pi catalog. Neither knows `claude-code`, so it falls back to `DEFAULT_CONTEXT_WINDOW` (200K).
- `compactAt`: `compactionWindow(contextWindow).backgroundAt`, the in-server pi runtime's background compaction point (150K on a 200K window; a smaller window keeps the old half-of-blocking start, `min(150K, max(blocking − 32768, blocking/2))`).

Worker Pi threads (the context ring on a todo) do not follow the Coordinator's policy: a worker session compacts when usage crosses `contextWindow - reserveTokens` (`shouldCompact` in pi-coding-agent 1.5.0 `dist/core/compaction/compaction.js`; reserveTokens 16384 by default), so the todo payload's fallback `compactAt` is `compactionWindow(contextWindow).blockingAt`.

Claude Code compacts by its own rules. Probed on the deployment host with the installed SDK (0.3.278, `query().getContextUsage({ detail: 'summary' })`, no prompt sent) for `claude-sonnet-5-5` and `claude-opus-5-5`: `rawMaxTokens` 200000, `autoCompactThreshold` 167000, `isAutoCompactEnabled` true, an `Autocompact buffer` row of 33000. So the fallback tooltip would say `Compacts at 150K` where the CLI compacts at 167K, and the 200K window is right only because the fallback happens to match. The window and threshold depend on the CLI version, model, plan and settings (`autoCompactWindow`, auto-compact off; the SDK documents a 200K compaction window on 1M-window models), so the server cannot compute them.

## Decision

The daemon reports, best-effort, the limits Claude Code itself uses for the model that produced the turn's context count. The server stores tokens and limits as one snapshot on the turn usage row and prefers the stored limits. A Claude Code row without a stored threshold shows no compaction line instead of Cairn's.

Rejected: only suppressing the compaction line server-side for `claude-code/` rows. It needs no migration and removes the wrong number, but leaves the window a guess and never shows the real threshold.

## Source of the limits (daemon, `apps/daemon/src/backend/claude-code.ts`)

1. After the session's `system/init` message (new and resumed sessions alike), the session handle calls `this.q.getContextUsage({ detail: 'summary' })` once and does not await it in the pump. `summary` answers from local state with no token-count API calls (SDK doc comment), so it costs no model request. A rejection is caught and ignored.
2. On a reply with positive integer `rawMaxTokens`, it sets `state.contextLimits = { model: reply.model, window: rawMaxTokens, compactAt }`, where `compactAt` is `autoCompactThreshold` only when `isAutoCompactEnabled` is true and the threshold is a positive integer. `rawMaxTokens` is the window usage is measured against (`SDKContextUsage.raw_max_tokens`), which can be smaller than the model's hard limit; that is the window the ring should fill against.
3. At `result`, for the usage row that carries `contextTokens` (the row matched in #5169, whose context model is `state.lastContext.model`):
   - if `state.contextLimits` is set and its `model` equals the context model, the row carries `contextWindow = window` and, when present, `compactAt`;
   - otherwise the row carries `contextWindow` from `result.modelUsage[<context model>].contextWindow` when it is a positive integer, and no `compactAt`.
   Other rows (subagent or fallback models) carry neither.
4. The limits are best-effort: the pump never waits for the reply, so a reply that arrives after `result` is dropped for that turn. In practice the reply lands within milliseconds of init and a turn's first model request takes seconds.

## Wire and storage

- `modelUsageSchema` (`packages/shared/src/agent-backend.ts`): add `contextWindow` and `compactAt`, both `z.number().int().positive().optional()`. The schema is not strict: an old server strips them, an old daemon omits them.
- `chief_turn_usage`: add nullable integer columns `contextWindow` and `compactAt` (one drizzle migration, no backfill).
- `ContextBearingTurnUsage` and `lastContextBearingTurnUsageWhere` select and return the two columns. `lastTurnContext`'s local return type makes `compactAt` optional; the envelope's shared schema already has it optional and the web omits the line when absent (`contextMeterLines`).

## Every path that reads or writes the new state

| # | Path | Behavior |
|---|---|---|
| W1 | `recordStepUsage` insert (`coordinator-steps.ts`) | writes `contextTokens`, `contextWindow`, `compactAt` from the row, nulls when absent |
| W2 | `recordStepUsage` upsert on `(stepId, model)`, e.g. a reclaimed step reporting again | snapshot rule: when the incoming `contextTokens` is non-null, all three columns take the incoming values, nulls included; when it is null, all three keep the stored values |
| W3 | in-server pi runtime turns | never send limits; columns stay null |
| R1 | `lastContextBearingTurnUsageWhere` → `lastTurnContext` → envelope | window: stored `contextWindow`, else `contextWindowOf` (unchanged). compactAt: stored `compactAt`; else omitted for a `claude-code/` model; else `compactionWindow(window).backgroundAt` (unchanged) |
| R2 | `lastTurnUsageForColdResume`, cold-slim, `coordinator/index.ts` | receive the projection with the two extra fields and ignore them; behavior unchanged |
| R3 | in-server compaction trigger (`runtime/turn.ts`) | uses the catalog window of its own turn; unchanged, never sees Claude Code rows |
| R4 | web ring (`context-meter-ring.tsx`) | unchanged; fills by `tokens / contextWindow` and drops the second line when `compactAt` is absent |

## Failure behavior

- Control request rejects, never answers, answers after `result`, or answers with another shape (an older CLI or the fake's default reply): window from `modelUsage.contextWindow` (or the server fallback if that is missing too); no compaction line.
- The CLI replaces the model mid-session (`SDKModelRefusalFallbackMessage`): the reply's model no longer matches the context model, so the same fallback applies.
- Older Runner daemon (no new fields) with a new server: window falls back to 200K as today; compaction line omitted for `claude-code/` rows.
- New daemon with an old server: the server strips the fields and keeps showing its own threshold until it is upgraded. On this host server and daemon deploy together.
- Auto-compact disabled in the CLI: `compactAt` absent, no line; a later row with auto-compact disabled clears an earlier threshold (W2).
- Thread switches between routes: the envelope reads the latest context-bearing row only, so the limits always belong to the model that produced the token count.

## Tests (one per row or case)

- Daemon mapper: limits set for the context model → the `contextTokens` row carries both and a subagent row carries neither; limits for a different model → window from `modelUsage`, no `compactAt`; limits unset → same fallback; auto-compact off → no `compactAt`.
- Daemon session (fake `Query`), for a new session and for a resumed one (init after `--resume`) each: a matching reply before `result` → measured window and threshold on the row; a reply after `result`, a reply that never comes, and a rejected reply → the turn completes with the fallback and the pump never waits.
- Server: insert stores the columns (W1); upsert replaces all three when new tokens arrive, including enabled → disabled and measured → unavailable, and keeps them when the new row has no tokens (W2); `lastTurnContext` prefers stored values, omits `compactAt` for a `claude-code/` row without one, keeps pi rows unchanged (R1); cold-resume output unchanged (R2).
- Integration (`coordinator-claude-code-e2e.test.ts`): the fake CLI answers `get_context_usage` with 200000 / 167000 and emits its assistant and `result` messages only after it has written that reply, so the reply-before-result order is exercised deliberately; the envelope returns `contextWindow: 200000, compactAt: 167000`.

## Not in scope

Showing the CLI's per-category breakdown (`/context`), a ring for Claude Code task sessions, and changing the in-server runtime's compaction.
