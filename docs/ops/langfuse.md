# Self-hosted Langfuse v4 on this machine (#1569)

OTel is the outward data format. Self-hosted Langfuse is only responsible for viewing and annotating (traces, scores, the annotation queue, experiment comparisons). The local sqlite + trajectory packs remain the only source of truth; replay, grading statistics, CI gates, and the harness self-improvement loop do not go through here.

This is an optional developer-side component; the compose lives in `ops/langfuse/` and **does not enter the product install path**. Cairn itself does not depend on this stack, and behavior is unchanged when it is not configured. Langfuse Cloud is not used.

The default deployment machine is **omarchy** (always on). Any other always-on machine follows the same steps.

Comparison: the official compose uses floating tags (`langfuse:4`, `clickhouse-server:25.12`, `redis:7`). This repo pins exact versions; see "Pinned images" at the end.

## Environment prerequisites

- Docker Engine + the Compose v2 plugin.
- Recommended: 4 cores, 8 GiB of memory, and about 15 GiB of free disk dedicated to this stack (the official public-VM sizing is 16 GiB RAM / 100 GiB disk, which targets high traffic; omarchy local development does not need that).
- Host ports `3000` (UI + OTLP) and `9090` (MinIO, only used when the browser uploads media) must be free. On conflict, change `LANGFUSE_WEB_PORT` / `MINIO_API_PORT` in `.env`, and update `NEXTAUTH_URL` and `LANGFUSE_S3_MEDIA_UPLOAD_ENDPOINT` accordingly.
- All published ports bind to `BIND_ADDRESS` (default `127.0.0.1`). Postgres / ClickHouse / Redis / the worker are not published; they only talk on the compose network.

## Starting the stack (omarchy)

On omarchy, from the repo root:

```sh
cd ops/langfuse
cp .env.example .env
```

The passwords in `.env.example` are placeholders, not secrets. After copying, replace at least these before `compose up`:

```sh
python3 - <<'PY'
from pathlib import Path
import secrets, re
p = Path(".env")
text = p.read_text()
repl = {
    "NEXTAUTH_SECRET": secrets.token_urlsafe(32),
    "SALT": secrets.token_urlsafe(32),
    "ENCRYPTION_KEY": secrets.token_hex(32),
    "POSTGRES_PASSWORD": secrets.token_urlsafe(24),
    "CLICKHOUSE_PASSWORD": secrets.token_urlsafe(24),
    "REDIS_AUTH": secrets.token_urlsafe(24),
    "MINIO_ROOT_PASSWORD": secrets.token_urlsafe(24),
    "LANGFUSE_INIT_USER_PASSWORD": secrets.token_urlsafe(16),
    "LANGFUSE_INIT_PROJECT_PUBLIC_KEY": "pk-lf-" + secrets.token_hex(16),
    "LANGFUSE_INIT_PROJECT_SECRET_KEY": "sk-lf-" + secrets.token_hex(16),
}
for key, val in repl.items():
    text, n = re.subn(rf"^{key}=.*$", f"{key}={val}", text, count=1, flags=re.M)
    if n != 1:
        raise SystemExit(f"missing {key}")
p.write_text(text)
print("wrote ops/langfuse/.env (do not commit)")
print("INIT public:", repl["LANGFUSE_INIT_PROJECT_PUBLIC_KEY"])
print("INIT secret:", repl["LANGFUSE_INIT_PROJECT_SECRET_KEY"])
print("INIT user password:", repl["LANGFUSE_INIT_USER_PASSWORD"])
PY
```

If it is only for this machine and you accept the example placeholders, you can skip this block and start the stack directly. The passwords must be replaced before binding to the LAN.

```sh
docker compose up -d
docker compose ps
curl -sf "http://127.0.0.1:3000/api/public/health"
```

On first start `langfuse-web` runs the Postgres / ClickHouse migrations; measured about 8 minutes on omarchy, during which health connections being reset is normal. Continue only after health returns JSON and all eight containers in `docker compose ps` are healthy / running. UI: `http://127.0.0.1:3000`.

