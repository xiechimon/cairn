---
Category: After adding a required field to the trajectory-pack schema, fixtures written elsewhere with `satisfies TrajectoryPack` missed the field; only the main test was changed, so it went unnoticed
Source: #1606 (2026-10-25)
Level: 1
Safeguard: Fixtures using `satisfies TrajectoryPack` are intercepted by `pnpm typecheck`; the field is added to `packages/shared/test/blocker-handoff.test.ts`; the exporter asserts `traj:export` output carries `attribution: null`
Intercepts: 1
Recurrences: 0
Notes: Real negative control: after adding the field, typecheck reports TS2741 (blocker-handoff.test.ts line 202); whole-repo passes after adding `attribution: null`
---
