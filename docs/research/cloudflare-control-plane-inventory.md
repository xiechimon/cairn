# Cairn server on Cloudflare Workers + Durable Objects: feasibility inventory

Date: 2026-11-01. Repo ref: `origin/main` @ `5c0659184`. Read-only study; nothing was changed.
Labels: **[measured]** = read in code or docs during this run; **[inferred]** = derived from measured facts and checkable; **[guess]** = everything else.

## 1. Summary

**Verdict: feasible, with conditions.** Running `apps/server` as a control plane in one SQLite-backed Durable Object (DO) does not need a rewrite of the query layer:
- `drizzle-orm/durable-sqlite` is a `'sync'` driver, the same mode as `drizzle-orm/better-sqlite3`, so the ~313 `.get()/.all()/.run()` call sites keep their shape [measured: `node_modules/.pnpm/drizzle-orm@0.45.2…/durable-sqlite/driver.d.ts`, `session.d.ts`].
- Its `transaction()` delegates to `ctx.storage.transactionSync` [measured: `durable-sqlite/session.js:32`].
- All 18 `.transaction(` sites in the server are synchronous [measured].

The work is in the OS-bound surface (git, files, subprocesses, long-lived connections) plus a few SQL semantic differences.

**Size:**
- L, about 15–20 PRs, if the Cloudflare variant drops server-hosted git repos and supports GitHub-kind projects only [guess].
- XL, about 25 or more PRs, if hosted repos must keep working [guess].

**Recommendation.** Run the spike in §8 first. Do not fork the server; add runtime seams instead (Db handle, BlobStore, GitOps relay, scheduler clock, stream transport) so the Node server and the Cloudflare entry share one codebase. Decide on hosted repos for the Cloudflare variant before M3.

**The 3 biggest risks**
1. **Git has no home in a Worker.**
   - Server-side git is 5 `spawn` sites in 4 files, but `runGit`/`systemGitOps` is called from 7 other files [measured].
   - It serves smart-HTTP (`git http-backend`) for `hosted` repos and reads `local` repos from disk.
   - `biome.json` bans `isomorphic-git`, the only in-Worker git option ("no http-backend/worktree face") [measured].
   - So hosted and local repos either move behind a daemon relay or are dropped in the Cloudflare variant. That is a product decision as much as an engineering one.
2. **Today's protocol keeps the DO awake all day.**
   - Three SSE channels with 15 s pings, a 75 s claim long-poll, 30 s presence and a 15 s scheduler tick mean the object never hibernates [measured cadences; inferred effect].
   - An always-active DO bills 86,400 s × 0.125 GB = **10,800 GB-s/day, 83 % of the free 13,000** [inferred arithmetic]. A second always-on tenant DO on one free account does not fit.
   - The fix is hibernatable WebSockets plus an event-driven alarm instead of a fixed tick.
3. **SQL semantic differences in correctness-critical code.**
   - 22 `.run().changes` reads in 12 files, including the compare-and-swap step claim (`machine-claim.ts:195,441`) and `machine-finish-step.ts` (5 sites) [measured]. The DO driver's `run()` returns `void` [measured: `SQLiteDOPreparedQuery.run(): void`].
   - DO SQL caps [measured: DO limits page]:
     - 100 bound parameters per query; there are 75 `inArray(` sites.
     - 50-byte `LIKE` patterns, which affects `services/search.ts`.
     - 2 MB per row.
   - Two migrations toggle `PRAGMA foreign_keys` (`0004`, `0058`) [measured].
   - The claim/finish rewrite touches the TLA+-modelled step-claim protocol (`verify-step-claim`).

