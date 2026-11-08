# Retry-storm fix plan

## Overlap

1. Existing implementation issue #3423; read-only trace #3302 / task #122 is related, not an implementation.
2. Open matching PRs: none.
3. Recent merged #3083 supplies the citation attempt cap and parking mechanism. Extend it; do not replace it. #3164 and #3303 migrated citation routing to rules.
4. Open PRs touching builds, machine-finish-step, needs-you, runner, research-citations: none (2026-11-08 overlap lookup). Expanded lookup for the pi bridge, shared classifier and retry-parking module also found no open overlapping PR. #2864 is related citation-audit prior work, not this implementation. After opening #3431, the review expanded the file list to pr-wakes and pr-feedback; another overlap check found no other matching open PR or file overlap, so the same assigned branch and PR are extended.

## Evidence and assumptions

Read #122's local report. Its SDK explanation was explicitly inference. Current SDK source and runtime must be checked rather than assuming it retries every 404. Live database opened SQLite mode=ro. There are 2,644 matching build errors; largest citation groups contain 1,863, 615, 78 and 78. The two largest ended before #3083 merged. There are 23 matching records after merge time; merge time is not deployment time. The latest sampled failure already carries citation parking, so this is an incomplete cross-layer fix, not proof that the citation cap regressed.

Routing source: `routing_rule.use=citation_check`, `provider=relay-186`, `modelId=glm-5.3`; team configuration is left unchanged. Its `seededFromAgentId` joins a `legacy_agent_backup` row with the same provider and model. No row identifier is copied here. The migration seeds this rule from the old assigned checker (`apps/server/src/legacy/agent-layer/data-migration.ts`); `routeForStep` resolves it before the session rule (`apps/server/src/services/routing-rules.ts`). There is no hard-coded citation model to replace.

Rolling-hour non-model failed-build observations (requires an actual failed step): counts 1/2/3 occur 74/15/3 times; longer bursts reach 28. Choose N=3, park at the fourth failure, allowing the existing three-attempt citation budget while stopping longer pathological bursts. This sample is not a complete measure of legitimate retry demand.

## Changes and failure modes

- Stop the daemon session immediately on a terminal model error, retaining its reason; no SDK, network or compatibility retry.
- Fail model-unavailable worker steps before model fallback; keep Coordinator-only fallback behavior separate.
- Reuse failed phase / Needs you and persisted build error for parking. Guard dispatch and automatic continuation/restart as well as retry sweeps, queued-message drain, and both PR-feedback paths before they clear the error.
- Add a rolling-hour per-todo failed-build breaker with one persisted deduplicated notice in the task and Coordinator thread.
- Preserve citation parking and test repeated scheduler ticks against a terminal error.
- Edge cases: misleading numeric error text, unsupported-model without 404, failure after progress, stale builds, repeated reports, rolling-window boundary, independent todos, restart after process reload, explicit human recovery.

## Verification

Write regression tests first at each implicated seam and capture their red output, then implement. Run focused daemon/server tests, changed tests, affected e2e, lint, typecheck, spec:parse and prepush. No lockfile changes or live config writes. Open one PR on the assigned branch; inspect CI and cloud review. Results and evidence limits are in README.md.

## Decisions

| Question | Decision | Reason |
| --- | --- | --- |
| Is #3083 being reverted? | No | Its citation cap already works; close the common runtime and dispatch gaps instead. |
| Which hourly threshold? | N=3, park on failure 4 | Historical observations cluster at 1–3; the citation mechanism already budgets 3 attempts. Longer observed bursts reach 28. |
| How does a person recover? | Explicit human retry remains available after repairing routing | Parking stops autonomous work, rather than making the task permanently unusable. |
| Change the live citation route? | No | It is migrated team configuration, not a code default. |
| Does the installed SDK retry the original 404? | No in the real SDK replay | A misleading 503 diagnostic reproduces an SDK retry; do not attribute the historical build storm to SDK retries without its old logs. |
| What happens to Coordinator watches? | Settle them before the failed-phase event | A notice is sufficient; no new orchestration turn should run for a parked task. |
| Can another claimed step replace parking? | No; a shared outcome barrier settles only that step | Success, ordinary failure, quota fallback and stopping must not mutate a parked build or advance its task. |
