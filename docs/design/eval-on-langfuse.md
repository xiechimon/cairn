# Offline Coordinator evaluation on Langfuse

Status: proposed; stop after the design PR for ian's review. Scope: offline routing evaluation, not production state or the other eval families. Source: [research](../research/eval-on-langfuse-2026-11-09.md); issue #3700. Evidence terms: observed = read in this checkout; derived = proposed consequence; unverified = implementation acceptance remains open.

## 1. Decision and ownership

The owner's 2026-11-09 decisions supersede research revision 2's insecure-local, synthetic seed, manual snapshot, separate account and late telemetry proposals. Langfuse owns the real-case dataset, managed code evaluators, experiments and comparison. The repo retains the custom SDK runner and CI gate; ops configuration remains under `ops/langfuse`. Production sqlite and trajectory packs remain authoritative for production state. Only ian edits the dataset and evaluators. Implementation uses `gpt-6.1-sol`; every code head receives Codex cloud review in a fresh context.

Observed: `ops/langfuse/docker-compose.yml` pins v4.68.0; `apps/server/src/runtime-otel.ts` assigns turn trace IDs independently of ambient experiment context. Derived: context must be carried explicitly across the isolated runner/Coordinator boundary. Unverified: local Lambda compatibility, managed scoring of SDK experiments, dual-role API keys, and UI harvest mapping. These require real calls, not mocked success.

## 2. State, context and curation

| State / writer | Readers and transition | Failure behavior |
|---|---|---|
| Turn snapshot: Coordinator captures its actual visible projects before execution | Root span writes `cairn.projects` with stable source IDs, names and descriptions; add-to-dataset maps the snapshot and owner input into the item | Preserve an empty list; absent, truncated or invalid snapshots are not replayable; do not reconstruct from today's projects |
| Experiment context: trusted runner sends only attribution with the request | Turn root stamps SDK experiment ID, dataset ID, item ID/version and root-observation linkage; ordinary turns omit experiment attributes; output links `turnTraceId` | Validate context at the eval-only boundary; no ambient/global context leakage between items or ordinary turns |
| Harvest: owner operation through `routing-review` | Enqueue existing real turns, including the approximately 282 research-observed candidates; deduplicate by source observation; ian reviews, corrects and uses add-to-dataset | Historical turns without recoverable contemporaneous context stay review-only; no synthetic cases or inferred historical worlds |
| Dataset: ian confirms reviewed item | Pin dataset timestamp and selected ACTIVE item IDs before either arm; input contains request, project snapshot and routing context; expected output uses project names and part-index dependency edges | Invalid/ambiguous project names, missing expectation/context or an empty eligible dataset fail readiness; never silently skip |
| Evaluator: ian publishes managed `routing.*` versions and experiment rule | Rules sample every item; gate requires decision, projects, split and ask scores, plus blockedBy after #3653 | Missing, duplicate/conflicting, stale-version or failed scores are unscored and fail the gate; CI cannot edit the ruler |
| Run: runner creates fingerprinted experiment names | `pending -> running -> awaiting scores -> complete`; quota/task shortfall gives `incomplete`; infrastructure/evaluator failure gives a failed check | No conclusion on incomplete runs; finite deadlines, actual exit codes, no passing subset or silent resume |

Curation is the intended human judgment, not a technical context-entry step. Add-to-dataset must carry the root snapshot automatically. Corrections are explicitly mapped to expected output; queue completion alone does not publish an item. Preserve source trace/observation IDs. Never commit harvested requests or credentials to this public repository.

## 3. Execution and measurement boundary

Use `@langfuse/client` 6.1.1 `experiment.run`, concurrency 1, with a task that boots a disposable real Coordinator stack, seeds only the case's input world, submits the request, waits for terminal step status and returns normalized decisions, parts, ask candidates, dependency edges and turn trace ID. Extract decisions from real tool effects, not string matching replies. Move reusable stack code to the new runner and migrate consumers before deleting the replaced path.

The trusted default-branch runner owns SDK keys and expected answers. The evaluated process receives neither, including through environment, files, logs, inherited descriptors, sibling checkout mounts or tool/network access. Give it only `openai-codex/gpt-6.1-sol` authentication through `PI_CODING_AGENT_DIR=~/.cairn/agent-runtime`; use the existing account. Observed: the current Coordinator reads CODEX_HOME rather than this directory; verify the installed pi auth API and add one eval auth bridge without copying the account store. Isolate candidate code from host credentials except that required model access, and block routes to Langfuse and answer storage. Prove these boundaries adversarially before using an account-backed candidate run.

Resolve immutable main/base and candidate SHAs, dataset version, ordered item IDs, evaluator IDs/versions, model, thinking level, runner SHA and each arm's prompt hash into a fingerprint in `runName` and metadata. Both arms share the same items and scoring versions. Evaluators may auto-upgrade: any version drift invalidates comparison. CI reads scores and provenance; it never computes replacement scores or writes a passing grade. Langfuse retains runs and comparison.

For labeled own-repository PRs authored by `cairnwright[bot]` or `xiechimon`, execute 3 repeats x at most 60 identical cases x 2 arms. Recheck immutable head, author, repository and label before credentials are admitted. Forks and other authors never start the credentialed job. Weekly main runs use the same measurement policy without a candidate arm. A quota error stops subsequent turns, marks incomplete and emits no regression verdict. Other unscored results fail separately from scored regressions.