**Corrections to the starting brief:**
- There are **5** real `spawn` call sites, not ~30: `lib/git.ts:24`, `fs-pick.ts:18,46`, `push-alerts.ts:52` and `harness-eval-production.ts:82`. Separately, there are **51** git invocations through the `runGit`/`systemGitOps` wrapper [measured].
- The import counts are confirmed: 38 files import `node:fs` (plus 1 `node:fs/promises`), 9 import `node:os`, 19 import `node:crypto` [measured].
- The HTTP framework is **Hono 4.13.8** on `@hono/node-server` (`index.ts:3,151`). SSE uses `hono/streaming` `streamSSE` in `routes-core.ts`, `routes-builds.ts` and `routes-machine.ts` [measured].

## 2. Cloudflare facts used (docs fetched 2026-11-01)

| Fact | Source (last updated) |
|---|---|
| From compat date `2026-08-04`, `nodejs_compat` is on by default. `node:child_process` is a **non-functional stub** (default from 2026-03-17). OS support is partial. Unsupported APIs come from unenv polyfills that throw `[unenv] … not implemented`. | workers/runtime-apis/nodejs (Aug 12, 2026) |
| `node:fs` is a virtual file system: `/bundle` is read-only, and `/tmp` is writable but **per-request, not persistent**. `/dev/*` is also available. | workers/runtime-apis/nodejs/fs (Apr 23, 2026) |
| `node:crypto` is fully supported except DSA/DH keypairs, argon2, `randomUUIDv7` and ed448/x448. | workers/runtime-apis/nodejs/crypto (Oct 17, 2026) |
| `process.env` is empty by default; configuration comes from bindings. | workers/runtime-apis/nodejs/process |
| SQL API: `exec()` cannot run `BEGIN`/`SAVEPOINT`, so transactions go through `transactionSync` (synchronous callback only). FTS5, JSON1 and math functions are available. Point-in-time-recovery (PITR) bookmarks exist, and `databaseSize` is exposed. | durable-objects/api/sqlite-storage-api (Sep 21, 2026) |
| DO limits: 10 GB per DO and 5 GB per account on Free. **CPU is 30 s per request by default**, configurable to 5 min. Rows and strings are capped at 2 MB, statements at 100 KB. **At most 100 bound params** per query, **LIKE patterns of at most 50 bytes**, 100 columns per table. Each object has a soft limit of about 1,000 req/s. | durable-objects/platform/limits (Oct 29, 2026) |
| DO Free quotas: **100,000 requests/day**, counting HTTP, RPC sessions, incoming WebSocket messages (at 20:1) and alarms. Also **13,000 GB-s/day**, 5 M rows read/day, 100 k rows written/day, 5 GB stored. Duration is billed at 128 MB while the object is active and not hibernatable, shared across concurrent requests. `setWebSocketAutoResponse` replies cost no duration. Each `setAlarm()` counts as one row written. | durable-objects/platform/pricing (Oct 18, 2026) |
| Workers Free: 100,000 requests/day, **10 ms CPU** per request, **50 subrequests per request**, 5 cron triggers, 64 MiB script size, 1 s startup. HTTP duration is unlimited, so streaming is allowed. Alarms and crons get 15 min of wall time. Runtime updates drain connections within 20 min. DOs are a kind of Worker, so Workers limits also apply. | workers/platform/limits (Oct 29, 2026) |
| Requests to static assets are free and unlimited. | workers/platform/pricing (Oct 2, 2026) |
| Hibernation WebSocket API (`ctx.acceptWebSocket`, `serializeAttachment`): no GB-s accrues while hibernated, and the constructor re-runs on wake. | durable-objects/best-practices/websockets (Oct 30, 2026) |
| Alarms: one alarm per DO at a time, delivered at least once, with 6 retries on exponential backoff. Multiple schedules are multiplexed by storing them in tables. | durable-objects/api/alarms (Apr 21, 2026) |
| Cron triggers run in UTC, and changes take up to 15 min to propagate. | workers/configuration/cron-triggers (Oct 17, 2026) |
| R2 Free: 10 GB-month, 1 M Class A and 10 M Class B operations per month, free egress. | r2/pricing (Oct 30, 2026) |
| Drizzle on DO: `drizzle(ctx.storage)`. Migrations are bundled through a wrangler `rules` glob for `**/*.sql`, and `migrate()` runs inside `ctx.blockConcurrencyWhile`. | orm.drizzle.team/docs/connect-cloudflare-do (no date shown) |

