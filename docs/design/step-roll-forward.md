# Keep the writable step format on failed activation

Prerequisite for row #36, the additive step split. This is a High-risk release change. It does not add the side tables, change persisted task values, remove columns, or change the runner protocol.

## User scenario

An update that fails before moving storage can still roll back as today. If it moved storage, activating an incompatible previous binary can silently strand step changes. Keep the live file and retry forward automatically. The guarded updater keeps the host stopped or the failed desktop candidate selected while it waits; it never claims writable recovery. A legacy controller's structurally readable fallback and database write fence are exercised only in the later additive release. No manual user step, password, or bridge.

## Scope

1. Use the SQLite trigger `step_require_writer_generation_update` as the only format marker. Probe `sqlite_master` with `sqlite3 -readonly`, WAL visible, and return `present`, `absent`, or `error`; a rollback probe error holds, but a watcher detection probe error only logs and leaves the running service alone. A prior/staged artifact supports the marker if its installed `drizzle/*.sql` contains that exact trigger creation (host `<release>/drizzle`, desktop `<bundle>/Contents/Resources/server/drizzle`); missing or unreadable SQL is not proof. Neither an HTTP 200 nor the controller's own checkout identifies the selected artifact.
2. Share one stop-then-decide rule in each platform. Host `previous_may_open_live_db` is used by `roll_back`, `restart_previous` after a possible target start, and normal interrupted recovery. For a present marker and a marker-aware previous artifact, or an absent marker, preserve ordinary comparator/snapshot policy. Otherwise hold before changing links, Runner checkout or live DB; unconfirmed stop holds without probing the file. Leave the app link and Runner checkout on the failed candidate. `restoring`/`restored` already committed to an eligible snapshot under this decision; resume the previously journaled replacement before startup, never treat a missing live DB mid-restore as fresh or eligible for repair. Route any repair/possible marked hold before HTTP lease acquisition; do not go through generic rollback. Freeze lease cleanup on hold, including HTTP and the SQLite fallback, until a confirmed repair. On desktop one async executor accepts confirmed embedded-child/resident stop, WAL-safe marker probe, and restored artifact capability. Both foreground `armVersionGuard` and headless `runHeadlessProbation` use it before calling either swap; `stopped:false` cannot touch either bundle. Do not stop remote or foreign servers.
3. Self-host recovery uses the existing deploy lock and journal. Record `repair-required` with `target`, `previous`, `release`, `previous_release`, `runner_previous`, `snapshot` and reason. Watcher reads it before fetch, link resolution or same-SHA exit. Detect a legacy code-only rollback best-effort from a readable live marker plus incompatible active artifact. Do not infer lossless recovery for a legacy-started writer in this prerequisite; the later release must prove a DB-side backstop. Only repair with a nonempty readable marked live file, confirmed local stops and a verified marker-aware immutable candidate; no HTTP lease or stale-claim drain on the stopped repair path. If the live file is missing, hold and alert, never initialize an empty DB. Persist candidate and `repairing` before switching. Resume that exact healthy local server/Runner (absent Runner is a no-op) or stop again and retry eligibility. Do not start old code or replace the live DB on failed repair. A held target may retry once after a committed migration (persisted `retried=1`); afterwards wait for a different compatible green SHA. Release the frozen lease and report success only after matching health; clear state only after durable success. Keep original artifact/snapshot references pinned until then.
4. Desktop hold atomically sets `installed:null`, `blocked` to the failed version, `notice:null`, and records `repair` under the existing update lock. Pin the original previous bundle at `.cairn-previous/held-<attemptId>/Cairn.app` and its snapshot as `repair.pinnedApp`/`pinnedSnapshot`, outside the reusable previous slot. Record the destination before the atomic move; on interrupted hold finish or verify that move without discarding either file. `verifyStaged`, foreground launch cleanup/confirmation, snapshot cleanup and headless confirmation must not delete pins. Keep candidate selected so its existing launchd verifier works without an embedded boot/menu. Return `repair-held` and map to existing `failed` status plus existing update log, not restored notice. While repairing, take the update lock, re-read hold/attempt, require confirmed resident stop (or verified absence), then bypass only the obsolete lease and busy calls. Use the same feed and signature verification and require marker-aware replacement. Failed attempts keep hold, pinned originals and no restored-version notice even if the failed candidate could read the layout. Re-read attempt and owner before finalize; a stale callback cannot clean up. Only the exact local replacement's sustained health clears the hold and authorizes deleting pins. No new feed or manual recovery command.
5. The later additive rollout must rehearse the unchanged past binaries and actual old update controllers too. If the prior controller cannot automatically activate a later signed build from a legacy read-only fallback (including a stranded claimed step), it is not eligible for the additive rollout until the automatic transition has been demonstrated. Installing or configuring a bridge by hand is not an allowed exit. The subsequent destructive rollout has the stricter per-install guard evidence described in the main plan. No staged migration permits, backup restore format changes, broad downgrade facility, schema epoch, or column changes in this prerequisite.