## Creating the project and getting the key pair

Headless initialization (the `LANGFUSE_INIT_*` values in `.env`) is written on **first start with an empty database**: organization `cairn-dev`, project `cairn-local`, one pk/sk pair, and the user `dev@example.com`. Changing the INIT values in `.env` afterwards does not overwrite the existing project. The keys in effect are the pair written into the database at that time — if you generated them with the script above, they were printed at startup; if you kept the example values, they are `pk-lf-local-dev-not-a-secret` / `sk-lf-local-dev-replace-me`.

You can also do it in the UI: open `http://127.0.0.1:3000` → Sign up (there is no built-in admin) → create the organization and project → Project Settings → API Keys → create a pair. username = public key (`pk-lf-…`), password = secret key (`sk-lf-…`).

## The OTLP endpoint

Path: `POST /api/public/otel/v1/traces` (OTLP/HTTP JSON; gRPC is not supported).

Auth: HTTP Basic, username = public key, password = secret key. For v4 real-time ingestion also send `x-langfuse-ingestion-version: 4`; without this header the UI may lag by about 10 minutes.

Swap `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` for the pair obtained in the previous section:

```sh
export LANGFUSE_HOST="http://127.0.0.1:3000"
export LANGFUSE_PUBLIC_KEY="pk-lf-local-dev-not-a-secret"
export LANGFUSE_SECRET_KEY="sk-lf-local-dev-replace-me"

TRACE_ID=$(openssl rand -hex 16)
SPAN_ID=$(openssl rand -hex 8)
START=$(($(date +%s) * 1000000000))

curl -sS -X POST "$LANGFUSE_HOST/api/public/otel/v1/traces" \
  -u "$LANGFUSE_PUBLIC_KEY:$LANGFUSE_SECRET_KEY" \
  -H "Content-Type: application/json" \
  -H "x-langfuse-ingestion-version: 4" \
  --data-binary @- <<JSON
{"resourceSpans":[{"scopeSpans":[{"spans":[{
  "traceId":"$TRACE_ID",
  "spanId":"$SPAN_ID",
  "name":"cairn-langfuse-selfhost-probe",
  "startTimeUnixNano":"$START",
  "endTimeUnixNano":"$((START + 1000000))",
  "attributes":[
    {"key":"langfuse.observation.input","value":{"stringValue":"ops/langfuse probe"}},
    {"key":"langfuse.observation.output","value":{"stringValue":"visible in UI"}}
  ]
}]}]}]}
JSON
```

HTTP 2xx means accepted (queued; the worker writes to ClickHouse asynchronously and it is queryable within seconds). Open the UI → Traces; you should see one entry named `cairn-langfuse-selfhost-probe`. That is this ticket's acceptance action.

Verifying from the command line: v4 defaults to events_only mode; the old `GET /api/public/traces` and `/api/public/observations` return 404, so use the v2 API:

```sh
curl -sS -u "$LANGFUSE_PUBLIC_KEY:$LANGFUSE_SECRET_KEY" \
  "$LANGFUSE_HOST/api/public/v2/observations?traceId=$TRACE_ID"
```

If the returned `data[0].name` is `cairn-langfuse-selfhost-probe`, it passes.

Equivalent Collector / SDK configuration:

```sh
OTEL_EXPORTER_OTLP_ENDPOINT="http://127.0.0.1:3000/api/public/otel"
OTEL_EXPORTER_OTLP_HEADERS="Authorization=Basic $(printf '%s' "$LANGFUSE_PUBLIC_KEY:$LANGFUSE_SECRET_KEY" | base64 | tr -d '\n'),x-langfuse-ingestion-version=4"
```

## Failure-replay annotation queue (#1516)

