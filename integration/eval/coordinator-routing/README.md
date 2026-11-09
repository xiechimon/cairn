# Coordinator experiment runner

Read [the research](../../../docs/research/eval-on-langfuse-2026-11-09.md) and [design section 3](../../../docs/design/eval-on-langfuse.md#3-execution-and-measurement-boundary) first. This protected runner PR does not enable evaluators, the CI gate or retire the old harness.

Run from the trusted ruler checkout with Langfuse VIEWER/INGEST credentials in its environment:

```sh
CAIRN_HEAVY_SLOTS_DIR=/tmp/cairn-heavy-slots pnpm exec tsx integration/eval/coordinator-routing/run.mts manifest.json /absolute/candidate-checkout
```

The candidate checkout must be clean, including ignored files other than node_modules; do not mount a checkout containing local secrets. The manifest names dataset, version (ISO timestamp), candidateSha, runnerSha, promptSha, evaluatorVersions, thinking, arm and repeat (1..3). promptSha hashes the candidate's `apps/server/src/services/chief.ts` prompt builder; each task also records its actual rendered promptSha256. The model is fixed to openai-codex/gpt-6.1-sol. Authentication uses PI_CODING_AGENT_DIR, defaulting to ~/.cairn/agent-runtime. Never put credentials or expected answers in the manifest.

Dataset items must be ACTIVE, carry sourceTraceId and datasetId, and contain only request, projects (unique name/description pairs) and optional chip (project name). This segment supports self-contained project-only turns; repository, prior-conversation and other state dependencies are rejected. More than 60 active cases, missing context, errors and quota stops produce incomplete runs without a verdict. No synthetic bank is shipped.

Linux Bubblewrap and its user/network namespaces are required; there is no unsandboxed fallback. The real Coordinator uses private SQLite and an owned process with finite deadlines. A Unix socket admits only the configured model origin. Worker environment and files exclude Langfuse credentials and expected output. Its network namespace cannot reach the live Cairn instance. Only the parent records experiments and flushes traces. A nonzero exit is failure; SDK-skipped tasks cannot become a successful experiment.
