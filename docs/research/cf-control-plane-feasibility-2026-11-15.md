# User-owned Cloudflare control plane feasibility

Research date: 2026-11-15. Research only: no cloud resources, credentials, deployment, account changes or product implementation. This considers the owner's newly clarified third mode, not the existing single-host relay protocol.

## Conclusion and evidence labels

**Inferred:** A user-owned Worker plus SQLite Durable Object can provide a lightweight personal control plane for multiple outbound-connected runners. Actual agent execution and model credentials must remain on supported computers. This is a feasible target architecture, not an unchanged deployment of the current Cairn server or a verified cloud product.

**Observed** below means first-hand documentation/source inspection, not a cloud experiment. **Inferred** means derived from those sources. **Unverified** means a necessary acceptance question. Generic published pricing is not account-specific usage or remaining quota. The three modes are local-only, local service accessed through Tailscale, and a user-owned Cloudflare control plane with registered runners; the third cannot be reduced to a single privileged local host with phone clients.

## Primary-source coverage

This question concerns the Cloudflare platform rather than model-provider pricing or reference-product UX. Designated vendor sources are Workers runtime/compatibility, SQLite Durable Objects lifecycle/WebSockets/storage/pricing and the installed Cairn source. The previous [enrollment research](connect-do-enrollment-2026-11-15.md) supplies background on owner bootstrap, deployment trust, account allowances and spending controls, not acceptance of the changed multi-runner design. Web discovery uses only `agent-reach web search`; full pages use `agent-reach web read`.

