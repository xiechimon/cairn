# Offline Coordinator eval on Langfuse: prior art and migration outline (2026-11-09, rev. 2)

Decision override: the owner's later 2026-11-09 instructions supersede the recommendations below. Follow [the reviewed design](../design/eval-on-langfuse.md): hardened emulator immediately, automatic project snapshots, real cases only, existing Codex account, and owner-applied live operations. Historical observations below were supplied with this task and are not fresh runtime verification by the design author.

Question: ian approved on 2026-11-09 moving cairn's hand-rolled offline eval (`integration/eval/chief-dispatch`, `project-routing`, `memory-regression`, `.claude/hillclimb/**`) onto Langfuse Datasets, Experiments and Evaluators. Revision 2 follows his direction from the same day:

- The question bank, the evaluators, the experiment runs and the comparison all live in Langfuse.
- Cases are harvested from real Coordinator traces.
- The repo keeps only the runner that invokes the Coordinator.
- Tamper resistance comes from Langfuse RBAC, scoped keys and Langfuse's own version history.

Evidence markers: **`实测`** = read or run first-hand in this session; **`推断`** = derived from `实测` facts; **`猜测`** = everything else.

Sources:

- Repo facts were read at `origin/main` `56ac5d1a3`.
- Langfuse facts come from the running v4.68.0 containers on omarchy, inspected read-only: compiled web and worker code via `docker exec`, Postgres with `default_transaction_read_only`, and ClickHouse with `--readonly=1`. They also come from langfuse.com docs and from the langfuse/langfuse and langfuse/langfuse-js sources on GitHub.

Nothing was written to Langfuse or to live cairn.

## 1. Where the current harness stands

| Fact | Evidence |
|---|---|
| chief-dispatch has 64 cases: 44 `dispatch` and 20 `hold`. project-routing has 16: 11 `route`, 2 `ask` and 3 `answer`. memory-regression has 21. | `实测`, `.claude/hillclimb/*/cases.json` |
| The chief-dispatch grader decides with `toolCalls.some(c => c.name === 'run_builds')` plus `expect.agent`. `run_builds` and `split_todo` are in `CHIEF_TOOLS_REMOVED_UNDER_D60`, and #3164 dropped agents. The 44 `dispatch` cases can therefore never pass, and the 20 `hold` cases pass on any reply. | `实测`, `integration/eval/chief-dispatch/grade.mts:34-61` and `packages/shared/src/protocol/chief-tools.ts:787-797`. The pass/fail consequence is `推断`. |
| `create_todo` on main has no dependency field. Open PR #3653 adds `blockedBy` to `create_todo` and `update_todo`, with cycle and self-block checks. | `实测`, `gh pr diff 3653` |
| `stack.mts` registers every model as `relay-186` `openai-completions` with a URL and a key. The in-server Coordinator runtime already runs `openai-codex` on subscription: with no `baseUrl` it uses `openai-codex-responses` and takes its token from `$CODEX_HOME/auth.json`. | `实测`, `stack.mts:333-351`, `apps/server/src/coordinator/runtime/provider.ts:23-27`, `apps/server/src/coordinator/codex-login.ts` |
| `eval-env.sh` reads `providers['relay-186']`, which no longer exists in `~/.pi/agent/models.json`. `cairn-eval-weekly.timer` is not installed. | `实测` |
| Real Coordinator turns are already in Langfuse. There are 282 `coordinator turn` observations: 112 in environment `live`, 168 in `default` and 2 test ones. There are also 39 `create_todo`, 34 `ask_user` and 31 `open_thread` child observations, the earliest from 2026-11-06. The turn input holds the owner's messages. `create_todo` input holds `projectId` (an id, not a name), `title` and `spec`. | `实测`, ClickHouse `events_core` |
| The Coordinator turn trace id is derived from the step id (`otlpTraceIdOfStep`). It does not follow the ambient OTel context. | `实测`, `apps/server/src/runtime-otel.ts:300-309` |
| Spec 29 §3 currently says replay, judging statistics and CI gates "stay in the repository and are never delegated to the platform", and that `integration/eval/` is the canonical question bank. ian's 2026-11-09 direction changes this (see §6). | `实测`, `docs/spec/29-evaluation-and-data-loop.md:82,90` |

## 2. Langfuse v4.68, first-hand

### 2.1 Datasets and harvesting from traces