No page documents SSE served from a DO. A streamed `Response` from a DO works like any Worker response, and an open stream keeps the object active, so it cannot hibernate [inferred from the pricing footnote].

## 3. Per-module inventory (`apps/server/src`, test files excluded)

Targets:
- **as-is**: runs in the DO unchanged.
- **swap**: runs in the DO after an API swap.
- **daemon** / **orb**: moves to the daemon or an orb container.
- **R2**: moves to R2 blob storage.
- **drop**: dropped from the hosted variant.

Effort is S, M or L.

### db
| Path | What it does | Node-only dependency | Target | Effort |
|---|---|---|---|---|
| `db/client.ts` | Opens the DB, sets the WAL, busy and FK pragmas, runs migrations from a folder | `better-sqlite3`, `node:fs`, `fileURLToPath` | swap: `drizzle-orm/durable-sqlite` plus a bundled `migrations.js` run in `blockConcurrencyWhile` | M |
| `Db` type (imported by 80 files) | `BetterSQLite3Database<typeof schema>` | type only | swap: alias to `BaseSQLiteDatabase<'sync', unknown, typeof schema>` | S |
| 22 `.changes` reads: `machine-claim`, `machine-finish-step` ×5, `builds` ×3, `attachment-gc` ×2, `claude-rate-limit` ×2, `harness-eval-coordinator` ×2, `ci-loop`, `claude-subscriptions`, `attachments`, `git`, `memory`, `merge-gate/digest` | Compare-and-swap and "did it update" checks | better-sqlite3 `RunResult` | swap: `.returning({id})` with a length check; rerun `verify-step-claim` | M |
| 75 `inArray(` sites | Set filters | none, but the DO caps a query at 100 bound params | swap: chunking helper plus a lint rule | S–M |
| `services/search.ts` | `LIKE %q%` search | none, but the DO caps LIKE patterns at 50 bytes (about 16 CJK characters) | swap: cap or truncate `q`, or use FTS5 | S |
| `db/legacy-export.ts` | Dumps legacy tables to files on boot | raw SQLite, `node:fs` | drop | S |
| `db/schema.ts`, `db/seed.ts` | 47 tables; seeds the user, team and personas | – | as-is, with the seed run in the DO constructor | S |
| `reliability-report.ts`, `trajectory-export.ts` | Open the DB read-only by path | `better-sqlite3`, `node:fs` | export: write to R2 via the DO handle; report CLI: drop | M |

### Git and repo operations
| Path | What it does | Node-only dependency | Target | Effort |
|---|---|---|---|---|
| `lib/git.ts` (`runGit`, `systemGitOps`, 19 git calls) | GitOps implementation: init-bare, ls-tree, cat-file, diff, update-ref, `http-backend` | `child_process` → `git` | daemon, as a relayed `GitOps` implementation | L |
| `routes-git-hosting.ts` | Smart-HTTP for `hosted` repos at `/git/*` | `git http-backend` | drop, or orb if hosted repos are kept | L if kept |
| `services/git.ts` (18 calls) | Provisions hosted repos; reads trees, files, branches, commits and diffs for `hosted` and `local` repos; uses `homedir` | `node:fs`, `node:os`, git | `local`: daemon RPC; `hosted`: drop; github-kind: GitHub API | L |
| `services/machine-merge-landing.ts` (4 calls) | Fast-forwards a hosted repo's ref | git | drop with hosted repos, or daemon | M |
| `services/local-merge-facts.ts`, `ship-gate.ts`, `builds.ts` (one call each) | `listBranches` on `localPath` or a hosted dir | git | daemon-reported facts | M |
| `services/github-recovery.ts` | `mkdtemp`, then clones and pushes a recovery branch to GitHub | `fs/promises`, `os.tmpdir`, git | daemon task | M |
| `trajectory-outcome-backfill.ts` (4 calls) | `git log/diff` over the repos dir | git, `node:fs` | daemon task, or the GitHub compare API | M |

