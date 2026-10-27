# #1137 verification evidence: GitHub webhook → create-todo + orchestrate event-entry tracer

Three-segment tracer evidence (live stack 18/18, probe `drive-1137-webhook-tracer`) + failure-path unit tests (18/18) + affected-surface regression (89/89).

## Stack coordinates

- server: `http://127.0.0.1:8791` (verify-pacman launch.mjs isolated stack, scratch PACMAN_HOME with a fresh library)
- one real outbound call: `importGithubIssue` pulls the real issue details of `xiechimon/pacman#1137` through the gh token + label mirroring (the bedding connection row's secret lands encrypted in the DB; the token lands in no evidence file)
- bedding: github connection / agent / chief go through the service modules directly (the REST face has no connection write entry — oauth exclusive; agent creation is tightened by the #1259 home-machine gate; bedding is not the tested face, seeded the same shape as `apps/server/test/webhook.test.ts`); the project and the webhook token go through real REST

## The three segments, criteria and files

| segment | criterion | files |
|---|---|---|
| request segment | response JSON (result/todoId/threadId/deliveryId echoed) + pino log lines keyed by deliveryId in server.log | `01-created.json`, `11-tracer-server-log.txt` |
| DB segment | todo row `sourceKind=github-issue`/`sourceRef=github:xiechimon/pacman#1137` + `webhook_token.lastUsedAt` write-back + hash-only storage | `02-todo-row.json`, `03-webhook-token-row.json` |
| dispatch segment | `chief_thread` row (chiefId bound) + first user message (carrying the todo anchor) + `step` row kind=chief/pending (buildId=threadId) | `04-dispatch-rows.json` |

Failure paths (live + unit double coverage): wrong token 401 (`07-wrong-token.json`), same-delivery 60s window duplicate (`05-duplicate-window.json`), same-issue replay sourceRef persistent-gate duplicate (`06-duplicate-sourceref.json`, zero side effects: todo always 1 row / thread always 1 entry), ping noop (`08-ping.json`), non-triggering label ignored (`09-ignored-label.json`), unmapped repo misconfigured (`10-misconfigured.json`).

## Rerun recipe

```sh
node .claude/skills/verify-pacman/scripts/launch.mjs   # isolated stack 8791/5273
GH_WEBHOOK_VERIFY_TOKEN="$(gh auth token)" \
  pnpm -C apps/server exec tsx \
  ../../.claude/skills/verify-pacman/scripts/drive-1137-webhook-tracer.mjs
node .claude/skills/verify-pacman/scripts/cleanup.mjs
```

Unit tests and regression: `webhook-test-output.txt` (18/18), `regression-test-output.txt` (wire/token-auth/orchestration-source/github-issues/delivery-surface, 89/89). `result.json` is the probe's per-check ledger.
