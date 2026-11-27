# Agent passages

Unified zero-secret agent verification across both the isolated local stack and the production Mac mini host using `scripts/ops/agent-passage.mjs` and `.claude/skills/verify-cairn/scripts/drive-agent-passages.mjs`.

## Sub-features

- `health`: verifies server reachability (`/api/user/me`), deploy SHA alignment (`--expect-sha` checked with `git merge-base --is-ancestor`), runner SHA parity on production (`cairn-runner` vs `DEPLOYED_SHA`), Coordinator core tools (`coreToolsPresent === true` via `GET /api/teams/:id/chief/diagnostics`), and local Mac runner connectivity (`hubConnected === true` and `ownComputerReady === true`, failing with `ownComputerReason` on post-restart tool drops).
- `coordinator-task`: checks Coordinator state and task creation; with `--live`, sends a deterministic `[passage-probe]` request to `POST /api/teams/:id/chief/threads`, verifies `GET /api/todos` and read-only SQLite `todo` + `chief_message` rows, and deletes synthetic probe artifacts afterward.
- `computer-run`: verifies the target runner machine (`--machine`) is `online && hubConnected`, runs or observes a build step pinned to `machineId`, verifies `build` + `step` SQLite rows, and prints OTel `traceId` (`otlpTraceIdOfBuild`).
- `chat-result`: verifies the task result appears back in Coordinator chat (`GET /api/teams/:id/chief`, `GET /api/conversations/:id/messages`, and SQLite `chief_message`) along with the Coordinator turn `traceId` (`otlpTraceIdOfTurn`).
- `top-journeys`: chains `health` -> `coordinator-task` -> `computer-run` -> `chat-result`, writes redacted `result.json` to `--out` or `VERIFY_EVIDENCE_DIR` (never inside `docs/verify/`), and automatically runs `diagnose` on any failure.
- `diagnose`: inspects `--todo`, `--build`, `--step`, or latest failed steps/builds alongside `/api/teams/:id/chief/diagnostics`, OTel `traceId`, Langfuse v4 query path (`docs/ops/langfuse.md`), and server/daemon log tails.

## How to drive with verify-cairn

Start the isolated stack first with `node .claude/skills/verify-cairn/scripts/vp.mjs launch`, then run:

- Health check: `node .claude/skills/verify-cairn/scripts/vp.mjs drive agent-passages health`
- End-to-end top journeys: `node .claude/skills/verify-cairn/scripts/vp.mjs drive agent-passages top-journeys`

To pass extra flags (such as `--live`, `--machine <name|id>`, or `--expect-sha <sha>`) through `vp.mjs drive`, append them after `--`:

```sh
node .claude/skills/verify-cairn/scripts/vp.mjs drive agent-passages top-journeys -- --live --machine <name>
```

## Direct CLI usage (local and prod)

```sh
node scripts/ops/agent-passage.mjs health --target prod --expect-sha HEAD
node scripts/ops/agent-passage.mjs top-journeys --target prod --live --out /tmp/passage-evidence
node scripts/ops/agent-passage.mjs diagnose --target prod --todo <todoId>
```

On `--target prod`, the CLI uses `ssh -o BatchMode=yes macmini` (or local execution when `CAIRN_PROD_LOCAL=1` or hostname matches `macmini`) and reads `~/.cairn-server/token` strictly inside the remote request process without printing or persisting secrets.
