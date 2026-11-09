# Tracing through the OpenTelemetry SDK

Status: approved by ian on 2026-11-09; review corrections below preserve that decision. The seam move under Protected paths was approved by the orchestrator on 2026-11-09. ian approved the temporary coexistence under Rollout on 2026-11-09. Prior art and the live spike: `docs/research/otel-sdk-migration-2026-11-08.md`. Trigger: #3470, where one hand-written key kept Langfuse cost at 0.

## Choice

- `@opentelemetry/api` 1.10.0, `@opentelemetry/sdk-trace` 3.1.0, `@opentelemetry/resources` and `@opentelemetry/core` 3.1.0, and `@opentelemetry/exporter-trace-otlp-http` 0.301.0, which keeps the JSON wire format cairn sends today. `sdk-trace-base` and `sdk-trace-node` are deprecated in favour of `sdk-trace`.
- `@opentelemetry/semantic-conventions` 1.45.0, pinned exactly, with keys imported from `/incubating` for every `gen_ai.*`, `session.id` and `error.type` key.
- `@langfuse/core` 6.1.1 for the `langfuse.*` keys (`LangfuseOtelSpanAttributes`). Chat cost moves from `gen_ai.usage.cost`, which no library defines, to `OBSERVATION_COST_DETAILS` = `{"total":x}`. Langfuse 4.68 reads that key first, and it is proven live.
- Not chosen: `@langfuse/otel` and `@langfuse/tracing`. They peer on the deprecated SDK 2, filter cairn's non-GenAI spans, require Langfuse keys, and offer no derived span ids. Their SDK-6 identity also makes Langfuse JSON-decode metadata values.

All dependencies use exact versions in `packages/shared/package.json`. None of them runs an install script.

## What stays cairn-specific

1. **Id derivation.** The `deriveOtelId` formulas stay byte-for-byte. One `DerivedIdGenerator` implements `IdGenerator` and hands out a queued id once, falling back to `RandomIdGenerator`. A single helper, `startCairnSpan(tracer, name, { traceId?, spanId?, parent?, start, kind, attributes })`, queues the ids and then calls `tracer.startSpan` synchronously. A parent is set with `trace.setSpanContext(ROOT_CONTEXT, { …, traceFlags: SAMPLED, isRemote: true })`; without `SAMPLED`, `ParentBased` would drop the span. No global provider and no context manager are registered.
2. **Attribute mapping.** `genai-conventions.ts` keeps its builders (`chatAttributes`, `stepAttributes`, `invokeAgentAttributes`, …), but every key comes from the libraries. The only literals left are the `CAIRN_ATTR` keys and `deployment.environment`, for which semconv 1.45 has only the deprecated `TMP_` constant. `gen_ai.usage.cost` is removed, and so is the duplicate `langfuse.session.id`: Langfuse reads `session.id` (`Measured`). The `{ double }` value type goes, because Langfuse decodes `intValue` cost (`Measured`).
3. **Config.** `parseOtlpTarget` keeps the `CAIRN_OTEL_ENDPOINT` and `CAIRN_OTEL_HEADERS` contract, including URL userinfo becoming Basic auth. The bridge constructs the exporter synchronously with every `OTEL_EXPORTER_OTLP_*` environment entry temporarily absent, restoring the exact previous entries in `finally` before returning. No asynchronous work occurs inside this scope. The installed exporter snapshots fallback headers and TLS credentials during construction; this isolates ambient headers and client credentials without changing the SDK transport or retry implementation. Both direct exports and batched tracing use this single constructor. A capture test sets conflicting generic and trace headers, checks only CAIRN headers arrive, and checks the environment is restored after construction and failure. The resource is built explicitly from `otelResourceAttributes`, so no `telemetry.sdk.*` reaches Langfuse.

Times are passed as `Date` because the SDK reads a small bare number as performance-relative. Redaction runs on the attribute map before `startSpan`. `trajectory-push` keeps its redaction count by summing the counts per span.

## Call sites

