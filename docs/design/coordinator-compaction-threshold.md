# Coordinator compaction threshold

Problem: a Coordinator thread on Claude Code compacted at about 967K tokens,
the bundled CLI's default for a 1M model, while the in-server runtime compacts
at 150K. Quality and cost degrade long before 967K. Research:
`docs/research/coordinator-compaction-threshold-2026-11-22.md`.

Decision: one product number, `COORDINATOR_COMPACT_AT` (150K, in
`packages/shared/src/agent-backend.ts`), applied by every Coordinator runtime,
and the context meter shows the number the runtime reports.

## Per runtime

| Runtime | How it is told | What the meter shows |
|---|---|---|
| In-server (pi-durable) | `compactionWindow()` keeps `min(150K, max(blocking − 32768, blocking/2))` | `compactionWindow(window).backgroundAt` |
| Claude Code | `CLAUDE_CODE_AUTO_COMPACT_WINDOW = compactAt + 33000` in the SDK `settings.env`; the CLI then reports `autoCompactThreshold` 150000 | `getContextUsage()` threshold and window, read after each turn |
| Gemini CLI | `GEMINI_CLI_SYSTEM_SETTINGS_PATH` points at `<GEMINI_CLI_HOME>/.gemini/cairn-system/compress-*.json` holding `model.compressionThreshold = compactAt / tokenLimit(model)` | nothing: Gemini reports no usage over ACP |
| Devin, Antigravity | not tellable; the server starts a new session at claim time when the thread's last turn reported `contextTokens >= COORDINATOR_COMPACT_AT` | `usage_update.used` as context tokens, `compactAt` 150K |

`compactionWindow()` returns `backgroundAt = min(COORDINATOR_COMPACT_AT, max(blocking − MIN_COMPACTION_MARGIN_TOKENS, blocking/2))` (`MIN_COMPACTION_MARGIN_TOKENS` = 32768, taken from pi-durable 1.5.0's `DEFAULT_COMPACTION_POLICY.backgroundTokens`): every window that fits 150K with that margin below the blocking point compacts at exactly 150K; on smaller windows the half value applies only when it wins the max (180K gives 130,848, not the old 81,808), so it never compacts every turn. The 32768 margin is the room pi-durable itself leaves between the background trigger and the blocking threshold.

`compactAt` reaches a backend only on Coordinator sessions
(`composeStepSessionOpts`, `isChief`); worker steps keep each runtime's default.

## Session rotation (Devin, Antigravity)

State: the thread's newest context-bearing `chief_turn_usage` row, written by
the finish path from the daemon's usage events. Read only by
`rotatesPastCompaction` in `apps/server/src/services/coordinator-context.ts`,
called from the chief claim in `machine-claim.ts`.

Transition: at claim, a thread on `devin` or `antigravity` whose last turn
held at least 150K tokens gets `session.action = 'new'`. The new session
receives the recent conversation through the existing `chief.history`
payload (`chiefHistoryFor`). Its first turn reports a small context, so the
next claim continues that session.

Failure behavior: a turn that reported no usage leaves the previous row as
the newest, so rotation follows the last measured size; a runtime that never
reports usage never rotates and compacts at its own default.

## Tests

- `apps/daemon/test/claude-coordinator-compaction.test.ts`: the bundled CLI
  reports threshold 150000 for a Coordinator session (red: 967000).
- `apps/daemon/test/acp-stdio.test.ts`: a Coordinator Gemini session gets the
  system settings file with the right fraction for Gemini and Gemma.
- `apps/daemon/test/devin-acp.test.ts`: a Devin turn reports context tokens and
  `compactAt`.
- `apps/server/test/coordinator-devin-claim.test.ts`: under 150K continues,
  at 150K starts a new session with the recent conversation.
