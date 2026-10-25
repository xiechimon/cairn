# 本机自托管 Langfuse v4（#1569）

OTel 是对外数据格式。Langfuse 自托管只负责看与标（trace、score、标注队列、实验对比）。本机 sqlite + 轨迹包仍是唯一真值；回放、判分统计、CI 门、harness 自我优化闭环不经过这里。

这是开发者侧可选件，compose 在 `ops/langfuse/`，**不进产品安装路径**。Cairn 本体不依赖本栈，未配置时行为不变。不用 Langfuse 云。

默认部署机器是 **omarchy**（常开）。其它常开机按同一套步骤即可。

对照：官方 compose 走浮动 tag（`langfuse:4`、`clickhouse-server:25.12`、`redis:7`）。本仓钉死具体版本，见文末「镜像钉」。

## 环境前置

- Docker Engine + Compose v2 插件。
- 建议 4 核、8 GiB 内存、本栈独占约 15 GiB 空闲盘（官方对外 VM 口径是 16 GiB RAM / 100 GiB 盘，那是高流量；omarchy 本机开发用不到）。
- 主机口 `3000`（UI + OTLP）和 `9090`（MinIO，浏览器传媒体才用）空闲。冲突时改 `.env` 的 `LANGFUSE_WEB_PORT` / `MINIO_API_PORT`，并同步改 `NEXTAUTH_URL` 与 `LANGFUSE_S3_MEDIA_UPLOAD_ENDPOINT`。
- 所有已发布端口绑在 `BIND_ADDRESS`（默认 `127.0.0.1`）。Postgres / ClickHouse / Redis / worker 不对外发布，只走 compose 网络。

## 起栈（omarchy）

在 omarchy 上从仓库根：

```sh
cd ops/langfuse
cp .env.example .env
```

`.env.example` 里的口令是占位符，不是密钥。拷完后至少换掉这些，再 `compose up`：

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

只给本机用、且接受 example 占位符时，可以跳过这段，直接起栈。绑定 LAN 之前必须换口令。

```sh
docker compose up -d
docker compose ps
curl -sf "http://127.0.0.1:3000/api/public/health"
```

`langfuse-web` 第一次会跑 Postgres / ClickHouse migration，omarchy 实测约 8 分钟，期间 health 连接被重置属正常。health 回 JSON 且 `docker compose ps` 六件套都是 healthy / running 后再往下。UI：`http://127.0.0.1:3000`。

## 建项目、拿公私钥

无头初始化（`.env` 里的 `LANGFUSE_INIT_*`）在**空库首次启动**时写入：组织 `cairn-dev`、项目 `cairn-local`、一对 pk/sk、用户 `dev@example.com`。之后改 `.env` 里的 INIT 值不会覆盖已有项目。密钥以当时写入库的那对为准——用上面脚本生成的，启动时打印过；用 example 原值则是 `pk-lf-local-dev-not-a-secret` / `sk-lf-local-dev-replace-me`。

也可以在 UI 里做：打开 `http://127.0.0.1:3000` → Sign up（无内置管理员）→ 建组织与项目 → Project Settings → API Keys → 建一对。username = public key（`pk-lf-…`），password = secret key（`sk-lf-…`）。

## OTLP 入口

路径：`POST /api/public/otel/v1/traces`（OTLP/HTTP JSON，不支持 gRPC）。

鉴权：HTTP Basic，username = public key，password = secret key。v4 实时入库还要带 `x-langfuse-ingestion-version: 4`；不带这个头，界面上可能晚大约 10 分钟才看见。

把 `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` 换成上一节拿到的那对：

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

HTTP 2xx 即接收（入队，worker 异步写 ClickHouse，几秒内可查）。打开 UI → Traces，应能看到名为 `cairn-langfuse-selfhost-probe` 的一条。这就是本票的验收动作。

命令行复核：v4 默认 events_only 模式，旧的 `GET /api/public/traces` 与 `/api/public/observations` 返回 404，要用 v2 接口：

```sh
curl -sS -u "$LANGFUSE_PUBLIC_KEY:$LANGFUSE_SECRET_KEY" \
  "$LANGFUSE_HOST/api/public/v2/observations?traceId=$TRACE_ID"
```

返回的 `data[0].name` 是 `cairn-langfuse-selfhost-probe` 即通过。

Collector / SDK 等价配置：

```sh
OTEL_EXPORTER_OTLP_ENDPOINT="http://127.0.0.1:3000/api/public/otel"
OTEL_EXPORTER_OTLP_HEADERS="Authorization=Basic $(printf '%s' "$LANGFUSE_PUBLIC_KEY:$LANGFUSE_SECRET_KEY" | base64 | tr -d '\n'),x-langfuse-ingestion-version=4"
```

## 推送轨迹包（#1570）

`pnpm traj:export` 产出的 JSONL 轨迹包，用 `pnpm traj:push` 转成 OTLP/HTTP JSON 推到上面的入口。只用公开协议，不带 Langfuse SDK，未配置 `CAIRN_OTEL_ENDPOINT` 时直接报错退出，Cairn 其它行为不受影响。

```sh
export CAIRN_OTEL_ENDPOINT="http://127.0.0.1:3000/api/public/otel"
export CAIRN_OTEL_HEADERS="Authorization=Basic $(printf '%s' "$LANGFUSE_PUBLIC_KEY:$LANGFUSE_SECRET_KEY" | base64 | tr -d '\n'),x-langfuse-ingestion-version=4"
pnpm traj:export --build <buildId> --out /tmp/pack.jsonl
pnpm traj:push /tmp/pack.jsonl
```

