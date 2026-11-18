# Retire branch sync

Decision (owner, 2026-11-18, #5336): retire branch sync completely. Zero clients (Web, iOS, CLI, Coordinator, MCP) invoke `POST /api/builds/:id/branch-sync` or read the `['branchSync']` query key; the web sync UI was already removed and only the wire, service, daemon handler and SSE layers remain.

## State before

`branch_sync` table (added by 0009) written by `POST /api/builds/:id/branch-sync` (`services/branch-sync.ts#createBranchSync`) and transitioned by `POST /api/machine/sync-result/:syncId` (`transitionBranchSync`) as the daemon's `performSync` (`apps/daemon/src/sync.ts`) reports running/synced/failed. Read by `GET /api/builds/:id/branch-sync` (`latestBranchSyncForBuild`) and the `branch_sync` team-stream event (`TeamStreamHub.publishBranchSync`). The machine stream carries the command as the `sync` event (`machineSyncCommandSchema`), pushed by `MachineWakeHub.pushSync`; the daemon's machine-loop `deliverSync` dispatches it. `projectRunningWork` in `services/projects.ts` counts pending/running rows as deletion blockers.

## Change

- Migration `0198_*`: `DROP TABLE branch_sync` — plain drop; existing `build` rows are unaffected (the foreign key points from `branch_sync` to `build`, not the other way).
- Shared: delete `records/branch-sync.ts` and its index export; drop `branchSyncEventSchema` from `sse.ts` (union member + SSE_CHANNELS note); drop `machineSyncCommandSchema`, `machineSyncResultBodySchema`, `machineSyncResultResponseSchema`, the `sync` member of `machineStreamEventSchema`, and the `MACHINE_WIRE_EXTENSIONS` sync-result entry; drop `branch_sync` from `DB_TABLES` and `INTERNAL_ONLY_TABLES`.
- Server: delete `services/branch-sync.ts`; remove the two routes-builds handlers, the machine sync-result route, `publishBranchSync`, `MachineWakeHub.pushSync`, and the `branch_sync` clause of `projectRunningWork`; drop the `branchSync` table from `db/schema.ts`.
- Daemon: delete `src/sync.ts`; remove `deliverSync` and the `ev.type === 'sync'` dispatch from `machine-loop.ts`; remove `MachineApi.syncResult` from `machine-client.ts`; remove `gitPrim.checkout` (only `performSync` called it).
- Web: drop `['branchSync']` from `STREAM_QUERY_KEYS`, the `branch_sync` invalidation case, and the orphaned `同步` translation key.
- Tests: delete `apps/daemon/test/sync.test.ts`; strip sync stubs from the 30 daemon test harnesses and `orb-relay.test.ts`'s refused-method list; remove the two `branch-sync` running cases from `project-delete.test.ts`, the `branch_sync` assertion from `schema.test.ts`, the two routes from `wire.test.ts`, the `branchSync` key from `sse-guards.test.ts`, the `branch_sync` assertions from `sse-team-events.test.ts`, and the `DB_TABLES` expectation from `vocabulary.test.ts`; rewrite `machine-offline-grace` test 14 on `pushRepoArchive`/`pushComputer`; add an upgrade migration test that migrates up to `0197_*`, seeds `team/project/todo/build/branch_sync` rows, migrates to head, and asserts the build row survives and the table is gone.
- Verify skill: delete `features/branch-sync.md`, `scripts/drive-branch-sync.mjs` and the `branch-sync` registry entry (`setup-branch-sync-seed.mjs` stays — `failed-send/restart-with-feedback` still uses it); drop the branch-sync code path, route and verify entry from the `thread-pr-panel` feature-map row and its summary mention.

## Failure paths

- Upgrade: a DB with `branch_sync` rows keeps every `build` row; only the table drops. Verified by the new migration test.
- Stale daemons reporting a result: `POST /api/machine/sync-result/:syncId` answers 404 like any unknown machine route.
- Stale servers pushing `sync` on a machine stream: a daemon built before this change ignores unknown event types it cannot parse — the event no longer exists, so nothing is dispatched.
- Project deletion: `projectRunningWork` no longer counts pending/running syncs; builds, steps, computer calls and autonomous-merge admissions still block deletion.

## Out of scope

`apps/server/src/legacy/agent-layer/schema.ts` keeps its frozen `branch_sync` copy (erased at compile; the file is removed by #5347). Historical migrations, snapshots, research docs, spec booklets and verify-skill changelogs stay untouched. `gitPrim`'s other primitives stay — `clone`/`fetch`/`hasRemoteBranch`/`hasLocalBranch`/`resetHard`/`cleanFd` still serve `workspace.ts` and the repo cache.
