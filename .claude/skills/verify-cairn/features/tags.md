# Legacy categories and title-only worker metadata

Follow [spec 15](../../../../docs/spec/15-untitled-new-task-view-and-fixed-tag-vocabulary.md) and the [approved cutover](../../../../docs/research/thread-category-runtime-cutover-3481.md). Ordinary workers name tasks only. GitHub labels and Git release tags are separate capabilities.

## Sub-features

- Ordinary naming: the first implementation step receives title-only metadata schema/instructions.
- Retired category inputs: fail before mutation, including when sent through the real Claude Code SDK host bridge.
- Staged compatibility: legacy read-only membership remains until final retirement; title-only calls preserve correction classification and associations.

## How to get to it (user POV)

Dispatch an ordinary task. Its authenticated machine claims the first implementation step and calls `set_task_meta({title})`. The task title updates; its body and legacy classification remain. Later steps cannot rename it; worker calls retain sealed owner titles and request text.

## Driving it with verify-cairn

Preconditions: use an isolated server, an enrolled test machine and a first implementation step. No real model or GitHub account is needed for this contract.

1. Run `apps/server/test/task-meta.test.ts`: claim, naming, stale arguments and full-state atomicity for ordinary and sealed-owner tasks.
2. Run `apps/daemon/test/task-meta-prompt.test.ts` and `worker-meta-sdk.test.ts`: title-only prompt/schema and real SDK argument forwarding to canonical validation.
3. Run `apps/server/test/github-issues.test.ts` and `github-writeback.test.ts`: dedicated label selection and imported-title finality remain intact.
4. Run `apps/daemon/test/tag-tool.test.ts` and `runner-create-tag.test.ts` for the unrelated Git release tool.

These are automated regressions. Live acceptance additionally drives authenticated claim/metadata HTTP endpoints and real SDK `tools/call` against the isolated server, reading SQLite before/after; record provider mode and limits alongside evidence.

## Gotchas

Generic category REST/Coordinator/MCP assignment and fixed seeding/backfill remain temporarily. Retained `tagIds` representation is not a current UI or ordinary-worker category capability.

`node .claude/skills/verify-cairn/scripts/vp.mjs drive tags fixed-vocab-untitled` is **stale**, targeting retired board filters/chips. Use current task-creation e2e for placeholder naming instead of forcing this historical category driver. Historical evidence under `docs/verify/309/` is retained.
