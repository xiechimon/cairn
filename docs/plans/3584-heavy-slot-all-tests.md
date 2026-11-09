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
| Hold a kernel flock on each permanent slot guard FD | Atomic kernel ownership removes stale-file check/unlink races; Python only bridges the unavailable Node API | Revert allocator change, never delete guard files while runners exist |
## 3. States and transitions
Unadmitted -> queued -> held -> released. Admission must finish before workers, builds, or web servers start. A lease belongs to the runner process; multiple configurations in that process reuse it. Each slot has one permanent `slot-N.lock.guard` inode. Node opens it without truncation or unlinking and passes its FD as child descriptor 3 to a synchronous Python `fcntl.flock(3, LOCK_EX | LOCK_NB)` call. Python exits after acquisition; Node retains the same open-file-description and therefore the kernel lock throughout the lease. Closing the owning FD, or process death, releases the kernel lock. No process explicitly unlocks a duplicated FD.

An acquisition uses the existing FIFO queue and a unique socket-backed ownership record containing token, socket path, PID, PID namespace and cwd. Listen before publishing its queue ticket. Ticket names include the token to distinguish equal namespace-local PIDs. The socket remains open through waiting and holding, unreferenced so it does not keep a finished runner alive. Connection success establishes listener liveness without an application-level reply. Only ENOENT or ECONNREFUSED proves a foreign listener absent; other probe failures reject admission. Socket paths remain short regardless of slot-directory length.

After acquiring a slot's kernel guard, inspect the existing JSON owner record while retaining the guard. A live legacy owner prevents admission: close the candidate guard FD and continue waiting. Otherwise overwrite the owner record under the held kernel guard. The kernel guard, rather than an asynchronous stale-record observation, serializes all new claimants. Delete the replaced exclusive-create/stale-unlink/reclaiming-file implementation entirely; metadata liveness remains for queue cleanup, diagnostics and migration compatibility, not a second allocator.

Python status 75 means only EAGAIN/EWOULDBLOCK contention. Spawn errors, signals and other nonzero statuses fail with their original diagnostics. Close candidate FDs on busy, live-legacy-owner and failure paths; retain only a successful lease's FD. Release synchronously verifies the token and removes its metadata before closing the guard FD, so a subsequent holder cannot have its record removed by the old owner. Socket and queue cleanup remain ownership-safe. Process exit closes the retained FD; forced death requires no guard-file deletion. A valid inherited lease is reused only when its namespace matches and the owner is self or a verified ancestor; reuse never closes the parent's FD.
## 4. Readers, writers and failures
| Path | Reads/writes | Expected behavior and test |
|---|---|---|
| Every root/package/alternate configuration | Admit before workers or webServer | Concurrent real Vitest runs serialize; Playwright cannot start its server while occupied |
| Screenshot harness overlay | Copy admission and its runtime dependency closure alongside all four configs | Real Playwright CLI collects each overlaid configuration on an old tree without the admission module |
| e2e:affected and prepush wrappers | Forward commands only | No duplicate acquisition; runner config owns admission |
| cairn-heavy host wrapper | Delegate to shared lease CLI | Same directory and inherited lease |
| CI admission | Read directory existence | Absent directory bypasses without creating it; present directory queues |
| Claim and queue | Permanent guard FD with kernel flock, JSON metadata and FIFO tickets | Holder diagnostics include pid and cwd; concurrent and delayed claimants never overlap; guard inodes are never unlinked |
| Python FD bridge | Duplicate Node FD into descriptor 3, return immediately after flock | Python exit retains the parent's lock; independent open is busy until parent FD close; only contention returns 75 |
| Cross-namespace ownership | Socket-backed metadata and tickets; namespace-independent kernel guard | A foreign live listener remains held even when its PID is invisible; dead metadata cannot cause simultaneous claims; equal foreign PIDs do not share tickets |
| Probe publication and errors | Listen before publishing any ownership record | No startup window makes a live owner stale; connection success needs no reply; permission errors and timeouts never authorize reclaim |
| Inherited ownership | Namespace and verified ancestor, including container PID 1 | Same-run reuse never releases the parent's slot; direct children and descendants of PID 1 reuse its live lease; unrelated or foreign-namespace metadata cannot bypass admission |
| Legacy metadata and exit | Inspect metadata under kernel guard; remove own record before closing FD | Live legacy owner remains respected; dead owner is replaced; failed startup and process death release FD; another live owner's record survives |
| Admission I/O failure | Reject start | Real error and path propagate; no heavy work starts |
## 5. Validation and roles
Implementation: current Codex session. Design review: research delegate acting as coordinator approved module admission, namespace-aware ownership and the kernel-guard replacement before their respective implementations (see research). Code review: fresh Codex cloud review bound to PR head, maximum three rounds. Preserve the real delayed-racer negative control that produced two winners and reclaim-guard ENOENT; the replacement must make it pass. Run targeted Vitest with `--maxWorkers=4`, then lint, typecheck, spec:parse and prepush. Archive red and green runtime logs; inspect current-head CI and review before completion.
## 6. Delivery
Issue: #3584. PR: [#3601](https://github.com/xiechimon/cairn/pull/3601). Read [runtime evidence](../verify/3584/3584-evidence/result.json) and the PR head checks and Codex cloud review before accepting delivery. Local validation includes [45 allocator/entry regressions](../verify/3584/3601-kernel-evidence/result.json), 49 targeted Vitest tests and four Chromium tests. No deployment claim is made.

The first cloud review found inherited-lease deadlock when the owner is container PID 1. Two regression tests failed before extending the shared ancestor traversal to include init. The full related run passed 61 tests with two unavailable systemd-scope cases skipped. The admission regression uses a real live socket and private directory with a simulated Linux parent field; it does not claim native PID-namespace execution. Read [review-round evidence](../verify/3584/3601-init-evidence/result.json).

The second cloud review found an incomplete screenshot harness overlay: old base trees lacked the newly imported admission module and its dependencies. Four actual Playwright configuration loads failed before copying the complete runtime dependency closure; all pass after the fix. Read [overlay evidence](../verify/3584/3601-overlay-evidence/result.json).