Plan rejection, review blocking, and post-merge revert trajectories become
candidate bench questions (`pnpm traj:failure-replay --generate`). Push the
matching packs with `pnpm traj:push` first so the deterministic build trace ids
exist in Langfuse, then enqueue:

```sh
export CAIRN_LANGFUSE_HOST="http://127.0.0.1:3000"
export CAIRN_LANGFUSE_PUBLIC_KEY="pk-lf-…"
export CAIRN_LANGFUSE_SECRET_KEY="sk-lf-…"
export CAIRN_LANGFUSE_ANNOTATION_QUEUE_ID="<queue-id>"
pnpm traj:failure-replay --enqueue --in /tmp/failure-replay-candidates.jsonl
```

Create the queue once in the Langfuse UI (Annotations → New queue) with a
pass/fail score config. Humans mark items COMPLETED there. Intake then writes
only confirmed cases into the protected bank:

```sh
pnpm traj:failure-replay --intake --in /tmp/failure-replay-candidates.jsonl \
  --bank integration/eval/failure-replay --out /tmp/failure-replay-confirmed.jsonl
```

Pending candidates never enter `integration/eval/`. The intake PR touches the
protected eval bank, so a human still marks the confirmed cases, but the PR
enters the merge queue with every other green PR and merges on its own once
the required checks pass.

## Pushing trajectory packs (#1570)

The JSONL trajectory packs produced by `pnpm traj:export` are converted by `pnpm traj:push` into OTLP/HTTP JSON and pushed to the endpoint above. It uses only the public protocol, carries no Langfuse SDK, and exits with an error when `CAIRN_OTEL_ENDPOINT` is not configured; nothing else in Cairn is affected.

```sh
export CAIRN_OTEL_ENDPOINT="http://127.0.0.1:3000/api/public/otel"
export CAIRN_OTEL_HEADERS="Authorization=Basic $(printf '%s' "$LANGFUSE_PUBLIC_KEY:$LANGFUSE_SECRET_KEY" | base64 | tr -d '\n'),x-langfuse-ingestion-version=4"
pnpm traj:export --build <buildId> --out /tmp/pack.jsonl
pnpm traj:push /tmp/pack.jsonl
```

The trailing `/v1/traces` on `CAIRN_OTEL_ENDPOINT` is optional. `CAIRN_OTEL_HEADERS` is a comma-separated list of `name=value`. A `user:password@` embedded in the endpoint is converted into the Basic header and never appears in the output.

Tree structure: one build is one trace with the root span `invoke_agent`; each step is one child span; under a step, every model turn is a `chat` and every tool call is an `execute_tool`. The trace id is a hash of the buildId, and the span id is a hash of the buildId, stepId, and turn index, so re-pushing the same pack yields exactly the same ids — Langfuse merges by id and the count does not change. Field names are centralized in `packages/shared/src/genai-conventions.ts`; renaming a convention only changes that one place. Before pushing, the whole request goes through `redactSecrets`; the masked count is in the `redacted=` of the output.

## Coordinator turns and filtering

