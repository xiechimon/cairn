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

On first start `langfuse-web` runs the Postgres / ClickHouse migrations; measured about 8 minutes on omarchy, during which health connections being reset is normal. Continue only after health returns JSON and all six containers in `docker compose ps` are healthy / running. UI: `http://127.0.0.1:3000`.

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

## Pushing trajectory packs (#1570)

The JSONL trajectory packs produced by `pnpm traj:export` are converted by `pnpm traj:push` into OTLP/HTTP JSON and pushed to the endpoint above. It uses only the public protocol, carries no Langfuse SDK, and exits with an error when `CAIRN_OTEL_ENDPOINT` is not configured; nothing else in Cairn is affected.

```sh
export CAIRN_OTEL_ENDPOINT="http://127.0.0.1:3000/api/public/otel"
export CAIRN_OTEL_HEADERS="Authorization=Basic $(printf '%s' "$LANGFUSE_PUBLIC_KEY:$LANGFUSE_SECRET_KEY" | base64 | tr -d '\n'),x-langfuse-ingestion-version=4"
pnpm traj:export --build <buildId> --out /tmp/pack.jsonl
pnpm traj:push /tmp/pack.jsonl
```

The trailing `/v1/traces` on `CAIRN_OTEL_ENDPOINT` is optional. `CAIRN_OTEL_HEADERS` is a comma-separated list of `name=value`. A `user:password@` embedded in the endpoint is converted into the Basic header and never appears in the output.

Tree structure: one build is one trace with the root span `invoke_agent`; each step is one child span; under a step, every model turn is a `chat` and every tool call is an `execute_tool`. The trace id is a hash of the buildId, and the span id is a hash of the buildId, stepId, and turn index, so re-pushing the same pack yields exactly the same ids — Langfuse merges by id and the count does not change. Field names are centralized in `apps/server/src/genai-conventions.ts`; renaming a convention only changes that one place. Before pushing, the whole request goes through `redactSecrets`; the masked count is in the `redacted=` of the output.

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
| MinIO | `cgr.dev/chainguard/minio@sha256:73297936408b731668ca0e835ac9add1a35cb6026a125c2f0cd476d9ef48222c` (MinIO no longer publishes container images, and the official Langfuse compose also switched to the Chainguard build; the Chainguard free tier only has `latest`, so it is pinned by digest) |

Upgrade: change this table and the same set of tags in `ops/langfuse/docker-compose.yml`, stop the stack, `docker compose pull`, `up -d`. Langfuse runs migrations by itself within the same major version; for a major version, read the official upgrade guide first.