- **Item fields:** items carry `input`, `expectedOutput`, `metadata`, `status` (ACTIVE or ARCHIVED), `sourceTraceId` and `sourceObservationId`. `实测`, `schema.prisma` `model DatasetItem`.
- **Item history:** items are versioned in place with `validFrom`, `validTo` and `isDeleted`, under primary key `(id, projectId, validFrom)`. Every edit, archive or delete therefore adds a row and keeps the old one. `实测`, schema.
- **Reading a version:** a version is read by ISO timestamp, `langfuse.dataset.get(name, { version })`. `实测`, [datasets docs](https://langfuse.com/docs/evaluation/experiments/datasets), langfuse-js v6.1.1 `dataset/index.ts:157,294`.
- **Recorded on each run:** the timestamp is stored per run item, as `dataset_item_version` in `dataset_run_items_rmt` and `experiment_item_version` in `events_core`. `实测`, ClickHouse `system.columns`.
- **Dataset-level gaps:** the `Dataset` row itself is unversioned. Deleting it cascades to its items. `实测`, `onDelete: Cascade`.
- **Add to dataset:**
  - *From traces:* "+ Add to dataset" on any observation. Alternatively, Observations table → filter → select → **Actions → Add to dataset**, with field mapping (whole field, JSONPath, or a custom object). This runs as a background batch with partial success. `实测`, docs.
  - *Through the API:* `createItem` with `sourceTraceId` and `sourceObservationId`. `实测`, docs.
- **Annotation queues:** a queue has score configs and optional assignees. Traces, observations or sessions are added in bulk through **Actions → Add to queue**. Reviewers score each item and press "Complete + next". The public API exposes `annotation-queues`, `/{queueId}/items` and `/{queueId}/assignments`. `实测`, [annotation queues docs](https://langfuse.com/docs/evaluation/evaluation-methods/annotation-queues) and the route files in the web container. The docs do not describe adding queue items to a dataset or editing an expected output from the queue. `实测`, docs silent.
- **Corrections:** a "Corrected output" on a trace or observation is stored as a score with `dataType: "CORRECTION"` and `name: "output"`. It can be read back through the scores API. The docs do not say it maps into a dataset's expected output. `实测`, [corrections docs](https://langfuse.com/docs/observability/features/corrections). The harvesting step therefore copies a correction into `expectedOutput` by hand or through a helper. `推断`

### 2.2 Experiments through the SDK with our own task

- `langfuse.experiment.run({ name, runName, description, metadata, data, task, evaluators, runEvaluators, maxConcurrency = 50, datasetVersion })`, or `dataset.runExperiment(...)`. `实测`, [`ExperimentManager.ts` v6.1.1](https://github.com/langfuse/langfuse-js/blob/v6.1.1/packages/client/src/experiment/ExperimentManager.ts) lines 113-194 and 278.
- **How the links are built:**
  - Each item runs inside `startActiveObservation("experiment-item-run")`.
  - The experiment context (`experimentId`, `experimentDatasetId`, `experimentItemId`, `experimentItemVersion`, run metadata, `experimentItemRootObservationId`) is propagated as OTel attributes to every span opened inside `task`.
  - Langfuse builds the dataset run from those ingested events. **A run** = one `experimentId`, stable over `(projectId, datasetId, runName)`. **An item** = one dataset item id. **A trace** = the `experiment-item-run` root span plus its children. **Scores** = `score.create({ traceId, observationId })` on that root.
  - `实测`, `ExperimentManager.ts:421-566, 830-845`.
- SDK evaluators receive `{ input, expectedOutput, output, metadata }`, not the trace. `实测`. A failed task is logged and skipped (`Skipping item.`), not scored. `实测`, lines 281-287.
- Consequence for cairn: the real turn's spans carry their own trace id. The turn trace is therefore a sibling trace, not a child of the experiment item, unless cairn stamps the experiment attributes onto the turn root (see §5). `推断`
- Langfuse also has a remote-experiment webhook (`Dataset.remoteExperimentUrl` with a signed payload) that starts an SDK experiment from the UI. `实测`, schema and [experiments via UI](https://langfuse.com/docs/evaluation/experiments/experiments-via-ui).
- `@langfuse/client` 6.1.1 depends on `@langfuse/core`, `@langfuse/tracing` and `mustache`, with peer `@opentelemetry/api`. `实测`, its `package.json`. ian approved this lockfile change on 2026-11-09.
- Conclusion: the SDK runner with our own `task` is the right tool. The task boots the eval stack, runs one real Coordinator turn and returns a structured routing decision. Langfuse holds the run, the items, the traces and the scores. `推断`

### 2.3 Evaluators: LLM-as-judge and code evaluators

- **Model:** `Evaluator` plus append-only `EvaluatorVersion` rows (unique on `evaluatorId, version`). Each version holds the prompt or `sourceCode` plus `sourceCodeLanguage` (PYTHON or TYPESCRIPT). The types are `LLM_AS_JUDGE`, `CODE`, `DECISION_MODEL` and `FACET`. Rules are attached through `EvaluationRuleEvaluatorAssignment`, and their targets include `EVENT` and `EXPERIMENT`. `实测`, schema and web chunks.
- **Versions are not pinnable:** "Updating its definition creates a new version, and active rules automatically use the latest version". `实测`, [LLM-as-a-judge docs](https://langfuse.com/docs/evaluation/evaluation-methods/llm-as-a-judge). Each execution span records `eval.template.id` and `eval.template.version`. `实测`, worker `executeCodeBasedEvaluation.js`.
- **Live state:** three LLM judges at version 3 each, created by an API key. Two rules target `event`. There are no datasets. `实测`, read-only SQL.
- **Code evaluator contract:** `evaluate(ctx)` returns `{ scores: [{ name, value, dataType, comment? }] }`. The variables are `input`, `output`, `metadata`, `toolCalls`, `experimentItemExpectedOutput` and `experimentItemMetadata`. `实测`, `CODE_EVAL_PAYLOAD_SECTION_BY_VARIABLE` in `codeEvalDispatcherTypes.js`. Limits: standard library only, no network, 2 s, source under 256 KB, payload under 5.5 MB, result under 256 KB, erasable TypeScript only. `实测`, [code evaluators docs](https://langfuse.com/docs/evaluation/evaluation-methods/code-evaluators). Executions are traced in environment `langfuse-code-eval`. `实测`, docs.
- **Current state: disabled.** The worker reads `LANGFUSE_CODE_EVAL_DISPATCHER` (enum `insecure-local` or `aws-lambda`), which is unset. Since `NODE_ENV=production`, no dispatcher is resolved, and execution throws "Code eval dispatcher is not configured". `实测`, `codeEvalDispatchers.js`, `env.js` and the worker env.

#### What enabling code evaluators takes on omarchy

The variables, all `实测` from `env.js` and the [self-hosting page](https://langfuse.com/self-hosting/configuration/code-evaluators):

| Variable | Default | Where |
|---|---|---|
| `LANGFUSE_CODE_EVAL_DISPATCHER` | unset (= disabled) | web **and** worker. The web needs it to offer code templates in the UI. |
| `QUEUE_CONSUMER_CODE_EVAL_EXECUTION_QUEUE_IS_ENABLED` | `"true"` | worker |
| `LANGFUSE_CODE_EVAL_LOCAL_TIMEOUT_MS` | `2000` | worker (`insecure-local`) |
| `LANGFUSE_CODE_EVAL_EXECUTION_WORKER_CONCURRENCY` | `5` | worker |
| `LANGFUSE_CODE_EVAL_EXECUTION_QUEUE_SHARD_COUNT` | `1` | worker |
| `LANGFUSE_CODE_EVAL_AWS_LAMBDA_ENDPOINT` | unset (real AWS) | worker (`aws-lambda`) |
| `LANGFUSE_CODE_EVAL_AWS_LAMBDA_NODE_FUNCTION_NAME` | `code-based-eval-executor-node` | worker |
| `LANGFUSE_CODE_EVAL_AWS_LAMBDA_PYTHON_FUNCTION_NAME` | `code-based-eval-executor-python` | worker |

The three ways to run it:

| Option | Sandbox | Cost and ops | Verdict |
|---|---|---|---|
| **A. `insecure-local`.** Add `LANGFUSE_CODE_EVAL_DISPATCHER: insecure-local` to the shared `x-langfuse-env` block in `ops/langfuse/docker-compose.yml` and recreate web and worker. | None. The evaluator source runs in a `node:vm` context inside the worker process (`localCodeEvalDispatcher.js`: `vm.createContext` with `console`, timers, `URL` and so on). Node's own docs say "The `node:vm` module is not a security mechanism. Do not use it to run untrusted code." Escaping the vm reaches the worker's `process.env`: database, ClickHouse and S3 credentials, `ENCRYPTION_KEY`, and the LLM connection key. TypeScript only. | No model cost. CPU on the worker; 2 s per item; 5 run concurrently. One env line. | Acceptable only if **no principal except ian** can write evaluators. `evaluator:CUD` is held by MEMBER and above and by full-access API keys. Today the `LEGACY_PROJECT_API_KEY` (used by `traj:shadow`) would effectively get code execution in the worker. Downgrade it first (§5, PR 0). `推断` |
| **B. `aws-lambda` against a local Lambda-compatible endpoint.** Langfuse's own dev stack uses the Floci emulator (`floci/floci:2.4.0-compat`) and builds the runners from `scripts/code-eval-runners/node/code-based-eval-handler.mjs`, which runs the source with `Function()`. | Isolation comes from the per-invocation container. However, Floci mounts `/var/run/docker.sock` to start the function containers. `实测`, langfuse `docker-compose.dev.yml` and `bootstrap-floci.py`. That makes it host-root-equivalent, worse than A. | One more container and its image. | Rejected. `推断` |
| **B'. `aws-lambda` against one AWS Lambda Runtime Interface Emulator container** (e.g. the official Node 24 Lambda base image running Langfuse's handler). Set `..._NODE_FUNCTION_NAME=function`, `..._AWS_LAMBDA_ENDPOINT=http://code-eval-node:8080`, and dummy AWS credentials and region. Run it on an internal compose network with no egress and no secrets in its env. | The evaluator runs in a separate container that holds no secrets and has no egress. | One small always-on container. It handles one invocation at a time, so set worker concurrency to 1. No model cost. | Untested: whether the emulator's single route `/2015-03-31/functions/function/invocations` accepts the SDK's `InvokeCommand` with `TenantId` is `猜测`. This is the hardening step after A. |
| **C. Real AWS Lambda** with tenant isolation, through the Terraform module or by hand. | The isolation Langfuse Cloud uses (128 MB, 2 s, reserved concurrency, no egress). | AWS account and billing, IAM, and egress from omarchy to AWS. | Out of proportion for one owner. `推断` |

Recommended order: **A now, guarded by RBAC** (only ian can write evaluators), then **B' as hardening** when convenient.

### 2.4 Run comparison UI

On the Experiments page you select runs, choose Compare and pick the baseline. The view shows score, cost and latency deltas, outputs side by side per item, threshold filters, and a trace peek. `实测`, docs only: [compare experiments](https://langfuse.com/docs/evaluation/experiments/compare-experiments). Not yet operated in the running UI; the proof of PR 2 does that.

### 2.5 RBAC and keys

- **User roles:**
  - VIEWER: `datasets:read`, `evaluator:read`, `experiments:read` and `scores:read`.
  - MEMBER: adds `datasets:CUD`, `evaluator:CUD`, `evaluationRule:CUD` and `scores:save`.
  - `实测`, `projectRoleAccessRights` in web chunks.
- **API-key roles** (tag `principal:apiKey`):
  - Full access: `ADMIN`, `LEGACY_PROJECT_API_KEY` ("Read and write within a single project") and `LEGACY_ORGANIZATION_API_KEY`.
  - Read-only: `VIEWER`.
  - Write-only: `INGEST` (`traces:create`, `scores:save`, `media:create`, `project:read`) and `SCORES_INGEST` (`scores:save`).
  - Other: `AI_GATEWAY`.
  - `实测`, `systemRoleAccessRights`.
- **Live state:** one OWNER (ian); one `INGEST` key and one `LEGACY_PROJECT_API_KEY` key. `实测`, read-only SQL.
- A CI key with `VIEWER` (to read the dataset and poll scores) plus `INGEST` (to write traces and scores) can neither edit nor delete datasets or evaluators. `推断`. Whether one key can hold both roles is `猜测`: the schema allows several `RoleAssignment` rows per key, but the UI has not been checked. The fallback is two keys.

### 2.6 CI guidance from Langfuse

Langfuse's CI guide:

- Run the experiment from CI and raise `RegressionError` on a threshold.
- Compare per case against an approved baseline: "Never generate the approved artifact automatically from the candidate being tested".
- Missing cases, task failures and missing evaluator results fail the gate.

`实测`, [CI/CD docs](https://langfuse.com/docs/evaluation/experiments/experiments-ci-cd). `langfuse/experiment-action` v1.0.12 installs the SDK from npm at run time and runs `experiment_path` from the checkout. `实测`, `action.yml`. In cairn that would bypass the lockfile and run the PR's own runner, so it is not used. `推断`

## 3. Harness² (Google Research)

Primary sources:

- Repo [google-research/harness2](https://github.com/google-research/harness2) (Apache-2.0, last pushed 2026-11-02). `实测`
- Paper [arXiv:2610.14224](https://arxiv.org/abs/2610.14224), "Harness²: Recursive Agent Harnessing for an Open World", Xu, Chen et al., Northwestern University and Google Cloud AI Research, submitted 2026-10-09. `实测`, abstract page.

Search path: web search for "Harness²" Google agent evaluation, then for the paper title, then `gh search repos harness2`. Third-party Medium and KDnuggets posts surfaced first and were not used as evidence. The full paper PDF was not read; the repo was.

What it does:

- It optimizes the *harness* (system prompt, guardrails, memory, tool guidance, subagents, skills, scripts, plugins) with model weights fixed.
- **Task-level recursion:** Propose–Probe–Compose. It proposes harness edits, probes them on the same task, and composes a refined harness from behavioral contrasts, without ground truth.
- **Harnessing-level recursion:** it keeps adopted harnesses and evidence-backed lessons per domain.
- Executors are OpenCode or Codex. Benchmarks are JobBench, LAB and WorkBuddy-Bench.
- `实测`, `README.md` and `docs/EXPERIMENTS.md`.

How it runs evals:

| Mechanism | Evidence |
|---|---|
| Measurement is separate from the method: "Nothing in the method imports this module" (`core/judge.py`). The judge reads outputs only after selection, and "Rubrics stay outside the improver's evidence". | `实测`, `harness2/core/judge.py`, `docs/BENCHMARKS.md:34,62` |
| A judge failure is `None`, never zero. It is excluded from the denominator and reported separately ("Failed evaluations remain unscored rather than being counted as zero"). | `实测`, `judge.py` `has_grade` and `Scored.graded`, `EXPERIMENTS.md` |
| Judging is decoupled from rollouts. A quota error (`429 RESOURCE_EXHAUSTED`) in the judge means rerunning `harness2-judge` later without rerunning the agent. "Changing the judge model changes the measurement." | `实测`, `BENCHMARKS.md:35-38` |
| Run identity: a completion marker written by the code that saw the run return, holding a fingerprint (hash of the harness tree and optionally the task inputs). A rollout from a different configuration, or for a task that has since been corrected, is never reused. | `实测`, `harness2/core/runmark.py` docstring and `fingerprint()` |
| Provenance: `scripts/check_provenance.py` verifies the sha256 of every runner and patch file against `dependencies/ASSETS.json`. | `实测` |
| Budget identity: R = 4k rollouts and P = 3k improvement sessions per task, asserted by a ledger (`BudgetError`). | `实测`, `harness2/core/ledger.py` |
| Same benchmark, executor, subset, k, mode and seed for refine, judge and report. A saved config refuses incompatible resumes. A separate `--bases` judging gives the base-harness comparison. | `实测`, `EXPERIMENTS.md` |
| Grader leakage: "a Codex rollout on JobBench downloaded its task's rubric without being instructed to". They block `huggingface.co`, `github.com` and similar hosts at the network level, not through a tool setting. | `实测`, `EXPERIMENTS.md` "Web access" |

What cairn borrows:

1. The Coordinator under test never sees the expected outputs. The runner process holds the Langfuse keys and passes them only to the SDK, never through env to the stack or its tools. The stack runs with no route to the Langfuse API.
2. Every score of a run is computed by the managed evaluator after the turn; the runner never scores.
3. An ungraded item is reported as `ungraded`. The CI gate treats it as a failure (Langfuse's rule), while the comparison report lists it separately (Harness²'s rule).
4. The run fingerprint goes into `runName` and the metadata: cairn git sha, sha256 of the Coordinator system prompt, model, thinking level, dataset version, evaluator id and version. A rerun with a different fingerprint gets a new run and never resumes an old one.
5. Budget identity: expected turns = items × repeats × arms, asserted at the end. A shortfall (quota) marks the run `incomplete` and gives no verdict.
6. Judge re-runs without rollouts: evaluator rules can be re-run on an existing experiment, so a judge fix does not re-spend Coordinator quota. The re-run path itself is `猜测` until tried.
7. Later: Propose–Probe–Compose is a candidate method for cairn's E3 harness-optimization loop on the Coordinator prompt. It is not part of this migration.

## 4. Comparison

| Source | How | Trade-offs for cairn | Link |
|---|---|---|---|
| Langfuse Datasets plus Add-to-dataset | Versioned item rows; batch add from filtered observations with field mapping; `sourceTraceId` provenance | Native harvest path from real turns, with item history kept. The dataset row can be deleted (owner only). Mapping cannot turn a `projectId` into a project name. | [datasets](https://langfuse.com/docs/evaluation/experiments/datasets) |
| Langfuse annotation queues plus corrections | Queues with score configs; corrections stored as `CORRECTION` scores | Good for ian's review pass. A correction does not become `expectedOutput` by itself. | [queues](https://langfuse.com/docs/evaluation/evaluation-methods/annotation-queues), [corrections](https://langfuse.com/docs/observability/features/corrections) |
| Langfuse SDK `experiment.run` with our task | OTel-propagated experiment context; stable run id per `runName` | The fit for running a real Coordinator turn. Needs `@langfuse/client` (approved). The turn trace is a sibling unless attributes are stamped onto it. | [ExperimentManager.ts](https://github.com/langfuse/langfuse-js/blob/v6.1.1/packages/client/src/experiment/ExperimentManager.ts) |
| Langfuse code evaluators | Managed, versioned, on `experiment` targets, with `experimentItemExpectedOutput` | Deterministic routing scores held in Langfuse. Needs a dispatcher: `insecure-local` means worker code execution for anyone who can edit evaluators. | [code evaluators](https://langfuse.com/docs/evaluation/evaluation-methods/code-evaluators), [self-host](https://langfuse.com/self-hosting/configuration/code-evaluators) |
| Langfuse LLM-as-judge | Managed and versioned; rules take the latest version | Fine for soft signals (receipt quality). Not the routing ruler. | [LLM-as-a-judge](https://langfuse.com/docs/evaluation/evaluation-methods/llm-as-a-judge) |
| Langfuse RBAC and key roles | `VIEWER`/`INGEST` keys; `evaluator:CUD` and `datasets:CUD` at MEMBER, ADMIN and legacy keys | Gives the tamper resistance once the legacy full key is retired. | web chunks `systemRoleAccessRights` |
| Harness² | Judge separate from the method, ungraded is not zero, fingerprinted runs, provenance hashes, budget identity, network block on graders | Borrow the measurement discipline. The optimizer is a later topic. | [repo](https://github.com/google-research/harness2), [paper](https://arxiv.org/abs/2610.14224) |
| promptfoo action | Before/after on changed prompt files; config read from the checkout | No protection against a PR editing its own asserts. `推断` from `src/main.ts` | [docs](https://www.promptfoo.dev/docs/integrations/github-action/) |
| OpenAI Evals | Registry YAML plus JSONL in the repo; "bump the version" by convention | Protection is code review only. | [build-eval.md](https://github.com/openai/evals/blob/main/docs/build-eval.md) |
| Braintrust | `initDataset({ version: <xact_id> })` pins a snapshot | Pins by transaction id, more precise than a timestamp. The docs say nothing on scorer protection. Docs only; SDK source not found. | [docs](https://docs.braintrust.dev/annotate/datasets/use-in-evaluations) |

## 5. Recommended pattern (rev. 2)

**Langfuse holds the ruler and the results. The repo holds only the runner. ian's account is the only principal that can change the ruler.**

### Where things live

| Piece | Lives in | Who can change it |
|---|---|---|
| Dataset `coordinator-routing` (cases) | Langfuse | ian (OWNER) in the UI. No key with `datasets:CUD` exists after PR 0. |
| Code evaluators `routing.*` | Langfuse, versioned | ian only |
| LLM judges (optional, soft) | Langfuse, versioned | ian only |
| Experiment runs, traces, scores, comparison | Langfuse | written by CI with the `INGEST` key |
| Baseline pointer (`baselineRun` in the dataset `metadata`) | Langfuse | ian only |
| Runner (`integration/eval/coordinator-routing/run.mts`) | repo, protected eval path | PR with coordinator review |

### Harvesting cases from real turns

1. **Candidates.** In the Observations table, filter `name = coordinator turn` and `environment = live`, plus the turns that have a `create_todo`, `ask_user` or `open_thread` child. Save the filter as a table view. Select candidates and use **Add to queue → `routing-review`**. The queue's score configs are `routing_correct` (boolean) and `case_worthy` (boolean). `推断`
2. **Review.** ian works through the queue. For a wrong routing he writes the right answer as the turn's **Corrected output**, in the expected-output JSON below.
3. **Add to dataset.** From the queue-reviewed turns, use **Add to dataset** with mapping: `input` = the turn input (the owner request), `metadata` = turn id, thread id and environment, and `sourceTraceId` set automatically. `expectedOutput` is then edited per item, filled from the correction when there is one, otherwise from the observed `create_todo` / `ask_user` children with project ids turned into names. `推断`
4. **Expected output shape** (names, never ids, because replay ids differ):

   ```json
   {
     "decision": "route",
     "parts": [{ "project": "docs-site" }],
     "blockedBy": [[1, 0]],
     "askCandidates": [],
     "notes": "..."
   }
   ```

   `decision` is one of `route`, `ask` and `answer`. The reviewed design removes the historical `hold` alias: both old no-dispatch reply outcomes normalize to `answer`; invalid or mixed effects remain unscored. `blockedBy` lists edges between part indexes and is scored only after #3653 merges.
5. **World snapshot.** Replay needs the projects that existed at the time of the turn. Today the turn trace does not carry them (`实测`: no project list in the `coordinator turn` metadata). Each item's `input` therefore carries `projects: [{ name, description }]` and the optional `chip`, filled during curation. A small production change, a `cairn.projects` attribute on the turn root, would make this automatic (PR 4). `推断`
6. **Seed set.** The 16 project-routing cases and the 20 chief-dispatch `hold` cases are imported once by ian as items tagged `metadata.origin = "synthetic-2026-11"`, so the first runs have coverage while harvested cases accumulate. The 44 stale `dispatch` cases are dropped. memory-regression is paused.

### Scoring

- **Routing evaluators (code, TypeScript, target `experiment`).** `routing.decision_ok`, `routing.projects_ok` (multiset of part projects), `routing.split_ok` (number of parts), `routing.ask_ok` (asked about exactly the tied candidates) and `routing.blocked_by_ok` (after #3653). They read `output` (the runner's decision record) and `experimentItemExpectedOutput`. They are pure functions within the 2 s and standard-library limits. `推断`
- **Rules.** One rule targets `experiment` with a filter on the dataset `coordinator-routing`, sampling 1. Whether rules fire on SDK-run experiments, not only UI prompt experiments, is `推断` from the event-based linking. PR 2 proves it.
- **Soft signals.** Receipt quality, if wanted, is an LLM judge with its own score name and stays outside the gate.

### The runner (the only repo code)

- It reads the dataset at a pinned version with the VIEWER role and runs `experiment.run` with `maxConcurrency: 1` for subscription models.
- `task(item)`:
  - It boots the eval stack from the **candidate** checkout. The prompt version is the git ref: `main` or the PR head.
  - It seeds the item's projects and an `openai-codex` provider (subscription, `CODEX_HOME`), or any pi provider by profile.
  - It sends the request and waits for the turn to finish, using the step status as the observable condition.
  - It returns `{ decision, parts: [{ project, title }], askCandidates, blockedBy, stepStatus, turnTraceId, promptSha256 }`.
- It writes no scores of its own. The managed evaluators score.
- **Run metadata and name:** `git_sha`, `prompt_sha256`, `model`, `provider`, `thinking`, `dataset_version`, `evaluator_versions` and `arm`. `runName` = `<arm>@<shortsha>/<model>/<fingerprint8>/r<rep>`.
- **Turn trace link:** `turnTraceId` goes into the output and the metadata. PR 4 stamps `LangfuseOtelSpanAttributes.EXPERIMENT_*` onto the Coordinator turn root when an experiment context is passed, so the experiment item opens the real turn.
- **Gate (CI):**
  - It runs from the **ruler** (main) checkout, never from the PR's copy.
  - It waits until every item of both arms has every `routing.*` score, or a timeout passes, polling scores with VIEWER.
  - It reads `eval.template.version` per score and fails if the two arms were scored by different evaluator versions.
  - It fails on missing or ungraded items. The design supersedes the historical per-item regression proposal with one exact case-cluster sign test (alpha 0.05), using three repeats per arm and reporting its limited power; see design section 3.
  - It reports an aggregate pass rate with a Wilson 95% interval.
- **Quota:** the expected turn count is asserted at the end. A quota or rate-limit stop exits as `incomplete` with no verdict. The trigger is the label `eval-coordinator` on PRs that touch the Coordinator prompt or tools, plus a weekly `schedule` run on main on the self-hosted `cairn-eval` runner.

### Tamper resistance

| Threat | Control |
|---|---|
| A PR edits cases or expected outputs | Cases live only in Langfuse. CI has VIEWER plus INGEST, with no `datasets:CUD`. Item history (`validFrom`/`validTo`) shows every edit, and each run records the dataset version it used. |
| A PR edits the scorer | The evaluators live only in Langfuse. CI has no `evaluator:CUD`. Version history is append-only. The gate checks that both arms used the same evaluator version. |
| A PR edits the runner or the gate | Both run from the default-branch checkout (`ruler/`), as in `eval-gate.yml`. Only the Coordinator under test comes from the PR. The runner path is protected (`integration/eval/**`). |
| A key with write power leaks | PR 0 retires the `LEGACY_PROJECT_API_KEY`. `traj:shadow` moves to VIEWER plus INGEST. Afterwards only ian's login can edit datasets and evaluators, which matters doubly once `insecure-local` gives evaluator authors code execution in the worker. |
| The Coordinator under test reads the answers | The keys stay in the runner process memory, not in the stack env. The eval stack has no tool that reaches the Langfuse API. Harness²'s rubric-download lesson applies. |
| Deletion of the dataset (owner only) | Covered by the Langfuse Postgres backups. That backup coverage is `猜测` and needs checking against `~/.cairn/tools/backup`. |

### Migration: what is deleted, and the order of PRs

- **PR 0 (ops, no repo code beyond docs):**
  - Create the CI key (VIEWER plus INGEST) and the `traj:shadow` key (VIEWER plus INGEST).
  - Retire the legacy full key.
  - Enable code evaluators with `insecure-local` in `ops/langfuse/docker-compose.yml`, which is a repo file, so this lands as a small protected-path PR.
  - Update `docs/ops/langfuse.md`.
  - Proof: a TypeScript evaluator scoring one test observation, and SQL showing no key with `evaluator:CUD`.
- **PR 1 (lockfile, approved):** add `@langfuse/client` 6.1.1, installed with scripts disabled and `CAIRN_ALLOW_LOCKFILE_CHANGE=1`.
- **PR 2, runner:**
  - Add `integration/eval/coordinator-routing/run.mts` and `gate.mts`, plus the `stack.mts` provider profile (`openai-codex` subscription).
  - Delete in the same PR:
    - `chief-dispatch/grade.mts`, `run-eval.mts`, `compare-prompt-sets.mts`, `baseline-record.mts`, `prompt-set.mts`'s `cut` arm and `project-routing/grade.mts`;
    - `.claude/hillclimb/{chief-dispatch,project-routing}`;
    - their `integration/test/*` tests, the `scripts/eval-capabilities.json` and feature-map rows, and `scripts/ops/eval-weekly.sh` with its systemd units.
  - Leave memory-regression in place, marked paused in `scripts/eval-capabilities.json`.
  - Update spec 29 §3 (§6 below).
  - Proof: the seed dataset run on `main` and on the PR #3688 head at the same dataset version; Langfuse Compare view screenshots; managed `routing.*` scores present on every item.
- **PR 3, CI:** add `.github/workflows/coordinator-eval.yml` with base, candidate and ruler checkouts, the label trigger plus the weekly schedule, and a PR comment linking both runs. The host step deletes `~/.cairn/tools/eval-env.sh`.
- **PR 4 (design note first):** emit `cairn.projects` on the turn root (for harvesting), and stamp experiment attributes on the turn root under an experiment context (so the item trace is the real turn).
- **PR 5 (after #3653):** ian adds `blockedBy` expectations to harvested multi-part items and the `routing.blocked_by_ok` evaluator. No repo change unless the runner's decision record lacks `blockedBy`, which PR 2 already includes.
- **Ongoing:** the routing-review queue is worked weekly. The weekly run's failures feed the next review.

## 6. Spec 29 §3, proposed wording

> Decision: OTel is the external data format. Self-hosted Langfuse holds the offline eval: datasets harvested from real traces, the evaluators that score them, experiment runs and their comparison. Only the owner account may edit datasets and evaluators; CI writes runs and scores with an ingest-scoped key, and every run records the dataset and evaluator versions it used. The repository keeps the runner that invokes the Coordinator and the CI gate, both executed from the default branch. Trajectory packs and local sqlite remain the source of truth for production state.

## 7. Open questions for ian

Already decided on 2026-11-09 and not asked again: the bank lives in Langfuse, the 44 cases are dropped, memory-regression is paused, the lockfile change is approved, `blockedBy` is scored after #3653, and the spec 29 wording changes.

1. **Code-evaluator dispatcher.** Enabling `insecure-local` gives anyone who can edit evaluators code execution inside the Langfuse worker. Recommended: enable it now, after retiring the legacy full key so that only your login can edit evaluators, then move to a separate no-egress Lambda-emulator container (B') later.
2. **Who curates.** Harvesting needs a human to confirm the right routing and to turn project ids into names. Recommended: you work the `routing-review` queue weekly, or name a second Langfuse member (MEMBER can edit datasets, which weakens the "owner only" rule).
3. **World snapshot.** Replay needs the project list at turn time. Recommended: fill it by hand during curation now, and add a `cairn.projects` attribute to the turn root in PR 4.
4. **Seed set.** Import the 16 routing cases plus the 20 `hold` cases as tagged synthetic items until harvested cases reach about 50? Recommended: yes.
5. **Runner credentials.** Recommended: the self-hosted `cairn-eval` runner gets its own Codex login (separate `CODEX_HOME`), because it executes PR code.
6. **Quota budget.** Recommended: k = 3 repeats × up to 60 items × 2 arms per labelled PR, plus one weekly main run.