### Attachments and uploads
| Path | What it does | Node-only dependency | Target | Effort |
|---|---|---|---|---|
| `services/attachments.ts`, `agent-attachments.ts`, `routes-uploads.ts` | Write, read and delete files, using `realpath` and `O_NOFOLLOW` | `node:fs` | R2 behind a BlobStore seam | M |
| `services/machine-uploads.ts` | Step-session JSONL and plan uploads | `node:fs` | R2 | S |
| `services/attachment-gc.ts` | Sweeps with `readdir`, `stat`, `unlink` | `node:fs` | R2 list and delete, run from the alarm | S |
| `services/info-handoff.ts` | Writes the report file | `node:fs` | R2 | S |
| `lib/attachments-token.ts` | HMAC grants | `node:crypto` (supported) | as-is | – |

### Scheduler and timers
| Path | What it does | Node-only dependency | Target | Effort |
|---|---|---|---|---|
| `services/scheduler.ts` | 8 `setInterval`s: the 15 s tick, CI (60 s), PR feedback (60 s), intake (300 s), scheduling, outcome, export, reflect-curate. Also `setImmediate` GC batching. | process-lifetime timers | swap: one DO alarm that runs every due job and re-arms at the next due time (see #2502) | M |
| `services/schedules.ts` | `cron-parser` | – | as-is (a seam-allowed file) | – |
| `services/machine-wake-hub.ts`, `chief-questions.ts`, `push.ts`, `push-alerts.ts` (`setTimeout`) | In-request waits and backoff | – | as-is. In-memory state is lost when the DO is evicted, but callers already retry [inferred]. | S |

### SSE and push
| Path | What it does | Node-only dependency | Target | Effort |
|---|---|---|---|---|
| `routes-core.ts`, `routes-builds.ts` | Team, conversation and build SSE with 15 s pings | none, but open streams keep the DO awake | as-is in the spike; then a hibernatable WebSocket | M |
| `routes-machine.ts` | `/api/machine/stream` SSE, the claim long-poll, presence | none, but these keep the DO awake | hibernatable WebSocket (protected path) | M |
| `services/events.ts` | In-memory team and conversation hubs | – | as-is in one DO | – |
| `services/push.ts` | `web-push`, which uses `https`, `crypto.createECDH`, `asn1.js` and `jws`; VAPID keyfile written with `O_NOFOLLOW` and `fchmod` | `node:fs`, npm deps | swap: VAPID keys in a secret or SQLite. Spike `web-push` under nodejs_compat; fall back to RFC 8291 on WebCrypto if it fails. | M |
| `services/push-alerts.ts` | SMTP fallback through `curl` and a temp file | `child_process`, `fs`, `os` | drop, or an email API over `fetch` | S |

### Auth, secrets and crypto
| Path | What it does | Node-only dependency | Target | Effort |
|---|---|---|---|---|
| `lib/secret-box.ts` | AES key from a 0600 keyfile | `node:fs` | swap: Worker secret binding (protected path) | S |
| `lib/token-auth.ts` | Bearer token; trusts Tailscale login only from a loopback peer (`getConnInfo` from `@hono/node-server`) | node-server conninfo | swap: token only; drop the Tailscale path (protected path) | S |
| `config.ts` | `homedir`, data dir, token file, `process.env` | `node:fs`, `node:os` | swap: `env` bindings | S |
| `services/machines.ts` | `hostname()` for `seedLocalMachine` | `node:os` | drop the local-machine seed | S |
| `lib/{keys,ids,hash,crypto}.ts`, `api-keys.ts`, `routes-helpers.ts`, `memory.ts`, `merge-gate/digest.ts` | `randomBytes`, `createHash`, `timingSafeEqual` | `node:crypto` (supported) | as-is | – |
| `services/oauth.ts`, `github-connection.ts` | GitHub OAuth over `fetch` | – | as-is | – |

### Harness eval, MCP, Feishu, fs-pick and the rest
| Path | What it does | Node-only dependency | Target | Effort |
|---|---|---|---|---|
| `services/harness-eval-production.ts` | Spawns a detached `node scripts/harness-eval-worker.mjs` with a 1 h timeout | `child_process`, `fs` | daemon step kind, or orb | M |
| `services/harness-eval-coordinator.ts` | DB-only coordinator | – (2 `.changes` reads) | as-is apart from the `.changes` swap | S |
| `services/mcp-face.ts` | MCP server on `WebStandardStreamableHTTPServerTransport` | – | as-is [inferred: it already uses the web-standard transport] | S |
| `services/mcp-servers.ts` | Reads `~/.claude.json` | `fs`, `os` | the daemon reports it | S |
| `services/feishu.ts`, `routes-feishu.ts` | DB plus `fetch` | – | as-is | – |
| `services/fs-pick.ts` | Folder picker via `launchctl` and `osascript` | `child_process` | drop | S |
| `services/fs-list.ts` | Browses local directories for local projects | `fs`, `os` | drop, or a daemon RPC | S |
| `services/skills.ts`, `skill-import.ts`, `skill-source-store.ts` | Skills directory on disk, imports from local dirs, JSON store | `fs`, `os` | SQLite or R2; imports move to the daemon | M |
| `services/providers.ts` | `hostname()`, `~/.claude/settings.json` | `fs`, `os` | use only the daemon-reported sources, which already exist | S |
| `services/backup-status.ts` | Reads a backup status file | `fs` | drop (DO PITR replaces it) | S |
| `app.ts` | Serves the web build from disk | `fs` | Workers Static Assets | S |
| `index.ts` | node-server `serve`, signal handling, wiring | `@hono/node-server`, `process.on` | new Worker + DO entry | M |
| pino (3 imports) | Logging | pino transports | console adapter | S |
| `trajectory-{push,curate,reflect-curate,failure-replay}.ts` | Ledger and JSONL files | `node:fs` | SQLite or R2, or drop | M |
| `*-cli.ts`, `eval-*.ts` | Offline CLIs | `fs` | stay as Node CLIs; not deployed | – |

**Fine as-is:** about 130 of the 190 non-test files are DB plus `fetch` plus pure logic [inferred from the import scan]. Examples: `merge-gate/*`, `todos`, `chief*`, `notifications`, `scheduling/*`, `ci-loop` (apart from `.changes`), `issue-intake`, `pr-feedback`, `token-usage-cost`, and the `routes-*` files not listed above.

## 4. Data layer

- **Driver.** `drizzle(ctx.storage, { schema })` runs in `'sync'` mode, so query code is unchanged [measured]. The differences:
  - `run()` returns `void`, so the 22 `.changes` sites need rewriting [measured].
  - `$client` is `DurableObjectStorage` [measured].
  - The `busy_timeout` and `journal_mode` pragmas do not apply [inferred].
- **Migrations.** There are 85 `.sql` files [measured]. `durable-sqlite/migrator` does not read a folder: it takes `{journal, migrations}` from a bundled `migrations.js` that `drizzle-kit` emits for `driver: 'durable-sqlite'`, and runs everything inside one `db.transaction` [measured: `migrator.js`].
  - `PRAGMA foreign_keys=OFF/ON` in `0004` and `0058` is a no-op inside a transaction in SQLite; D1 documents `defer_foreign_keys` instead [measured: D1 foreign-keys doc]. Whether the DO accepts the pragma at all is not documented, so the spike runs all 85 files [inferred].
  - `json_insert`, `json_each` and `json_group_array` are covered by JSON1 [measured].
  - `db:check` and `drizzle-kit generate` keep one migration history for both runtimes; do not squash.
- **Transactions.** There are 18 sites, all synchronous [measured], and they map onto `transactionSync`. Inside the DO, input and output gates already serialize events, so no `busy_timeout` is needed [inferred].
- **Caps to enforce by machine check:**
  - At most 100 params per statement. Chunk `inArray` and bulk `insert().values()` (`schedules.ts:193`).
  - LIKE patterns of at most 50 bytes.
  - Rows of at most 2 MB. The largest `message.content` in the local DB is 620,287 bytes [measured], so transcript rows need a size guard or overflow to R2.
- **Layout:**
  - **Single DO per deployment (phase 2).** This matches today's model, where the process is single-team: `seed()` sets `ctx.team`, and `/git/*` rejects any `teamId !== ctx.team.id` [measured].
  - **DO per team (phase 3).** The Worker routes on team id, for example `idFromName(teamId)` behind a small directory DO or a KV map [inferred]. No cross-team queries were seen, but this was not audited. 10 GB per DO is ample.
- **Database size.** omarchy's DB size is unknown; the inventory did not ssh. The local Mac `~/.cairn/server/server.db` is **104.8 MB** as of Oct 26 [measured: read-only `dbstat`]:
  - `message` is 48.8 MB, `chief_message` 44.7 MB, `step` 2.7 MB.
  - It has 42 tables; the widest is `todo` with 25 columns.
  - Local attachments total 28 MB.

  Importing it needs a chunked dump and load (100 KB statements, 100 params) through one DO-side import RPC.

## 5. Protocol changes for the daemon

**Server-side git and filesystem work that becomes daemon work.** The precedent is `MachineSyncCommand`: the server pushes it on the machine stream and the daemon answers through `client.syncResult` (`apps/daemon/src/sync.ts`) [measured]. Generalize it into a **repo query RPC** [inferred]:
- The server pushes `{queryId, op}` and the daemon answers `POST /api/machine/repo-result/{queryId}`.
- The browser request waits on the answer, with no CPU billed while it waits.

Work that moves to the daemon:
- Reads for `local` projects in `services/git.ts`: tree, file, branches, commits and diff (about 12 ops). Without an online machine these return "machine offline".
- Branch listing for ship-gate, local-merge-facts and builds.
- Hosted merge landing (`update-ref`), only if hosted repos are kept.
- The GitHub recovery branch (clone and push), as a new step kind.
- Trajectory outcome backfill (`git log/diff`), as a daemon job or through the GitHub compare API.
- The harness eval worker, as a step kind run in an orb or on the daemon.
- MCP config and Claude settings discovery: the daemon reports them, as `claude-code` model sources already do.

**Claim long-poll (75 s) and SSE versus DO limits.**
- They fit the hard limits: HTTP duration is unlimited, and CPU counts only active time [measured].
- They do not fit the free duration budget once there is more than one DO, because any open stream or held request prevents hibernation [measured: pricing footnote].

Recommended changes:
- A machine WebSocket at `/api/machine/ws`, accepted with `ctx.acceptWebSocket`:
  - Server-to-daemon frames carry wake, sync, steer, stop and repo-query.
  - Presence comes from the socket existing, with `setWebSocketAutoResponse` ping/pong, which bills no duration.
- The claim stays a `POST`, but it becomes wake-driven with no hold (`claimHoldMs=0` in the Cloudflare variant), plus a fallback claim every 5 min.
- Heartbeats and activity posts can stay plain HTTP.
- Browser streams (team, conversation and build) move to WebSocket in a later milestone, which needs `apps/web` changes. Until then SSE keeps working, at the cost of an always-on DO.

The 15 s ping exists to beat undici's 300 s idle body timeout (comment in `routes-machine.ts`) [measured]; WebSocket auto-response replaces it. Runtime updates drain connections within 20 min [measured], so every client must reconnect with backoff. The daemon claim loop already backs off (`CLAIM_BACKOFF_CAP_MS = 30_000`) [measured].

## 6. Free-tier fit: 1 user, 3 machines, 2 browser tabs (estimate)

Cadences [measured]:
- Claim hold: 75 s.
- Daemon presence: 30 s (`machine-loop.ts:604`).
- Step heartbeat: 30 s (`runner.ts:361`).
- SSE ping: 15 s.
- Scheduler tick: 15 s.
- Web thread presence: 30 s.
- Chief in-flight poll: 3 s.

Usage assumptions [guess]:
- 8 step-hours/day in total, with one activity post every 5 s while a step runs.
- Browser tabs open 8 h/day.
- Chief turns in flight 1 h/day.
- 2,000 other page fetches/day.

| Source | Arithmetic | Requests/day |
|---|---|---|
| Claim long-poll | 86,400 / 75 = 1,152 × 3 machines | 3,456 |
| Presence | 86,400 / 30 = 2,880 × 3 | 8,640 |
| Step heartbeat | 8 h × 120/h | 960 |
| Step activity and transcript | 8 h × 720/h | 5,760 |
| Thread presence | 8 h × 120/h × 2 tabs | 1,920 |
| Chief in-flight poll | 1 h × 1,200/h | 1,200 |
| Page and API fetches, SSE reconnects | guess | ~2,100 |
| **Worker requests** | sum | **≈ 24,000 (24 % of 100 k)** |
| Scheduler alarm (DO only) | 86,400 / 15 | 5,760 |
| **DO requests** | Worker-forwarded + alarms | **≈ 29,800 (30 % of 100 k)** |

**Duration.**
- **Today's protocol:** the DO never idles, so 86,400 s × 128 MB / 1,024 = **10,800 GB-s/day (83 % of 13,000)** [inferred]. One tenant fits; a second always-on DO (21,600) does not.
- **With hibernatable WebSockets and an event-driven alarm:** an estimated 4–6 h/day active, so **≈ 1,800–2,700 GB-s** [guess].

**Rows written.** Presence updates with their index rows, heartbeats and transcript inserts come to an estimated 40–70 k/day against the 100 k cap [guess]. This is tight.

**Rows read.** If a 15 s tick scans about 1,000 rows of `step`/`todo` per tick, that is 5.76 M/day, over the **5 M cap** [guess]. Measure this in the spike, then add indexes or gate the tick on due times.

**Subrequests.** Free allows 50 per invocation [measured]. A CI or feedback sweep that touches more than about 10 PRs in one alarm can exceed that [inferred], so split sweeps across alarm runs.

**Storage.** The DB is 104.8 MB [measured] against 5 GB, and attachments are 28 MB [measured] against R2's 10 GB.

**Verdict.**
- Requests fit comfortably.
- Duration fits for one tenant only.
- Rows read are the unknown the spike must measure.

## 7. Seam check: what the port must keep

From `biome.json` `noRestrictedImports` [measured]:
- **GitOps seam:** "GitOps seam = a thin wrapper that spawns system git; `simple-git` / `isomorphic-git` explicitly not introduced". The Cloudflare port implements the `GitOps` interface in `packages/shared/src/git-ops.ts` as a **daemon-relayed** implementation. It must not pull in `isomorphic-git` unless the user overrides that rule.
- **MCP SDK:** consumed only by `services/mcp-face.ts` on the server and by `apps/daemon/src/backend/` on the daemon. The face already uses the web-standard transport, so it stays the single bridge.
- **`cron-parser`:** only in `services/scheduler.ts` and `services/schedules.ts`. The alarm-driven scheduler must keep living in those files.
- **Agent SDKs** (`@earendil-works/*`, `claude-agent-sdk`, ACP, OpenTelemetry): only in `apps/daemon/src/backend/**`. The port moves no agent execution to the server, and `backend/` stays as it is, including `command-gate.ts`.
- **`apps/daemon/src/backend/`** is the GitOps/MCP/LLM-provider seam. New daemon RPC handlers (repo-query, recovery) belong in daemon top-level modules like `sync.ts`, not in `backend/`.
- **Protected paths the port must touch** (CLAUDE.md, ADR 0021 D4 class ⑤): `lib/{secret-box,token-auth,attachments-token}.ts`, `routes-machine.ts`, `services/machine*.ts`, `services/mcp-face.ts`, `apps/daemon/src/machine-client.ts`. These need `/security-review`, are owner-routed, and cannot be auto-merged.
- **New seams to add so both runtimes share the code:**
  - `Db` handle (a type alias).
  - `BlobStore` (filesystem or R2).
  - `StreamTransport` (SSE or hibernatable WebSocket).
  - `SchedulerClock` (`setInterval` or an alarm).
  - `RuntimeConfig` (env and fs, or bindings).

## 8. Phased plan

**Spike (1–2 PRs, a throwaway branch is fine).** The smallest end-to-end path:
- A Worker routes to one SQLite DO.
- The DO runs `drizzle(durable-sqlite)` with the 85 migrations bundled, and the existing `seed()` runs.
- Two routes work: `GET /api/teams/:id/todos` and `POST /api/machine/tasks/claim` (with hold).
- An unmodified daemon claims a step from `wrangler dev`.

Done when:
- All 85 migrations apply under miniflare, with the `PRAGMA` behavior recorded.
- The daemon log shows `Online … polling` and a claim that returns `{step:null}` after the hold.
- DO CPU per claim is read from `wrangler tail`.
- `web-push` imports and signs a payload under nodejs_compat, or the failure is recorded.
- Rows read per scheduler tick are measured with `cursor.rowsRead`.

**M1 Data seam (2–3 PRs).**
- The `Db` alias.
- The 22 `.changes` sites move to `.returning()`.
- An `inArray` chunk helper and a lint rule.
- The LIKE cap and a row-size guard.

Done when: the Node server passes the full test suite on the new code, the `verify-step-claim` TLC run is green, and a vitest runs a migration and a claim against miniflare's DO SQLite.

**M2 Runtime entry (2 PRs).**
- A Worker+DO entry, with config from bindings.
- `secret-box` reads its key from a secret, and auth is token-only.
- The web build is served as Static Assets, with a console logger.

Done when: `wrangler dev` serves the web app and an authenticated browse of todos works, and the Node entry is unchanged.

**M3 Git decision and relay (3–4 PRs, or 6+ if hosted repos are kept).**
- Product decision first: GitHub-only in the Cloudflare variant (recommended), or hosted repos through the daemon or an orb.
- A daemon repo-query RPC for local projects.
- Recovery and outcome backfill become daemon tasks.

Done when: the project file, branch and diff pages work on the Cloudflare stack for a github-kind and a local-kind project, with the daemon online, and show a clear error with it offline.

**M4 Blobs (2 PRs).** A BlobStore seam with filesystem and R2 implementations, covering attachments, step sessions, info reports, trajectory exports and GC.

Done when: upload, download and GC round-trip through R2 in `e2e:affected` against `wrangler dev`.

**M5 Scheduler (1–2 PRs).** An alarm multiplexer with per-job due times; shares the design of #2502. Sweeps are split to stay at or under 50 subrequests.

Done when: a 24 h soak on Free shows no alarm errors, and rows read stay under 2 M/day.

**M6 Streams (2–3 PRs).**
- A machine WebSocket with hibernation, auto-response presence and a wake-driven claim.
- Later, a browser WebSocket.

Done when: an idle stack shows the DO hibernating in metrics, a 24 h soak stays under 3,000 GB-s, and wake-to-claim latency stays under 2 s.

**M7 Deploy to Cloudflare (2 PRs).**
- `wrangler.jsonc` with DO, R2 and assets bindings.
- A Deploy button. That the button provisions the bindings is a guess.
- First-run token setup, and a DB import tool.

Done when: a stranger's fresh account deploys from the README button and enrolls a daemon, with walk-through evidence under `docs/verify/<ticket>/`.

**Phase 3 (not sized).**
- A DO per team behind a directory DO, with per-tenant quotas.
- On one Free account only one always-on tenant fits (§6), so phase 3 assumes the Paid plan or tenants that hibernate.
