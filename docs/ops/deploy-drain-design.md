# Self-deploy starvation repair (#3609)

## 1. Evidence and scope

Read [the primary-source comparison](../research/deploy-drain-2026-11-09.md) before implementing. Measured: the deployed revision is `45f00e7f8`; successive attempts exit 75 while claimed steps remain active. Measured: the current daemon unit uses systemd's default control-group termination. Inferred: stopping that unit before a safe point can kill running work. A same-port server restart investigation must establish heartbeat and completion survival before enabling a server-only path.

## 2. One mechanism

Use an owner-authenticated server deployment lease to pause machine claims independently of runtime eligibility. Preserve the daemon for server-only changes. For changes affecting the daemon artifact, acquire the lease, wait for running daemon steps to finish within a deadline, switch services, and release the lease in an EXIT trap. Keep the explicit operator hold. Delete the old idle/stale-step policy.

The lease has an opaque deployment owner, an expiration, and explicit accepting/draining status. Read it back after acquire and release. Persist the singleton server lease in a database row containing owner, status and expiresAt. The row survives server restarts. The HTTP writer acquires or renews only its own lease; EXIT cleanup releases only its owner using the same DB row and reads it back, including when the server is unhealthy. Expiry restores accepting behavior after an uncatchable deploy interruption.

## 3. States and entry paths

| Path | Expected transition and proof |
| --- | --- |
| Server-only artifact change | Accepting throughout; no daemon stop; same live step heartbeats and completes after server restart. |
| Daemon/shared/dependency artifact change | Accepting to draining; suppress all new machine claims before counting running work. |
| Pending long poll or async claim preparation | Recheck the lease at the existing final authorization/transaction boundary; never commit a new claim after pause. |
| Existing running daemon step | Heartbeats, tools, uploads and completion remain enabled; no machine configuration changes. |
| Safe point | Zero relevant running daemon steps while pause remains owned; then stop and replace daemon. |
| Drain timeout | Nonzero exit naming starvation; release lease and verify accepting state; leave running work intact. |
| Rehearsal/build/snapshot/health/rollback failure | Preserve the original nonzero status; release owned pause in EXIT cleanup and read it back. |
| Deploy killed or lease owner lost | Bounded expiry or recovery releases only that owner's lease; never release another deployment's lease. |
| Resume fails | Report a distinct nonzero recovery failure; never record a healthy completion while claims remain paused. |

## 4. Bounds and compatibility

Use the existing deploy lock to serialize attempts. A drain deadline bounds the attempt, not an infinitely running step: timeout must resume rather than kill healthy work. The continuous-traffic regression uses finite active work and an infinite pending queue; pausing claims must let it deploy before the deadline. Classify artifact impact conservatively, covering shared code, dependencies and bundling configuration. An older server without the lease endpoint refuses daemon-affecting deployments. The first release introducing lease support is server-only and preserves the daemon; bootstrap therefore needs no drain. If restart survival cannot be demonstrated, server-only changes also require draining and bootstrap must be re-reviewed.

## 5. Decisions and validation

| Decision | Reason | Reversal |
| --- | --- | --- |
| Durable server DB lease | Coordinator approved; survives the deploy-induced restart. | Release the lease and revert its consumers. |
| Server-only bootstrap | Coordinator approved; keep the existing daemon running. | Revert the server commit without replacing the daemon. |
| Separate pause from enabledRuntimes | Runtime eligibility is user configuration, not deployment state. | Revert deployment lease implementation. |
| Retain operator hold | Explicit maintenance exclusion has a different purpose from accidental idle starvation. | Existing hold removal procedure. |
| Stop on deadline | No safe guarantee exists for unbounded work without checkpoints. | A later reviewed checkpoint design. |

Implementation: Codex `gpt-6.1-sol`. Required review: Coordinator design review before lifecycle code; Codex cloud code review bound to the PR head. Add `coordinator-hold` if machine dispatch paths change. Run red-first regressions on current main, targeted Vitest with `--maxWorkers=4`, lint, typecheck, spec parsing and prepush. Validate real restart survival and the failure/resume path before rollout.

## 6. Delivery

Issue: [#3609](https://github.com/xiechimon/cairn/issues/3609). PR: [#3624](https://github.com/xiechimon/cairn/pull/3624). Coordinator approved this design in the implementation conversation on 2026-11-09, requiring durable DB state and a proven server-only bootstrap. Design review and progress reports return through that conversation; never write them into a live Cairn Coordinator or owner thread.
