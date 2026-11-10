# Legacy categories and title-only worker metadata

Follow [spec 15](../../../../docs/spec/15-untitled-new-task-view-and-fixed-tag-vocabulary.md) and the [approved cutover](../../../../docs/research/thread-category-runtime-cutover-3481.md). Ordinary workers name tasks only. GitHub labels and Git release tags are separate capabilities.

## Sub-features

- Ordinary naming: the first implementation step receives title-only metadata schema/instructions.
- Retired category inputs: fail before mutation, including when sent through the real Claude Code SDK host bridge.
- Vocabulary retirement: GET/POST project categories return 404; REST/Coordinator project creation and startup seed no categories.
- Assignment retirement: REST/Coordinator/MCP and canonical services reject stale `tagIds` before any writes, including actual SDK calls; unrelated REST/MCP keys retain their existing ignored behavior.
- Staged compatibility: only legacy read/storage and lifecycle cleanup remain; title-only calls and dedicated-label edits preserve legacy correction classification and associations.

## How to get to it (user POV)

Dispatch an ordinary task. Its authenticated machine claims the first implementation step and calls `set_task_meta({title})`. The task title updates; its body and legacy classification remain. Later steps cannot rename it; worker calls retain sealed owner titles and request text.

## Driving it with verify-cairn

Preconditions: use an isolated server, an enrolled test machine and a first implementation step. No real model or GitHub account is needed for this contract.

1. Run `apps/server/test/category-assignment-retirement.test.ts`: shared schemas, twelve task-write entry paths, real MCP SDK and in-server Pi validation, complete-state rejection and unrelated-key compatibility. Also run `packages/shared/test/task-request.test.ts`, `chief-tools.test.ts` and `memory-tools.test.ts` for direct schema-catalog consumers and the frozen routing allowlist. Run daemon `worker-meta-sdk.test.ts` and `acp-tools.test.ts` for the remaining real transport boundaries.
2. Run `apps/server/test/category-vocabulary-retirement.test.ts`: four REST project kinds, both supported Coordinator creation shapes, absent vocabulary routes and preservation of existing correction rows/links. Exercise production startup/restart on an isolated database for the no-backfill observation.
3. Run `apps/server/test/task-meta.test.ts`: claim, naming, stale arguments and full-state atomicity for ordinary and sealed-owner tasks.
4. Run `apps/daemon/test/task-meta-prompt.test.ts` and `worker-meta-sdk.test.ts`: title-only prompt/schema and real SDK argument forwarding to canonical validation.
5. Run `apps/server/test/github-issues.test.ts` and `github-writeback.test.ts`: dedicated label selection and imported-title finality remain intact.
6. Run `apps/daemon/test/tag-tool.test.ts` and `runner-create-tag.test.ts` for the unrelated Git release tool.

For a complete scoped run, pass the named files explicitly without `--changed`. For the changed subset, put `--changed` last: `vitest run <files> --changed`; otherwise its optional since-ref can consume the first filename. Confirm a non-empty reported test count before calling either run green.

These are automated regressions. Live acceptance additionally drives authenticated claim/metadata HTTP endpoints and real SDK `tools/call` against the isolated server, reading SQLite before/after; record provider mode and limits alongside evidence.

## Gotchas

Generic category vocabulary, seeding/backfill and assignment writers are removed. Read-only legacy membership still participates in correction classification until its final provenance snapshot. Existing fixture-only fixed-vocabulary data stays until final fixture/model removal. Retained `tagIds` representation is not a current UI or ordinary-worker category capability.

`node .claude/skills/verify-cairn/scripts/vp.mjs drive tags fixed-vocab-untitled` is **stale**, targeting retired board filters/chips. Use current task-creation e2e for placeholder naming instead of forcing this historical category driver. Historical evidence under `docs/verify/309/` is retained.