| Source | Observed mechanism | Inferred fit and trade-off |
| --- | --- | --- |
| [Workers Node compatibility](https://developers.cloudflare.com/workers/runtime-apis/nodejs/) | Node API support is partial; `node:child_process` and `node:sqlite` are import-only nonfunctional stubs. | A successful import is not evidence a CLI, native database binding or agent process runs. Keep those on runners. |
| [Workers filesystem](https://developers.cloudflare.com/workers/runtime-apis/nodejs/fs/) | Filesystem support is a memory-based VFS; `/tmp` is request-local and nonpersistent. | The current local database, repositories, attachments and harness files require new storage ownership, not path substitutions. |
| [DO WebSocket Hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/), [lifecycle](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/) | Incoming connections can remain connected during hibernation; constructor memory resets; timers, unfinished requests and outbound connections interfere with hibernation. | Runners and browsers should connect into the control plane. Persist authoritative state and design recovery; do not copy local timers and in-memory hubs into a DO. |
| [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [DO limits](https://developers.cloudflare.com/durable-objects/platform/limits/) | Workers have a 128 MB isolate and Free CPU/request limits; DO invocation/storage limits are separate. | A small event-driven control plane fits in principle; no claim that the existing server or unlimited histories fit. |
| [Current DB owner](../../apps/server/src/db/client.ts) | Uses native `better-sqlite3`, synchronous Drizzle access, filesystem migrations and backups. | Port storage/services deliberately to DO SQL or another chosen cloud store; do not pretend the existing `Db` contract already targets DO. |
| [Current server bootstrap](../../apps/server/src/index.ts), [Coordinator durable store](../../apps/server/src/coordinator/runtime/durable-thread-store.ts) | Starts an in-server Coordinator, local filesystem stores, scheduler and Node HTTP listener; thread leases use periodic timers. | Move the model-driven Coordinator execution to an eligible runner as well; keep the CF control plane non-model event/state dispatch if model requests must originate on users' devices. |
| [Runner client](../../apps/daemon/src/machine-client.ts), [runner execution](../../apps/daemon/src/runner.ts), [step credentials](../../apps/daemon/src/credentials.ts) | Already separate server enrollment/claim/heartbeat/result calls from execution; some credentials arrive from the server step-token response. | Reuse existing machine identities/contracts where possible, but new local-only model credential ownership is not automatically satisfied by the current runner. Do not upload local model logins to CF to preserve the old token flow. |

## Recommended functional boundary

**Inferred:** Worker serves the web application and authenticated public entrypoints. A per-person control-plane DO can own device enrollment, task/conversation records, non-model assignment state and event routing. Multiple supported runners connect outbound; one chosen runner executes a Coordinator/model loop or a project task using locally held authorization, files and tools. One runner need not mean one continuously awake DO. A browser on a phone/tablet is a controller unless that OS/device has a supported runner implementation.

**Inferred:** When every runner is offline, the web UI can remain available and preserve a pending request, but no model or local tool task can execute. Offline/retry/runner-loss behavior needs a new reviewed claim/lease/fencing/idempotency contract; do not inherit a phone relay's single-host epoch as the complete multi-runner authority. No automatic replay of an ambiguous local side effect is implied.

**Inferred:** Retain local-only and Tailscale modes. Share product/service semantics, but do not force local users to have a CF account or use network storage. Cloud bootstrap/recovery cannot rely on loopback ownership. Model credentials staying on runners does not mean private chat/results stay off CF: the cloud control plane stores or processes them unless a separate encryption design changes that trust boundary.

## Published cost model

**Observed:** [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) includes Durable Objects in the same $5/account/month Workers Paid subscription. DO has separate usage meters, not another $5 subscription. [DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) supports SQLite DOs on Free and specifies the following generic allowances. Both official pages were read through agent-reach on the research date; an independent research subagent collected pricing, while the integrating agent checked the DO pricing text and reproduced calculations.

| Meter | Free | Paid included per month; excess rate |
| --- | --- | --- |
| Subscription | $0 | $5/account/month |
| Worker requests | 100,000/day | 10 million; $0.30/million |
| Worker CPU | 10 ms per invocation | 30 million CPU-ms; $0.02/million CPU-ms |
| DO billed requests | 100,000/day | 1 million; $0.15/million |
| DO active duration | 13,000 GB-s/day | 400,000 GB-s; $12.50/million GB-s |
| SQLite rows read | 5 million/day | 25 billion; $0.001/million |
| SQLite rows written | 100,000/day | 50 million; $1/million |
| SQLite stored data | 5 GB/account total | 5 GB-month; $0.20/GB-month |

**Observed:** Unused Free daily allowances do not carry forward and are not added on top of Paid monthly inclusions. Exceeding Free quotas fails operations; it is not a promise of uptime. Paid excess DO usage rounds up to the next pricing unit before applying the rate: the published example rounds 500,000 excess GB-s to one million. SQL deletes and alarm writes are billable writes; rows scanned/index work cannot be estimated solely from an HTTP request count. [DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)

**Inferred — illustrative workload, not measured Cairn usage:** Assume one otherwise-unused user account, one personal control-plane DO with up to five runner connections, at most 100,000 Worker requests/month, 100,000 billed DO requests/month, 10 million rows read/month, one million rows written/month and stored data kept below 1 GB including indexes/internal metadata. Paid Worker CPU must also remain within 30 million CPU-ms/month. No attachments product, hosted build overage, additional paid service or model charge is included.

| Scenario | Calculation from published units | Estimated CF charge |
| --- | --- | --- |
| Free, daily usage and CPU all within limits | Monthly workload alone cannot prove this; bursts may exceed daily rows/requests even if the month is small | Potentially $0/month |
| Paid, hibernating personal DO | Listed request/SQL/CPU quantities and duration below included allocations | $5/month |
| Paid, one DO continuously awake for 30 days | 2,592,000 seconds × 0.128 GB = 331,776 GB-s, below 400,000 included | $5/month |
| Paid counterexample: five separate always-awake DOs | 1,658,880 GB-s minus 400,000 = 1,258,880 excess; round to 2 million × $12.50 = $25, plus subscription | $30/month |

**Observed/inferred:** Cloudflare's pricing examples use 128 MB / 1 GB = 0.128 for duration. The one-object $5 result also holds under binary interpretations, but this note follows the vendor's example rather than silently substituting 128 MiB. One continuously awake DO consumes 11,059.2 GB-s/day under that convention, below 13,000 Free duration; that does not prove CPU, SQL or other quotas fit. Multiple runner connections do not require one always-awake object per runner. Hibernation remains important for headroom/multiple objects, even though it cannot reduce a $5 subscription below $5. [DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)

**Observed:** Incoming DO WebSocket messages have a 20:1 billing ratio; an upgrade is a request, outgoing messages and protocol pings are uncharged as DO requests. Duration stops when idle and eligible for hibernation, not only after actual eviction; do not add ten billed seconds to every short event. Timers and pending long-lived requests can defeat that eligibility. [Pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) [Hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)

**Observed:** Directly served [static assets](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/) have free/unlimited requests and no additional asset storage charge; Worker-first execution/SSR can incur Worker usage. Workers pricing states no additional egress charge for this Worker/DO setup. This is not a claim about all CF services. Attachments, logs, build services, extra stores and taxes are outside the example.

**Observed:** [Workers](https://developers.cloudflare.com/workers/platform/spend-management/) and [DO](https://developers.cloudflare.com/durable-objects/platform/spend-management/) now have separate account-level spending controls. Reporting/enforcement delays, stored-data charges, subscription fees and continuing messages on already-open DO WebSockets mean those controls are not a guaranteed invoice ceiling. Other applications in the account share its included allocations. A hundred independent installations do not share a single $5 plan.

**Unverified:** Measured Cairn workload, peak-day SQL writes/reads, Free CPU feasibility, operational storage headroom and actual account bill. The official DO limits page includes an inconsistent general storage table versus its Free-specific storage-full text; use a conservative below-1GB per-object pilot and do not advertise 5GB available inside one Free object. Cloud trial remains separately authorized work.

## Implementation scope and open acceptance

**Observed:** Source inspection is against `b8b6e14182ce9b94c7b72cf7c8dc280c3e80e73c`. No source code was changed or runtime tests executed for this research.

**Inferred:** A new design must cover `apps/server/src/db`, machine enrollment/claim/done and event owners in `apps/server/src/services`, the in-server Coordinator boundary, runner-side local credentials and backend execution, and the browser deployment/authentication origin. Prior relay codec/ledger/registry/ingress work can supply reviewed techniques, but its one-host/four-client protocol is not the new architecture or full API compatibility.

**Unverified:** Exact migration effort, reusable subset of synchronous services, measured CPU/SQL/duration per task, full web feature parity, supported runner OSes, browser/mobile acceptance, secure first-owner setup, multi-runner fencing/revocation/recovery, attachments/backups and unaided install. No guarantee of free availability, a maximum invoice or a finished deployment package follows from platform feasibility.

## Installed Drizzle and storage boundary

**Observed:** Additional source inspection at `fa4d98d74e186aabbf55f6c015b57bfcf1f72fd3` examined installed Drizzle 0.45.2, including `durable-sqlite/{driver,session,migrator}.{js,d.ts}`, and compared the native driver. The [Drizzle DO guide](https://orm.drizzle.team/docs/connect-cloudflare-do) confirms the entrypoint; installed source is the authority for version-specific behavior. This investigation used agent-reach for vendor discovery/retrieval and read-only local source inspection, without cloud access.

| Surface | Observed installed behavior | Porting consequence |
| --- | --- | --- |
| Shared schema and reads | `drizzle(ctx.storage, { schema })` is synchronous; `.all()`/`.get()` decode SQLite rows using shared mapping | Reuse schema and compatible query shapes; no forced global async rewrite |
| Mutation metadata | DO session `.run()` executes SQL and returns nothing, despite the database-level cursor generic; native `.run()` returns `RunResult` | Never cast DO to native `Db` or read `.changes`/`rowsWritten` from this driver result |
| Conditional mutation | Shared SQLite returning builder uses `.get()`/`.all()` | Candidate common winner-detection pattern; native code already uses returning rows in `composer-drafts.ts` |
| Transactions | DO delegates synchronous callbacks and nested transactions to `storage.transactionSync`; native driver uses transactions/savepoints | Test rollback and caught nested failure in workerd; do not infer equivalence from single-threaded execution |
| Native options | DO ignores the transaction configuration argument | Native `behavior: 'immediate'` is not a DO transaction guarantee |
| Migrations | DO migrator accepts bundled journal/SQL instead of filesystem paths and runs SQL in transactions | Native legacy data migration/bootstrap/backup is separate; replay requires runtime verification |

**Observed:** Current claim and other services branch on native `.changes`, including `machine-claim.ts`, `coordinator-steps.ts`, `coordinator-turn-snapshot.ts`, `machine-finish-step.ts`, `retry-parking.ts` and `runner-offline.ts`. Native `$client`, `prepare`, WAL pragmas, memory serialization and filesystem exports are not a shared service contract. `action-proposals.ts` relies on catching an inner rollback while retaining outer writes. These are concrete acceptance cases, not justification for another task store.

**Observed:** [DO SQLite storage](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/) supports FTS5 and `fts5vocab`, JSON and math extensions. Scoped inspection found no FTS5 virtual-table/query usage in current server source or migrations. SQL transactions use storage APIs rather than raw `BEGIN`/`SAVEPOINT`; cursor results crossing `await` have no snapshot-isolation guarantee. Materialize synchronously. The existing migration chain toggles foreign-key pragmas around table rebuilds; its success cannot be inferred from loading a fresh schema.

**Observed:** [Storage output gates](https://blog.cloudflare.com/sqlite-in-durable-objects/) delay visible success until durable writes are confirmed; this does not stop an already-running remote process. [State APIs](https://developers.cloudflare.com/durable-objects/api/state/) permit interleaving across awaits, including alarms versus requests. [Alarms](https://developers.cloudflare.com/durable-objects/api/alarms/) are one per object, at least once and can be delayed; their asynchronous setter is not automatically part of a synchronous Drizzle transaction. [Hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/) preserves socket attachments across eviction, not permanent authority or a guarantee sockets survive deployment.

**Inferred:** Keep product transitions and generation checks in the existing cloud state owner, runner journals limited to local execution/reconciliation, and all model/service dependencies behind explicit authorized operations. A matching driver does not make the current Coordinator remotely executable without replacing its direct DB, credentials, filesystem and hub dependencies. Before extracting services, enumerate claim, finish, continuation and scheduler authority. Check both credential acquisition and refresh paths. Exact cloud schemas/protocols remain subsequent reviewed work.

## Offline runtime compatibility result

**Observed in local workerd:** Four serial tests in `scripts/ops/connect-do-prototype/sqlite-compat.test.mjs` passed with installed Drizzle 0.45.2. They load the current native empty-schema DDL into a fresh SQLite DO and import the actual shared schema. JSON, boolean, default and nullable mappings survive; two competing conditional updates yield one returning-row winner and one zero-row loser; a hold rejects immediately before its boundary and accepts at equality; claims survive a runtime restart. A thrown transaction rolls back, and a caught nested failure preserves the outer writes but not the inner writes. The driver mutates a row while returning `undefined` from `.run()`, confirming the source-inspected metadata incompatibility.

**Intercepted platform mismatch:** Initial fixture initialization failed with `SQLITE_AUTH`. A reduced workerd probe isolated the unsupported operation to `PRAGMA user_version`; ordinary table creation/read succeeded. The fixture now records its version in a transactional SQL table. The retained end-to-end fixture would fail again if that unsupported pragma returned to initialization. Typechecking also intercepted the shared source's ES2023 library requirement before commit; the fixture compiler target now matches it.

**Unverified:** This is current empty-schema compatibility and representative query-shape evidence, not execution of historical migrations, the actual machine claim/routing service, owner authentication, two real runners or a cloud deployment. The test uses a synthetic unauthenticated inspection Worker on loopback only; it is not in the deployment manifest. Product tables, native server startup, Tailscale behavior and live services are unchanged.
