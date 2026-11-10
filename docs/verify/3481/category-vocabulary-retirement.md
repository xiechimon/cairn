# #3481 · Category vocabulary and seeding retirement

## Scope

`GET`/`POST /api/projects/:id/tags`, REST/Coordinator project category seeding and startup backfill are removed. Legacy assignments, category records/storage and correction classification remain until their following approved cutovers. No schema, migration, provider, GitHub label, Git release tag or web rendering change.

## Real entry-point evidence

The API evidence-card driver made actual HTTP requests to isolated `apps/server/src/index.ts` production processes with separate scratch homes and owner auth off on loopback. Before ran at base `03bfe3f41aedf4dc9755527eba4ba19485089937`, not reverted implementation code. After ran the implementation; its archived probe was also rerun successfully. Images were inspected and published on asset-only commit `44d8eba0790db0d665e17a4e6b31ddfc670c8cee`.

| Observation | Before | After |
|---|---|---|
| Vocabulary read | 200 | 404, no mutation |
| Vocabulary creation | 201, one row added | 404, no mutation |
| Fresh project category count | 6 | 0 |
| Category count after restart with one legacy correction fixture | 7: legacy plus backfill | 1: exact legacy row only |
| Legacy task, category metadata and association | Exact preservation | Exact preservation |
| Correction completion | 409 | 409 |
| Foreign-key violations | 0 | 0 |

Generated request/response cards (synthetic runtime identifiers redacted from text): [before](vocabulary-live-before/card-requests.md), [after](vocabulary-live-after/card-requests.md). Restart observations: [before JSON](vocabulary-live-before/result.json), [after JSON](vocabulary-live-after/result.json). These are independent restart fixtures, not a migration or an older-database upgrade run. The legacy fixture retains mixed-case correction membership with non-default color, creation time and version.

Reproduce from the repository root using [the probe](vocabulary-probe.mts). Inspect `lsof -iTCP:18797 -sTCP:LISTEN` first; leave any holder running and choose another `VOCABULARY_PROBE_PORT`. Set `CAIRN_TEST_TEMP_ROOT` to an isolated scratch directory and run `node apps/server/node_modules/tsx/dist/cli.mjs docs/verify/3481/vocabulary-probe.mts after`. Run the same probe against the pinned base with `before` for the negative control. It uses owned processes and verifies the API user matches its own scratch database before any writes. Never target a running user's server. Redact runtime identifiers from generated text before publishing it; run `node scripts/public-content-gate.mjs --staged` before committing evidence.

## Regressions and checks

- Red first: all six initial vocabulary/creation cases failed on the base, then passed after implementation. A seventh case checks complete legacy task/category/link preservation and correction completion refusal.
- 294 targeted tests across 10 files pass; the related changed run passes 297 tests across 11 files. The isolated production-entry integration file passes both tests.
- Scoped `e2e:affected`: 37 tests pass across 10 specs, including real server fixtures, new-task flow, project settings and GitHub issue/writeback coverage. The shared-protocol full-selector fallback is left to CI, not claimed as a local full-suite pass.
- Lint, typecheck, spec parsing, feature-map generation, VP self-test and 24 prepush checks pass. Formatting was completed before the final lint pass.
- The REST snapshot removes exactly the two vocabulary entries. Existing tests use direct historical-category fixtures instead of the removed API; the shared fixed-vocabulary constant remains only for existing web/gallery fixtures.

Mocked: historical categories are inserted directly as fixtures; no provider or GitHub requests. Not covered: real model execution, third-party GitHub, authenticated external access, remaining assignment-input retirement or final data removal. The UI remains as retired in #3804. This is a two-way code rollback with no data conversion or deletion.