`CAIRN_OTEL_ENDPOINT` 末尾的 `/v1/traces` 可写可不写。`CAIRN_OTEL_HEADERS` 是逗号分隔的 `name=value`。endpoint 里内嵌的 `user:password@` 会转成 Basic 头，不会出现在输出里。

树结构：一个 build 一个 trace，根 span `invoke_agent`；每个 step 一个子 span；step 下每次模型回合是 `chat`，每次工具调用是 `execute_tool`。trace id 取 buildId 的哈希，span id 取 buildId、stepId、回合序号的哈希，同一个包重推得到完全相同的 id，Langfuse 按 id 合并，条数不变。字段名集中在 `apps/server/src/genai-conventions.ts`，约定改名只改这一处。推送前整个请求过 `redactSecrets`，打码条数在输出的 `redacted=` 里。

## 绑定本机或内网

默认 `BIND_ADDRESS=127.0.0.1`，只有 omarchy 本机进程能打到 UI 和 OTLP。

其它开发机要从 LAN 看时，把 `BIND_ADDRESS` 设成 omarchy 的内网地址（例如 `10.0.0.12`），并改：

```
NEXTAUTH_URL=http://10.0.0.12:3000
LANGFUSE_S3_MEDIA_UPLOAD_ENDPOINT=http://10.0.0.12:9090
```

`NEXTAUTH_URL` 必须等于浏览器里打开的那个 origin，否则登录回调会坏。不要绑 `0.0.0.0` 对公网；不要用 Langfuse Cloud。换绑后 `docker compose up -d` 让 web / minio 重建端口映射。

## 备份

Langfuse 的数据散在三处，缺一块就对不上：Postgres（用户、项目、密钥）、ClickHouse（trace / observation / score）、MinIO（事件载荷与媒体）。Redis 只是队列，可以不备。官方 compose 没有自带备份，本机用 volume 快照。

在 `ops/langfuse/`：

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

volume 名带项目前缀 `cairn-langfuse_`。`docker volume ls | grep cairn-langfuse` 对一下。ClickHouse 必须停写再打 tar，否则文件半截。Postgres 走 `pg_dump`，不用停。

恢复：空栈 `docker compose up -d` 等到 healthy → 停 web/worker → 灌 postgres（`gunzip -c postgres.sql.gz | docker compose exec -T postgres psql -U langfuse langfuse`）→ 停 clickhouse/minio，把 tar 解进对应 volume → 再起全栈。先在副本上练，别直接覆盖 omarchy 活库。

## 清理

- 界面：项目 Settings → Data Retention，按天数丢掉旧 trace / observation / score / 媒体。这是清应用数据的主开关；不要自己给 ClickHouse 表加 TTL，也不要给 MinIO media 前缀加 lifecycle（引用会断）。
- ClickHouse 系统表（`trace_log`、`text_log`、`metric_log` 等）Langfuse 不读，默认无 TTL，盘涨常见是它们而不是业务表。`docker compose exec clickhouse clickhouse-client --user "$CLICKHOUSE_USER" --password "$CLICKHOUSE_PASSWORD" --query "SELECT table, formatReadableSize(sum(bytes)) FROM system.parts WHERE active GROUP BY table ORDER BY sum(bytes) DESC"`。确认是系统表再按 [Langfuse FAQ](https://langfuse.com/faq/all/reduce-clickhouse-disk-size) 关 log 或加 TTL。
- 停栈留盘：`docker compose down`。
- 删掉全部 volume（不可逆）：`docker compose down -v`。
- 容器 stdout 已在 compose 里按 20m × 3 文件转；不要用外部工具截 Docker 的 json-file。

## 磁盘占用预估

| 项 | 约数 | 说明 |
|---|---|---|
| 镜像 | 压缩约 1.6 GiB，展开约 5–7 GiB | web+worker 各 ~300 MiB 压缩；ClickHouse ~250 MiB；Postgres / Redis / MinIO 其余 |
| 空库刚起 | volume 合计 1–2 GiB | ClickHouse 系统表先占一块 |
| omarchy 轻量开发 | 每月再 +1–5 GiB | 看 span 是否带大段 input/output |
| 官方对外 VM | 起手 100 GiB | 高流量观测，不是本机默认 |

起栈前留 15 GiB；盘到 80% 先开 retention，再查系统表。本栈不是真值，丢了可以再推 OTLP，不必按 server sqlite 那套 RPO 护。

## 与 Cairn 的关系

`ops/langfuse/` 不进安装包、不进 `apps/` / `packages/`、不加产品依赖。Cairn 未配置 Langfuse 时行为与现在相同。后续观测票如果要往这里推 span，走环境变量，缺省关闭。

## 镜像钉

| 服务 | 镜像 |
|---|---|
| langfuse-web | `docker.io/langfuse/langfuse:4.68.0` |
| langfuse-worker | `docker.io/langfuse/langfuse-worker:4.68.0` |
| Postgres | `docker.io/library/postgres:17.11` |
| ClickHouse | `docker.io/clickhouse/clickhouse-server:25.12.11`（不要漂到 26.x，query analyzer 不兼容） |
| Redis | `docker.io/library/redis:7.4.11` |
| MinIO | `cgr.dev/chainguard/minio@sha256:73297936408b731668ca0e835ac9add1a35cb6026a125c2f0cd476d9ef48222c`（MinIO 官方已不发容器镜像，Langfuse 官方 compose 也改用 Chainguard 版；Chainguard 免费档只有 `latest`，所以按摘要钉死） |

升级：改本表与 `ops/langfuse/docker-compose.yml` 同一组 tag，停栈、`docker compose pull`、`up -d`。Langfuse 同大版本会自己跑 migration；大版本先读官方 upgrade。
