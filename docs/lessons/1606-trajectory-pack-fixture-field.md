---
Category: After adding a required field to the trajectory-pack schema, fixtures written elsewhere with `satisfies TrajectoryPack` missed the field, and changing only the main test hid it
Source: #1606 (2026-10-25)
Level: 1
Safeguard: `satisfies TrajectoryPack` fixtures are blocked by `pnpm typecheck`; the field went into `packages/shared/test/blocker-handoff.test.ts`; the exporter asserts `traj:export` output carries `attribution: null`
Intercepts: 1
Recurrences: 0
Notes: real negative control: after adding the field, typecheck reported TS2741 (blocker-handoff.test.ts line 202); repo-wide pass after adding `attribution: null`
---