Each Coordinator turn is its own trace. The server exports the `chief` step as the root span `coordinator turn`; the daemon adds `chat <model>` and `execute_tool <name>` children with the same redaction as build steps. The trace id is a hash of the step id, so a turn never mixes with a build trace. Attributes follow the [Langfuse OpenTelemetry mapping](https://langfuse.com/integrations/native/opentelemetry): `langfuse.trace.name`, `langfuse.session.id` and `session.id` (the Coordinator thread id, so a thread's turns group as one session), `langfuse.trace.tags` (`cairn`, `coordinator`) and `langfuse.environment`. Build traces carry the same attributes with the todo id as the session and tags `cairn`, `build`. The turn prompt is never exported.

Set `CAIRN_OTEL_ENVIRONMENT` (lowercase letters, digits, `_` and `-`, at most 40 characters, not starting with `langfuse`) to add `deployment.environment` to the resource and `langfuse.environment` to each span; an invalid or unset value adds nothing. `service.name` stays `cairn`. Export is off unless `CAIRN_OTEL_ENDPOINT` is set. It never blocks a turn: posts go through a bounded sender (4 in flight, 64 queued, 5 s timeout) that drops on overflow.

## Shadow labels, cost anomaly and the dashboard

Approved by ian on 2026-11-09: Claude Haiku on his pay-as-you-go Anthropic API key, under $0.10 per day. Everything here only writes scores; nothing in cairn reads them or acts on them.

`pnpm traj:shadow` turns each finished step span (`step <kind>`) and `coordinator turn` into one `step digest` child observation and writes code-computed scores. It reads only the Langfuse public API and writes through the OTLP endpoint, so it needs both sets of variables:

```sh
export CAIRN_LANGFUSE_HOST="http://127.0.0.1:3000"
export CAIRN_LANGFUSE_PUBLIC_KEY="pk-lf-…"
export CAIRN_LANGFUSE_SECRET_KEY="sk-lf-…"
export CAIRN_OTEL_ENDPOINT="http://127.0.0.1:3000/api/public/otel"
export CAIRN_OTEL_HEADERS="Authorization=Basic …,x-langfuse-ingestion-version=4"
pnpm traj:shadow --since-hours 2 --settle-minutes 30
```

It looks at units that ended between `since-hours + settle-minutes` and `settle-minutes` ago, skips units that already have a digest, and prints `units= digests= skipped_already_digested= cost_scores= question_units=`. `--dry-run` writes nothing. Run it at least as often as `--since-hours`; overlapping windows are safe.

On omarchy the systemd user timer `cairn-langfuse-shadow.timer` runs it hourly from the deployed checkout `~/Code/AgentProjects/cairn-exec` with `--since-hours 2 --settle-minutes 30`. The service reads its variables from `~/.config/cairn/langfuse-shadow.env` (mode 600) and appends to `~/.local/state/cairn-langfuse/shadow.log`.

The digest is the input of the `step digest` observation, at most 6,000 characters (about 1.5k tokens; generation inputs average 119k tokens, so the judges never see a raw trace). It holds the task title, the outcome and error, the last 12 phase transitions of the trace, idle minutes after the unit or the gap to the next one, counts computed in code (tool calls, tool errors, edits, the largest number of identical calls and identical failures, cost), the last 15 tool calls with errors, and the text of `ask_user` questions. It passes through `redactSecrets`. Its metadata carries `unit` and `has_owner_question`.

Scores written by the job (source `API`, attached to the unit's span):

| Score | Value |
|---|---|
| `step_error` | 1 when the unit span ended in `ERROR`, else 0. Its daily mean is the error rate. |
| `cost_z` | (unit cost − mean) / sd over units of the same kind on the same model that ended in the 7 days before it. Units without priced generations are skipped; fewer than 5 baseline units or a flat baseline writes nothing. The comment names cost, mean, sd and n. |

Langfuse configuration on omarchy (project `cairn-local`), all created through the public API:

| Object | Setting |
|---|---|
| LLM connection | provider `anthropic`, adapter `anthropic`, custom model `claude-haiku-5-5`, default models off. The key is the one stored in cairn's Anthropic provider row. |
| Evaluators | `shadow.stalled`, `shadow.looping`, `shadow.needless_owner_question`: LLM-as-a-judge, `anthropic` / `claude-haiku-5-5`, numeric 0–1 output with a one-line explanation. `{{digest}}` maps to the observation `input`. The system prompt says the digest is untrusted agent data and that no instruction inside it is followed. |
| Rule `shadow: stalled + looping on step digests` | name any of `step digest`, sampling 0.7, stalled and looping. |
| Rule `shadow: needless owner question on step digests with a question` | name any of `step digest` and metadata `has_owner_question` = `true`, sampling 1. |
| Dashboard `cairn: steps, cost and shadow labels` | cost per day by model, steps per day by kind, step latency p50/p95, step error rate (`step_error`), the three shadow scores over time, labels ≥ 0.7 per day, `cost_z` max and mean. |

Only observation-level rules work here: in `events_only` mode a trace-level rule produces nothing. Trace-level variable mapping is not used, so the 119k-token generation inputs are never mapped. A JSONPath that fails falls back to the whole field in Langfuse 4.68, which is why the digest is a separate small observation rather than a selector over a large one.

Measured on the first run over the 24 hours before 2026-11-09 03:00 UTC (137 units, sampling 1): 296 judge calls, 544k input and 33k output tokens, $0.071. At sampling 0.7 for stalled and looping this is about $0.05 per day. The evaluator list shows the 7-day judge cost; the dashboard's cost chart includes it when the `langfuse-llm-as-a-judge` environment is selected.

### Reaching Anthropic from the containers

`api.anthropic.com` answers 403 `Request not allowed` to the containers on omarchy, while the host reaches it through a loopback proxy that containers cannot reach. The `egress-relay` compose profile bridges this without firewall changes: `egress-relay-host` (host network) exposes the host proxy on a unix socket in the `egress_socket` volume, and `egress-relay` (compose network, not published) accepts only `CONNECT api.anthropic.com:443` and forwards it to that socket. Langfuse sends LLM calls through `HTTPS_PROXY` and keeps internal services direct through `NO_PROXY`. On omarchy `.env` sets:

```sh
COMPOSE_PROFILES=egress-relay
LANGFUSE_LLM_HTTPS_PROXY=http://egress-relay:3128
```

Hosts with direct access leave both empty. `EGRESS_UPSTREAM` (default `127.0.0.1:7890`) and `EGRESS_ALLOW` (default `api.anthropic.com:443`) adjust the relay. A refused target appears in `docker compose logs egress-relay` as `egress relay refused: <host:port>`. The relays run as root with every capability dropped except `DAC_READ_SEARCH`, so they can read the mounted script even when the checkout was written with umask 077, as the deployed checkout is. Bring the stack up from the deployed checkout so the mount survives worktree cleanup: `docker compose -f ~/Code/AgentProjects/cairn-exec/ops/langfuse/docker-compose.yml --env-file ~/Code/AgentProjects/cairn/ops/langfuse/.env up -d`.

## Claude Code runtime tool traces (#2269)

Configure `CAIRN_OTEL_ENDPOINT` and `CAIRN_OTEL_HEADERS` on the daemon to export
Claude Code tool spans. The daemon converts streamed tool calls and results to
OTLP/HTTP JSON and applies both its exact subscription-credential redactor and
the shared `redactSecrets` patterns before posting. Trace and parent span ids
remain tied to the build and step.

Direct Claude CLI telemetry is disabled in both the subprocess environment and
the SDK flag settings. Inherited and per-session `OTEL_*`, `CAIRN_OTEL_*`,
`ANT_OTEL_*` and beta tracing (`ENABLE_BETA_TRACING_DETAILED`,
`BETA_TRACING_ENDPOINT`) configuration is removed from the subprocess
environment. The CLI's beta tracing exporter ignores
`CLAUDE_CODE_ENABLE_TELEMETRY`, so the flag settings also pin
`BETA_TRACING_ENDPOINT` to an empty value; flag settings outrank user and project
settings. Managed policy settings still outrank flag settings, so a machine
administrator can re-enable CLI export. Exporter credentials stay in the daemon. CLI-native
chat spans, metrics, logs and enhanced telemetry are disabled; only streamed
tool spans use this replacement path. Export is best effort and does not delay
session completion.

The regression in `apps/daemon/test/claude-otel-export.test.ts` runs the real SDK
against a fake CLI process and an ephemeral HTTP collector. The fake executes a
child tool that prints a synthetic secret. The test checks the actual exported
body, including completion, CLI failure, abrupt exit, credential patterns,
settings overrides (including beta tracing set in user settings) and collector
failure. With the unchanged main backend, the
same fixture exports the synthetic secret in clear text. This verifies the SDK,
daemon mapping and HTTP boundary; it does not exercise a real model or Langfuse.

Redaction retains the existing pattern limits: arbitrary unrelated or encoded
secrets are not guaranteed to match. Abrupt daemon termination can lose pending
spans. Gemini ACP still inherits its process environment and does not receive
Cairn's per-step OTel configuration; this change is limited to Claude Code.

## Code evaluators (hardened dispatcher)

Langfuse code evaluators run owner-written TypeScript against an observation and return scores. v4.68.0 ships two dispatchers: `insecure-local` runs the source inside the worker process with `node:vm`, which can reach the worker's database, ClickHouse and LLM credentials, and `aws-lambda`. This stack uses `aws-lambda` against a local AWS Lambda Runtime Interface Emulator so evaluator code never runs inside the worker.

```
langfuse-worker ──(code-eval-ingress)──> code-eval-gateway ──(code-eval-sandbox)──> code-eval-runner
```

| Service | Role |
|---|---|
| `code-eval-runner` | Official `public.ecr.aws/lambda/nodejs:24` image (pinned by digest) with Langfuse's own `code-based-eval-handler.mjs` from v4.68.0, copied unchanged into `ops/langfuse/code-eval-runner/`. It runs as `65534`, with a read-only root filesystem, a 16 MiB `noexec` tmpfs, all capabilities dropped, 256 MiB of memory, half a CPU, 64 processes, no secrets and no published ports. `AWS_LAMBDA_FUNCTION_TIMEOUT=2` makes the emulator kill an invocation after 2 seconds and restart the runtime for the next one. |
| `code-eval-gateway` | A TCP forwarder (`code-eval-gateway.mjs`) on the two code-eval networks. It listens only on its `code-eval-ingress` address and always forwards to `code-eval-runner:8080`, so the evaluator has no way to reach the worker, the web container, a database or the host, and the worker is never on the evaluator's network. |
| `langfuse-worker` | `LANGFUSE_CODE_EVAL_DISPATCHER=aws-lambda`, the endpoint `http://code-eval-gateway:8080`, function name `function` (the emulator's only route), `LANGFUSE_CODE_EVAL_EXECUTION_WORKER_CONCURRENCY=1`, and dummy AWS signing values that exist only in this service. |
| `langfuse-web` | `LANGFUSE_CODE_EVAL_DISPATCHER=aws-lambda`, so the UI offers code evaluators. It has no AWS values and is not on a code-eval network. |

Both code-eval networks are `internal` and use `gateway_mode_ipv4: isolated`, so Docker assigns the bridge no address on the host. An `internal` network alone still leaves the host reachable on the bridge address. TypeScript is the only supported language: the Python function name keeps its default and fails with a configuration error.

### Applying it to the live stack

From `ops/langfuse/` after this change is on `main`:

```sh
docker compose up -d --build
docker compose ps
```

This recreates `langfuse-web` and `langfuse-worker` and starts the two new containers. Then check the isolation and one invocation:

```sh
for n in code-eval-ingress code-eval-sandbox; do
  docker network inspect "cairn-langfuse_$n" --format '{{.Internal}}'
  ip -4 addr show "br-$(docker network inspect "cairn-langfuse_$n" --format '{{.Id}}' | cut -c1-12)" | grep -c inet
done
docker compose exec -T langfuse-worker node -e "fetch('http://code-eval-gateway:8080/2015-03-31/functions/function/invocations',{method:'POST',body:JSON.stringify({code:{source:'function evaluate(){return {scores:[{name:\"smoke\",value:1,dataType:\"NUMERIC\"}]}}'},payload:{}})}).then(r=>r.text()).then(console.log)"
```

The loop prints `true` then `0` for each network. The invocation prints `{"scores":[{"name":"smoke","value":1,"dataType":"NUMERIC"}]}`. A non-zero count means the Docker Engine ignored `gateway_mode_ipv4: isolated`; the change was verified on Docker Engine 29.9.2, so upgrade before relying on it.

To roll back, remove `LANGFUSE_CODE_EVAL_DISPATCHER` from `x-langfuse-env`, delete the `code-eval-*` services and run `docker compose up -d --remove-orphans`.

### Writing an evaluator

An evaluator is `function evaluate(ctx)` returning `{ scores: [...] }`. `ctx.observation` carries `input`, `output`, `metadata` and `toolCalls`; `ctx.experiment` carries `itemExpectedOutput` and `itemMetadata` for experiment items. A rule with the filters `isExperimentItemRootSpan = true` and `datasetId` scopes an evaluator to one dataset's experiment runs. Create them in the UI, or with `POST /api/public/v2/evaluators` (`type: "code"`, `sourceCodeLanguage: "TYPESCRIPT"`) and `POST /api/public/v2/evaluation-rules`, using a project key held in your shell; do not put it in a file or a command line that is logged.

Every failure leaves a `job_executions` row in `ERROR` and no score, which is how an unscored item shows up:

| Evaluator does | Result |
|---|---|
| Throws | `ERROR` with the exception message |
| Returns anything but `{ scores: [...] }` | `ERROR`, "invalid result" |
| Returns more than 256 KB | `ERROR`, "result is too large" |
| Runs longer than 2 seconds, or exhausts memory | `ERROR`, "invalid result"; the runner log shows `Task timed out after 2.00 seconds`. The next invocation runs normally |
| Calls `fetch`, opens a socket, or resolves a name | Fails inside the runner; there is no DNS and no route out |

The evaluator can write only to its 16 MiB `/tmp`. The environment it can read holds the emulator's own values and nothing from this stack.

## Binding to this machine or the LAN

By default `BIND_ADDRESS=127.0.0.1`, so only processes on omarchy itself can reach the UI and OTLP.

When another dev machine needs to view it over the LAN, set `BIND_ADDRESS` to omarchy's LAN address (for example `10.0.0.12`) and also change:

```
NEXTAUTH_URL=http://10.0.0.12:3000
LANGFUSE_S3_MEDIA_UPLOAD_ENDPOINT=http://10.0.0.12:9090
```

`NEXTAUTH_URL` must equal the origin you open in the browser, otherwise the login callback breaks. Do not bind `0.0.0.0` to the public internet; do not use Langfuse Cloud. After rebinding, run `docker compose up -d` to recreate the port mappings for web / minio.

## Backup

Langfuse's data is scattered across three places, and missing one piece breaks the rest: Postgres (users, projects, keys), ClickHouse (trace / observation / score), MinIO (event payloads and media). Redis is only a queue and can be skipped. The official compose ships no backup; locally we use volume snapshots.

In `ops/langfuse/`:

```sh
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
OUT="$HOME/backups/langfuse/$STAMP"
mkdir -p "$OUT"

docker compose exec -T postgres pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip > "$OUT/postgres.sql.gz"

docker compose stop clickhouse
docker run --rm \
  -v cairn-langfuse_clickhouse_data:/source:ro \
  -v "$OUT":/backup \
  docker.io/library/alpine:3.20 \
  tar czf /backup/clickhouse-data.tar.gz -C /source .
docker compose start clickhouse

docker compose stop minio
docker run --rm \
  -v cairn-langfuse_minio_data:/source:ro \
  -v "$OUT":/backup \
  docker.io/library/alpine:3.20 \
  tar czf /backup/minio-data.tar.gz -C /source .
docker compose start minio
```

Volume names carry the project prefix `cairn-langfuse_`; verify with `docker volume ls | grep cairn-langfuse`. ClickHouse must be stopped from writing before the tar, otherwise files are captured half-written. Postgres goes through `pg_dump` and needs no stop.

Recovery: bring up an empty stack with `docker compose up -d` and wait until healthy → stop web/worker → load postgres (`gunzip -c postgres.sql.gz | docker compose exec -T postgres psql -U langfuse langfuse`) → stop clickhouse/minio and untar the archives into the corresponding volumes → start the whole stack again. Practice on a copy first; do not overwrite omarchy's live database directly.

## Cleanup

- UI: project Settings → Data Retention, dropping old traces / observations / scores / media by day count. This is the main switch for clearing application data; do not add TTLs to ClickHouse tables yourself, and do not add lifecycle rules to the MinIO media prefix (references would break).
- ClickHouse system tables (`trace_log`, `text_log`, `metric_log`, etc.) are not read by Langfuse, have no TTL by default, and disk growth is usually them rather than the business tables. `docker compose exec clickhouse clickhouse-client --user "$CLICKHOUSE_USER" --password "$CLICKHOUSE_PASSWORD" --query "SELECT table, formatReadableSize(sum(bytes)) FROM system.parts WHERE active GROUP BY table ORDER BY sum(bytes) DESC"`. Confirm it is the system tables before disabling logs or adding TTLs per the [Langfuse FAQ](https://langfuse.com/faq/all/reduce-clickhouse-disk-size).
- Stop the stack but keep data: `docker compose down`.
- Delete all volumes (irreversible): `docker compose down -v`.
- Container stdout is already rotated in compose at 20m × 3 files; do not use an external tool to truncate Docker's json-file.

## Disk usage estimate

| Item | Approximate | Notes |
|---|---|---|
| Images | ~1.6 GiB compressed, ~5–7 GiB unpacked | web+worker ~300 MiB compressed each; ClickHouse ~250 MiB; Postgres / Redis / MinIO the rest |
| Empty database just started | 1–2 GiB total across volumes | ClickHouse system tables take a chunk first |
| Omarchy light development | +1–5 GiB per month | Depends on whether spans carry large input/output |
| Official public VM | 100 GiB to start | High-traffic observability, not the local default |

Leave 15 GiB before starting; at 80% disk, enable retention first, then check the system tables. This stack is not a source of truth — if lost, the OTLP can be pushed again, so it does not need the RPO discipline of the server sqlite.

## Relationship to Cairn

`ops/langfuse/` does not enter the install package, `apps/`, or `packages/`, and adds no product dependency. Cairn behaves exactly the same when Langfuse is not configured. If a later observability ticket wants to push spans here, it goes through environment variables and defaults to off.

## Pinned images

| Service | Image |
|---|---|
| langfuse-web | `docker.io/langfuse/langfuse:4.68.0` |
| langfuse-worker | `docker.io/langfuse/langfuse-worker:4.68.0` |
| Postgres | `docker.io/library/postgres:17.11` |
| ClickHouse | `docker.io/clickhouse/clickhouse-server:25.12.11` (do not drift to 26.x, the query analyzer is incompatible) |
| Redis | `docker.io/library/redis:7.4.11` |
| code-eval-runner | `public.ecr.aws/lambda/nodejs:24@sha256:eb0de3ee81b4638149f0b1bcab2c657603a23a0c221a4b5678be29b48265bd31`, built locally with Langfuse's v4.68.0 `code-based-eval-handler.mjs` |
| code-eval-gateway | the `langfuse-worker` image running `code-eval-gateway.mjs` |
| MinIO | `cgr.dev/chainguard/minio@sha256:73297936408b731668ca0e835ac9add1a35cb6026a125c2f0cd476d9ef48222c` (MinIO no longer publishes container images, and the official Langfuse compose also switched to the Chainguard build; the Chainguard free tier only has `latest`, so it is pinned by digest) |

Upgrade: change this table and the same set of tags in `ops/langfuse/docker-compose.yml`, stop the stack, `docker compose pull`, `up -d`. Langfuse runs migrations by itself within the same major version; for a major version, read the official upgrade guide first.