Proposed deterministic gate rule for review: for each required item/score, candidate failures across three repeats must not exceed base failures; any regression fails. Report per-item repeat counts and aggregate pass rates; aggregate improvement cannot hide a regressed item. A weekly main run checks completeness and required score success. Bootstrap requires at least one curated case; absence is a readiness failure, never a synthetic fallback.

## 4. Hardened managed evaluators and keys

Configure web and worker for `aws-lambda` immediately. Use the upstream Langfuse Node handler with a local AWS Lambda Runtime Interface Emulator, dispatcher endpoint on a dedicated internal network and worker concurrency 1. The evaluator container has no secrets, Docker socket, host mounts, egress proxy or route to databases/Langfuse; allow only worker invocation ingress, a read-only filesystem plus bounded scratch, dropped capabilities, resource limits and enforced invocation timeout. An internal Compose network alone is insufficient: prove evaluator-originated access to its worker peer is blocked. Dummy AWS signing values belong only to the dispatcher environment.

The upstream [v4.68 handler](https://github.com/langfuse/langfuse/blob/v4.68.0/scripts/code-eval-runners/node/code-based-eval-handler.mjs) uses Function and supplies no isolation or hard timeout. Acceptance must exercise the actual [v4.68 dispatcher](https://github.com/langfuse/langfuse/blob/v4.68.0/packages/shared/src/server/evals/awsLambdaCodeEvalDispatcher.ts) `InvokeCommand` including TenantId, handler request/result format and a managed experiment rule producing persisted scores. Exercise timeout, malformed result, payload limits, attempted network access, secret access and subsequent invocation after a timeout. If incompatible, stop with captured requests/errors for review; do not substitute insecure-local, Floci or paid AWS.

Replace traj:shadow's legacy full-access key with its demonstrated minimal read/ingest roles, verify its real read/write calls, then revoke the old key. CI uses VIEWER plus INGEST, or separate keys if roles cannot combine. Negative API probes must prove both callers cannot mutate datasets, evaluators or rules. Only the owner bootstrap session provisions these objects. Keep secrets out of commands/output; apply instructions read protected secret files rather than embedding values.

## 5. Red first and deletion

Before each behavior change, add targeted tests that fail on current main, using `--maxWorkers=4`. Cover every row in section 2, experiment context isolation, snapshot round-trip, case completeness, score/version drift, duplicate scores, quota interruption, budget limits, stale PR heads, disallowed authors, secret/answer extraction and sandbox timeout recovery. Record red/green logs. Confirm mechanisms through real SDK calls and an isolated running stack; mock tests supplement this evidence. Screenshots pair official contract, our real request/result and a clause-level verdict; compare real runs in Langfuse only after those exist.

Delete `integration/eval/chief-dispatch`, `integration/eval/project-routing`, their callers and local question banks including the 44 stale dispatch cases in the runner replacement PR. Retire old compare/baseline/grade code, workflow commands, eval-env.sh and weekly host units in the same cutover; pause memory-regression without activating a second scoring path. Migrate the observed learn, plan, memory-regression and chief-dispatch-real consumers of stack/baseline/result helpers to one shared executor first; retain unrelated eval families. Amend spec 29 section 3 to the research section 6 wording. No operational interim manual context fill, local scorer or insecure evaluator stage is introduced.

## 6. Delivery and review record

Design PR: pending creation; record its number here before handoff. This PR closes only design issue #3700, not the migration.

| Ordered PR | Complete boundary and proof |
|---|---|
| Design (this PR) | Commit supplied research and this design; coordinator-hold; stop for ian's review; no runtime edits |
| Context | Root project snapshots and experiment attribution together; prove capture, propagation and ordinary-turn isolation before harvesting |
| Ops | Hardened dispatcher and scoped-key/queue/evaluator configuration under ops/langfuse; prove end to end on an isolated v4.68 stack; produce exact apply commands for ian |
| Cutover | SDK runner, gate and CI together; remove replaced harnesses/callers, pause memory-regression, amend spec 29; use only curated real cases; split independent preparatory deletions if needed to stay below 3000 changed lines |
| Dependencies | Activate blockedBy scoring only after #3653 merges and real curated dependency cases exist; preserve edges in runner output now |

Each implementation PR starts from fresh origin/main after its predecessor merges. The approved SDK dependency change is installed with scripts disabled and committed with `CAIRN_ALLOW_LOCKFILE_CHANGE=1`. Run lint, typecheck, spec:parse and prepush; bind CI and cloud review to head. Store exact post-merge commands in `~/.cache/codex-scratch/eval-langfuse/apply.md`; ian applies live Langfuse changes. Never write the live Cairn instance. No implementation begins until this design is reviewed.

Two-way door: revert repo configuration/runner changes without deleting Langfuse history; never resurrect the retired full key. An unapplied ops deployment or missing curated dataset remains explicitly not ready. Final acceptance requires deployed SHA verification, real curated experiments and persisted managed scores, Comparison UI proof and adversarial isolation evidence. This design PR claims none of that runtime proof.
