# Self-hosted Langfuse for debugging (#1569)

OTel is the outward data format. Self-hosted Langfuse is only for viewing and annotating traces; the local sqlite remains the source of truth. The compose lives in `ops/langfuse/` and does not enter the product install path; Cairn behaves the same when it is not configured. The OTLP endpoint accepts any Langfuse target: this compose is the self-hosted path, Langfuse Cloud works too.

## Starting the stack

```sh
cd ops/langfuse
cp .env.example .env
docker compose up -d
curl -sf "http://127.0.0.1:3000/api/public/health"
```

The passwords in `.env.example` are placeholders; replace them before binding anywhere but loopback. First start runs the Postgres / ClickHouse migrations — wait for health to return JSON. UI: `http://127.0.0.1`. Headless init (`LANGFUSE_INIT_*` in `.env`) writes org `cairn-dev`, project `cairn-local` and a pk/sk pair on first start with an empty database; the UI path is Sign up → create org and project → Project Settings → API Keys.

## Sending traces in

OTLP/HTTP JSON, `POST /api/public/otel/v1/traces`, Basic auth = pk:sk, plus header `x-langfuse-ingestion-version: 4` (without it the v4 UI lags ~10 minutes).

```sh
export CAIRN_OTEL_ENDPOINT="http://127.0.0.1:3000/api/public/otel"
export CAIRN_OTEL_HEADERS="Authorization=Basic $(printf '%s' "$LANGFUSE_PUBLIC_KEY:$LANGFUSE_SECRET_KEY" | base64 | tr -d '\n'),x-langfuse-ingestion-version=4"
```

A `user:password@` embedded in the endpoint becomes the Basic header. `CAIRN_OTEL_ENVIRONMENT` (lowercase/digits/`_`/`-`, ≤40 chars, not starting `langfuse`) adds `langfuse.environment` to each span; export is off unless the endpoint is set and never blocks a turn.

Eval results: the eval suite (`eval/`, `docs/design/eval-gate.md`) writes runs and item scores into the Langfuse project via `client.experiment.run`.

## Trace layout

One build is one trace, root span `invoke_agent`, each step a child, model turns `chat`, tool calls `execute_tool`; ids are hashes of build/step ids so re-pushing is idempotent. Each Coordinator turn is its own trace, root `coordinator turn`, session = Coordinator thread id; build traces use the todo id as session. Tags: `cairn`, `coordinator` / `build`. Field names live in `packages/shared/src/genai-conventions.ts`.

The packaged Mac app reads the same three `CAIRN_OTEL_*` keys from `~/Library/Application Support/@cairn/desktop/otel.env` (mode `0600`); see `apps/desktop/README.md`.

## Debugging a turn or task

Start with Langfuse for model requests, errors, usage and tool execution, not for browser delivery. Read access is separate from ingestion: the server's ingestion key may be write-only. Use GET requests; load credentials inside the query process without printing them or placing them in command arguments, and keep them in the approved local secret source, never in threads, logs or committed files. A 401/403 means access is unverified, not that the trace is absent.

Find the Coordinator `step.id` in the server's read-only DB or journal; the thread id alone groups many turns. Compute the trace id with `otlpTraceIdOfTurn(stepId)` from `@cairn/shared/otel`; for a task use `otlpTraceIdOfBuild(buildId)`. The root carries `cairn.step_id` / `cairn.thread_id` / `cairn.build_id`. These are product ids, not Amp thread ids.

On v4 `events_only`, query `GET /api/public/v2/observations?traceId=<trace-id>&fields=core,basic,metadata,usage,model` with Basic auth and follow `meta.cursor`; the old traces/observations endpoints return 404, scores use `/api/public/v3/scores`.

Inspect the root interval and outcome, model/provider, finish reason, token/cache usage and child tool errors before blaming the main model. Summary model calls are `summary summary-fold` and `summary memory-flush`: each records interval, returned usage and bounded scrubbed diagnostics, no prompts or payloads. `compaction <stage>` spans describe lifecycle stages, not generation intervals.

Chat spans with equal start/end times do not measure provider latency; trust generation duration or TTFT only when the deployed version captures the real request interval. Missing spans can mean export disabled, no instrumentation, a dead process or a failed best-effort export — confirm configuration and server/daemon logs before concluding no model call happened.

Coverage per backend: pi sessions export each `streamSimple` call with interval and usage (compaction calls metadata-only); Claude Code exports generations and tool spans through the daemon's native-telemetry bridge (`apps/daemon/test/claude-otel-export.test.ts` covers the boundary); ACP sessions expose no per-inference boundary — `used` there is occupancy, not consumption; research is an ordinary task/build on its selected backend.

For a missing page reply, inspect the browser's Network stream/reconnect and Console, then correlate with the server journal and read-only `step`, `chief_message` and input-receipt records: check whether the model answered, the server persisted/mirrored it, and the browser rendered it separately. Langfuse is optional best-effort evidence, not the source of truth.

## Pinned images

| Service | Image |
|---|---|
| langfuse-web | `docker.io/langfuse/langfuse:4.68.0` |
| langfuse-worker | `docker.io/langfuse/langfuse-worker:4.68.0` |
| Postgres | `docker.io/library/postgres:17.11` |
| ClickHouse | `docker.io/clickhouse/clickhouse-server:25.12.11` (do not drift to 26.x, the query analyzer is incompatible) |
| Redis | `docker.io/library/redis:7.4.11` |
| MinIO | `cgr.dev/chainguard/minio` pinned by digest in `ops/langfuse/docker-compose.yml` |

Upgrade: change this table and the tags in `ops/langfuse/docker-compose.yml`, `docker compose pull`, `up -d`. Langfuse runs migrations itself within a major version.