| File | Today | After |
|---|---|---|
| `packages/shared/src/otel.ts` | OTLP types, `otlpAttributes`, `otlpNanos`, `otlpTracesRequest`, `postOtlpTraces`, `createOtlpSender`, `otlpTraceparent` | id formulas, `parseOtlpTarget`, `DerivedIdGenerator`, `startCairnSpan`, `createCairnTracing(target, environment, scope)`, which returns a tracer plus `forceFlush` and `shutdown` and creates its provider on first use, only when a target is set |
| `packages/shared/src/genai-conventions.ts` | literal keys, `{ double }` | library keys; the attribute type is the OTel `Attributes` |
| `apps/daemon/src/backend/otel.ts` (`PiStepSpanSink`, `claudeTelemetryEnv`) | collects `OtlpSpan[]` and sends them at flush | ends SDK spans; `flush` calls `forceFlush`; `TRACEPARENT` comes from `W3CTraceContextPropagator.inject` with an upper-casing setter |
| `apps/daemon/src/cli.ts` / `runMachine` stop | none | `shutdown()` after `handle.done` completes on every exit: SIGTERM, SIGINT, control-stream shutdown, and normal machine completion; signals initiate machine stop, then the shared completion path drains spans |
| `apps/server/src/runtime-otel.ts` (`emitRuntimeStepSpan`, `emitRuntimeBuildSpan`, `emitCoordinatorTurnSpans`, `emitCompactionFailureSpan`) | `OtlpSpan` literals and the sender | `startCairnSpan` with the same ids, names and attributes; signatures unchanged, so the callers in `machine-finish-step.ts` (protected), `builds.ts`, `ci-loop.ts`, `coordinator-steps.ts`, `failure-report.ts` and `turn-spans.ts` do not change |
| `apps/server/src/index.ts` `shutdown()` | none | first stops producers and awaits the HTTP close callback (including active requests), then awaits tracing `shutdown()` before process exit |
| `apps/server/src/trajectory-otlp.ts` (`packToOtlp`) | returns an OTLP request | returns ended `ReadableSpan[]` with derived ids and the pack's times |
| `apps/server/src/trajectory-push.ts` | its own `fetch` and a duplicate `OtlpTarget` | `exporter.export(spans)` per pack; the ledger row is written on `ExportResultCode.SUCCESS`; the exporter's 429 and 5xx retries come for free |
| `apps/server/src/trajectory-shadow.ts` (`digestSpan`) | `postOtlpTraces` | `startCairnSpan` parented to the unit, then `export` |
| `trajectory-failure-replay-queue.ts`, `-cli.ts` | `otlpTraceIdOfBuild` | unchanged |
| `packages/shared/src/agent-backend.ts` `StepOtelContext` | carries `tracesUrl`, `headers`, `exporterEndpoint`, `exporterHeaders` | `traceId`, `stepSpanId`, `environment`; the last two fields are unused today |

Deleted, with no second path left: `OtlpValue`, `OtlpAttribute`, `OtlpSpan`, `OtlpTracesRequest`, `OTLP_SPAN_KIND`, `OTLP_STATUS_ERROR`, `otlpAttributes`, `otlpNanos`, `otlpTracesRequest`, `postOtlpTraces`, `OTLP_SEND_TIMEOUT_MS`, `createOtlpSender`, `otlpTraceparent`, the `fetch` in `trajectory-push.ts`, and `derivedId`, which `trajectory-otlp.ts` copies from `deriveOtelId`.

## Protected paths

- The eval ruler is untouched: `trajectory-export.ts`, `trajectory-export-cli.ts`, `trajectory-outcome.ts`, `trajectory-pack.ts`, `integration/eval/**` and `.claude/hillclimb/**`; none of them imports the OTel code. `packToOtlp` carries the outcome fields `cairn.outcome.merged`, `cairn.outcome.reverted_within_7d`, `cairn.outcome.fixed_by_later_pr` and `cairn.cost_usd`. Their keys and values stay. The only change is integer costs going out as `intValue`, which Langfuse stores as the same metadata string (`Measured`). A golden test pins the decoded attribute map.
- These protected paths do change: `packages/shared/package.json` and `pnpm-lock.yaml` (dependencies ian approved; committed with `CAIRN_ALLOW_LOCKFILE_CHANGE=1`), and `biome.json`. Its seam rule allows `@opentelemetry/*` only in `apps/daemon/src/backend/otel.ts`; it moves to `packages/shared/src/otel.ts`, the one bridge that both apps use, with `@langfuse/core` added to the same rule. Approved by the orchestrator on 2026-11-09.