## States and owners

| State | Writer | Reader / next |
|---|---|---|
| Ordinary candidate | Existing deploy or desktop updater | Existing probation; normal rollback if no live marker |
| Marked live file, incompatible previous artifact | Later storage migrator | Existing rollback owner probes after confirmed stop; guard may retain the stopped matching target, not claim an old writer started |
| Repair pending | Self-deploy journal or desktop update attempt | Watcher or existing signed background feed installer selects the next compatible verified candidate, not old code |
| Repair started | Exclusive deploy/update owner | Recorded attempt verified using its local server and configured Runner; restart finishes it or keeps hold |
| Writable | Same current owner after health | Record success before removing hold; existing retention applies afterwards |

The marker is not a write-authorization token. It diagnoses an on-disk layout and does not make an old process capable of writing it. Reads remain available where old code can open it. Existing comparator still governs ordinary rollback when the marker is absent; do not infer no accepted writes from the presence or absence of backfilled rows.

## Edge cases

| Edge case | User-visible result and exact test oracle | Proving test | Slice/Status |
|---|---|---|---|
| Failed host candidate after marker and accepted writes | `failed health with fenced step storage does not certify legacy rollback as writable`: preserve sentinel and snapshot; no previous start; repair-required journal and result. Red observed on mini `8e081ed70`: start list includes previous. | `scripts/ops/deploy-self.test.mjs` | this change |
| Only backfill, no domain writes; or unknown probe | `marked backfill and unknown probe never certify an old writer`: same hold, no guessed snapshot restore. Ordinary rollback tests are controls. | `scripts/ops/deploy-self.test.mjs` | this change |
| Already journaled restore is interrupted; live file missing in repair | `interrupted restore phase resumes the selected snapshot and repair refuses a missing live DB`: no re-probe of halfway restore, no empty DB startup. A failed stop freezes the lease row without a write. | `scripts/ops/deploy-self.test.mjs` | this change |
| Watcher sees failed active SHA, interrupted repair, no Runner, or stranded claim | `watcher rolls forward a held database without waiting for a stale lease`: compatible green artifact only, sentinel retained, no HTTP lease/drain on the stopped host, restart resumes or keeps the journal. | `scripts/ops/deploy-self.test.mjs` | this change |
| Resident candidate adds the marker and fails | `does not re-activate an old bundle as writable when a failed update fenced the step store`: exact `repair-held`, only target start, no restored notice, persisted hold with original bundle and snapshot pins. | `apps/desktop/scripts/background-update.test.ts` | this change |
| Desktop later compatible signed release; blocked probe; stale foreground callback | `held update retries the next compatible signed build without stale busy` and `late probation cannot release another attempt's repair`: automatic new activation from the existing feed, local-only acknowledgment, keep hold while compatible build absent/failing. Foreground and resident use the same decision. | `apps/desktop/scripts/background-update.test.ts` | this change |
| An unchanged installer skipped the guard build and rolls back on the expanded file | Real previous sealed artifact, attempt legacy write (reject), observe an automatic later compatible activation and accepted new write with all prior data present; test before additive rollout, not inferred from an HTTP probe. Use the additive release's proving test when that file lands. | `scripts/ops/deploy-self.test.mjs` | later: additive deployment gate |

Ordinary rollback controls include marker absent **and marker present with a marker-aware previous artifact** on both platforms; assert the existing restored/rolled-back-code result from the unchanged write comparator. The shared desktop stop/probe decision has a direct unconfirmed-stop test; the foreground caller's stop and guard placement are checked, not inferred from headless behavior. The host red fixture also pins the active link, unchanged Runner identity, snapshot and all journal fields used by recovery.

## Verification

Heavy commands only on mini or CI, including reviewer tests. The observed reds use the existing self-deploy/desktop rollback entry points with isolated SQLite fixtures; they do not claim to be a packaged old-to-new rehearsal. Require dedicated real rollout rehearsal before the subsequent data move. For this release run full affected suites and exercise a normal production deployment by expected SHA on mini without deliberately breaking the real server.

## Out of scope

- Stable feed policy, manual bridges, runtime legacy synchronization, and new OS services.
- A general rollback protocol or a physical schema migration. Current product wire and healthy task behavior stay unchanged.
- Making a failed candidate a prerequisite for another user-controlled upgrade.

## Review

- Verdict: PASS
- Plan-SHA256: 3b283b5e7a00ec303d11bbf148473c2730a372b2513cf8f29bc83b45ad7b5de5
- Author-Model: openai-codex/gpt-6.2-sol
- Reviewer-Model: anthropic/claude-sonnet-5-5
- Reviewer: independent plan review and confirm-only re-stamp
- Findings: all prior findings confirmed addressed; rollout rehearsal remains a requirement of the subsequent release.
