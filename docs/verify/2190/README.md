# Restore drill #2190: verification

`scripts/ops/restore-drill.sh` restores the server DB backups into scratch and checks them. This page records what each mode proves, the real runs on omarchy, and the tests.

## Failure modes and where each is caught

| Failure mode | Caught by |
| --- | --- |
| Restored content differs from what was backed up (edited row, missing row, changed attachment byte) | `fresh` and `compare` modes; omarchy negative controls below; node tests |
| Ordinary writes between backup and check read as damage | `fresh` takes its own backup seconds before the live snapshot; dated-write rules; heartbeat allowance for three timer-written columns |
| The kept hourly backup is stale, corrupt or unreadable | `hourly` mode (age 0 to 2 hours, gzip, integrity, foreign keys, relationships, attachments, decryption, API) |
| Messages, steps, chief messages lost while rows survive | relationship sample keyed the way the server writes (messages by build id) |
| Encrypted values unreadable with the kept key | decrypt helper reads the key in place, prints only `decrypt ok` or `decrypt failed` |
| Restored DB will not serve the API | isolated createApp helper on the restored copy reads `/api/todos` and one chief thread, with an ephemeral secret box |
| The drill writes to live data or leaks the key | live DB opened read-only or through `.backup`; scratch and report paths refused inside live dirs; reports carry ids and counts only |
| The weekly run silently stops | the timer runs `fresh` then `hourly`; each writes a status line naming its mode for the morning report |

## Current behavior and content limits

The weekly timer invokes one service run. The launcher runs fresh followed by hourly, retains failure exit status from either, and writes mode-specific `RESTORE_DRILL_REPORT-fresh` and `RESTORE_DRILL_REPORT-hourly` JSON/status files with separate scratch directories. The service has no install target; only the timer has `WantedBy=timers.target`. `CAIRN_CHECKOUT`, `LIVE_DB`, `LIVE_ATTACHMENTS`, `SECRETBOX_KEY`, `RESTORE_DRILL_SCRATCH` and `RESTORE_DRILL_REPORT` configure the launcher; hourly additionally requires `BACKUP_DB` (archive file or directory) and `BACKUP_ATTACHMENTS`. Direct fresh invocation does not require kept attachments.

Fresh takes its own backup and compares it with a subsequent live SQLite snapshot. It checks table identity and dated content, sampled relationships, ready attachment size/hash, decryption and isolated API reads. This proves agreement across that capture window subject to the explicit dated-write and heartbeat allowances. Capture is not atomic; concurrent business writes may conservatively fail it. Safe known backup failure step text and exit status survive, while arbitrary stderr is withheld to avoid exposing secrets.

Hourly selects the lexically newest timestamp-named kept archive, rejects ages outside zero to two hours, and checks gzip recovery, SQLite integrity, foreign keys, relationships, ready attachment files, decryption and isolated API reads. It does not compare content against the current live database. It proves that the kept archive is readable and internally consistent, not that its historical content matches current live content or that a logically altered, internally valid archive is authentic. Age uses the UTC filename and host wall clock; correctness of that clock and filename is an unverified operational assumption. It does not fall back from a corrupt newest archive to an older archive.

Both modes read todos and one chief thread's messages through the same isolated createApp helper. The helper has an ephemeral secret box; the existing key is used only by the separate decryption helper. API checks compare restored thread message identities; they do not invoke a provider.

## Heartbeat allowance: source audit

Measured source: `apps/server/src/services/scheduler.ts:357` periodically calls `issueIntake.sweep()` and `:364` calls `schedulingSweep.sweep()`. Their writes are `apps/server/src/services/issue-intake.ts:708` and `apps/server/src/services/scheduling/sweep.ts:114`, calling `recordAutonomyVerdict`; `apps/server/src/services/autonomy-gates.ts:181` writes `lastEvaluatedAt: now`. These timer paths justify retaining only `autonomy_state.lastEvaluatedAt` when every other cell is unchanged. This is source evidence of the timer write path, not a measured production timer trace. Machine lastSeenAt/capabilities remain the other column-specific allowances. Identity, verdict, start, baseline and every other machine field remain strict under the existing comparator matrix.

## omarchy runs at d392ffae (current head of the drill code)

Run from a separate clone under `/mnt/fast/tmp/b0/cairn`; the live server and its data were only read.

| Run | Result | Report |
| --- | --- | --- |
| `--mode fresh` on the live instance | PASS restore-drill fresh ok | `omarchy-head/head-fresh.json` |
| `--mode hourly` on the newest kept backup | PASS restore-drill hourly ok | `omarchy-head/head-hourly.json` |
| `--mode compare`, clean control (a backup taken seconds before) | PASS restore-drill compare ok | `omarchy-head/head-neg-clean-control.json` |
| `--mode compare`, one message edited in that backup | FAIL content message ...: differing row | `omarchy-head/head-neg-edit-message.json` |
| `--mode compare`, one `todo_tag` row deleted | FAIL content todo_tag ...: missing row | `omarchy-head/head-neg-drop-row.json` |
| `--mode compare`, first byte of one attachment changed | FAIL attachments ...png: missing, size or sha256 mismatch | `omarchy-head/head-neg-attachment-byte.json` |

The reports were checked for the key bytes and token prefixes before commit.

## How the first real runs found the drill's own bugs

The `omarchy/` reports come from earlier commits. Run 1 failed relationships because the drill looked up messages by step id while the server keys them by build id (0 of 14752 messages carry a step id). Run 2 failed decryption because the mise `node` shim exits under a scratch HOME and the drill reported that as a decryption failure. Both were fixed with tests that use the production write shape and a HOME-dependent fake shim.

## Tests

`node --test scripts/ops/restore-drill.test.mjs scripts/ops/restore-drill-service.test.mjs` runs real SQLite, gzip, crypto and Hono routes on synthetic scratch data. Red runs before each fix are kept in this directory (`red.log`, `relationships-red.log` and the other `*red*.log` files); `green.log` is the passing run. No model provider is exercised.

## Open limit

The weekly timer and service are not installed on omarchy yet; they are installed after merge with the env file described in `scripts/ops/systemd/cairn-restore-drill.service`.
