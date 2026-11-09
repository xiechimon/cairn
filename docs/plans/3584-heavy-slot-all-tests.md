# Unified test admission (#3584)
## 1. Intent and prior art
Read [the research](../research/heavy-slot-all-tests-2026-11-09.md) before implementation. All repository Vitest and Playwright configurations must admit the runner through `scripts/heavy-slots.mjs`, including package-local commands and task workspace copies. No dependency or lockfile change is needed.
## 2. Decision table
| Decision | Reason | Reversal |
|---|---|---|
| Await one shared admission Promise in every config | Reuse the allocator before Playwright webServer builds; installed ESM loaders support top-level await | Revert config adapter |
| Retain the shared queue default of two slots | One conservative capacity across direct commands and the former host wrapper; CAIRN_HEAVY_SLOTS overrides it | Change the shared capacity |
| Preserve affected-run port and build isolation in configuration | Remove wrapper acquisition without changing resource ownership | Revert config resource selection |
| CI bypass requires an absent slot directory | CI on the shared host must still queue | Revert CI predicate |
## 3. States and transitions
Unadmitted -> queued -> held -> released. A dead holder becomes stale and the next claimant reclaims it under the existing reclaim lock. Admission must finish before workers, builds, or web servers start. A lease belongs to the runner process; multiple configurations in that process reuse it. Normal exit releases; forced death is reclaimed by the next waiter.
Each acquisition first creates a unique, short filesystem Unix socket and awaits its listening event, then publishes an ownership record containing token, socket path, PID, PID namespace and cwd. Slot files, queue tickets and reclaim guards use the same ownership record and liveness check. Ticket names include the token to distinguish equal PIDs in different namespaces. The socket remains open through waiting and holding; it is unreferenced so it cannot keep an otherwise finished runner alive. Probes need only a successful connection, never an application-level reply. Same-namespace records may use PID liveness; foreign-namespace records use the socket. Only ENOENT or ECONNREFUSED proves that a foreign listener is absent; other errors fail admission or retain ownership, never reclaim it. The existing partial-write grace applies to incomplete JSON, not listener startup.
Release synchronously checks the unique token before removing its own slot or ticket, then closes and removes its socket; process exit performs the same ownership-safe cleanup. A valid inherited lease is reused only when its namespace matches and the owner is the caller or a verified ancestor. Cross-namespace inherited metadata does not grant admission. Reclaim guards retain the same exclusive-file protocol and recheck the slot after taking the guard, so there is still one allocator and no second lock pool.
## 4. Readers, writers and failures
| Path | Reads/writes | Expected behavior and test |
|---|---|---|
| Every root/package/alternate configuration | Admit before workers or webServer | Concurrent real Vitest runs serialize; Playwright cannot start its server while occupied |
| e2e:affected and prepush wrappers | Forward commands only | No duplicate acquisition; runner config owns admission |
| cairn-heavy host wrapper | Delegate to shared lease CLI | Same directory and inherited lease |
| CI admission | Read directory existence | Absent directory bypasses without creating it; present directory queues |
| Claim and queue | Exclusive locks, ticket files | Holder diagnostics include pid and cwd; concurrent runs never overlap |
| Cross-namespace ownership | One socket-backed record for slot, queue and reclaim guard | A foreign live listener remains held even when its PID is invisible; a closed listener is reclaimed; equal foreign PIDs do not share tickets |
| Probe publication and errors | Listen before publishing any ownership record | No startup window makes a live owner stale; connection success needs no reply; permission errors and timeouts never authorize reclaim |
| Inherited ownership | Namespace and verified ancestor | Same-run reuse never releases the parent's slot; unrelated or foreign-namespace metadata cannot bypass admission |
| Exit and reclaim | Remove own lock or dead lock | Failure exits propagate; stale pid is reclaimed; another live owner's lock survives |
| Admission I/O failure | Reject start | Real error and path propagate; no heavy work starts |
## 5. Validation and roles
Implementation: current Codex session. Design review: research delegate acting as coordinator approved module admission before code and the namespace-aware ownership extension before its implementation (see research). Code review: fresh Codex cloud review bound to PR head, maximum three rounds. Red-first runtime regressions run on the unchanged base before implementation. Run targeted Vitest with `--maxWorkers=4`, then lint, typecheck, spec:parse and prepush. Archive red and green runtime logs; inspect current-head CI and review before completion.
## 6. Delivery
Issue: #3584. PR: pending creation. Runtime evidence and review results will be linked here after validation. No completion or deployment claim is made before those results exist.