## Failure modes and red-first tests

| Failure | Test (red on the old code) |
|---|---|
| A wrong cost key ships (#3470) | The chat span's cost key equals `LangfuseOtelSpanAttributes.OBSERVATION_COST_DETAILS` |
| Daemon and server spans stop joining | The derived ids in an `InMemorySpanExporter` capture equal the `otlp*Of*` formulas; a daemon chat span's parent is the server step span id |
| Spans lost on exit | `shutdown()` resolves only after a capture HTTP server received the queued span; the old code has no flush |
| Ambient collector credentials reach the CAIRN target | Direct and batched exports exclude conflicting generic and trace OTEL headers, preserve CAIRN headers, and restore the process environment |
| A non-signal daemon stop loses spans | A control-stream shutdown drains in-flight work and exports queued spans before foreground completion |
| An active server request emits after tracing shuts down | A delayed request emits its terminal span before the close callback and tracing shutdown complete |
| A transient 503 loses a trajectory push | Push retries and writes the ledger row once |
| A synthetic parent is not sampled | A child of `setSpanContext` is exported |
| Epoch 0 is read as process start | A pack with no timestamps exports `startTimeUnixNano` 0 |
| Outcome semantics drift | The golden `invoke_agent` attribute map for a fixture pack is equal before and after (green on both; a guard) |
| A secret in tool arguments | The redacted value is in the exported span (existing tests, ported) |

## Rollout

Three sequential PRs (shared, then server, then daemon), each branched from updated `origin/main` after its predecessor merges. Dependent work stays local until then. Existing stacked work is transplanted to a fresh branch and PR when preserving the published head would require a force push; the superseded PR is closed with its replacement link. Each PR stays under ~1000 lines and is red-first:

1. `shared(otel)`: dependencies, `biome.json`, the bridge, library keys, and the offline paths (`trajectory-otlp`, `trajectory-push`, `trajectory-shadow`).
2. `server(otel)`: `runtime-otel.ts` and the server shutdown flush.
3. `daemon(otel)`: the sink, `TRACEPARENT` and the daemon stop flush. This PR deletes the hand-written OTLP code.

Between PR 1 and PR 3, the old sender still serves the server and the daemon. ian approved this coexistence on 2026-11-09. It expires on 2026-11-09, and #3567 tracks it; PR 3 closes that issue. Each PR is proven live: a real step's spans are in ClickHouse `events_core` (read with `docker exec`) under one `trace_id`, with parent ids that join and `provided_cost_details.total` present.

## 6. Execution and acceptance

Design PR: #3566. Shared SDK bridge: #3568. Server SDK runtime: #3571. Final daemon segment closes #3567; conversation payload coverage is tracked in #3619. Research: `docs/research/otel-sdk-migration-2026-11-08.md`.

The server segment owns Coordinator root and generation input/output; the daemon segment owns worker root and generation input/output. Verify the deployed Langfuse ingestion source before choosing attributes, retain the existing payload redaction and size bounds, and prove each missing payload red on current main before implementing it through the SDK. The final PR includes a ClickHouse query and a screenshot showing a new conversation turn after deployment. Cairn production access is read-only during this task; the owner supplies any new live turn needed for acceptance.

| Decision | Reason | Reversal |
|---|---|---|
| One synchronous exporter-construction isolation scope | SDK 0.301 snapshots ambient headers and TLS credentials; application configuration must be the only credential source | Replace the bridge constructor when the SDK exposes equivalent explicit isolation |
| Complete machine and HTTP draining before telemetry shutdown | Every terminal producer must finish before the final export | Revert the lifecycle change together with its regression tests |
| Sequential PRs from main | Preserve the repository merge route without rewriting published history | Keep dependent work local until its base lands |
