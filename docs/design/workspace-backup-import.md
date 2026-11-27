# Workspace Whole-Account Export & Reversible Cross-Host Import — plan, 2026-11-27

## User scenario

A new Cairn user migrating from their Mac to a fresh host (or Cairn Cloud) meets whole-account export and import under **Settings -> Account -> Data and backups**. No extra account, API key, or fee is needed: exporting downloads a verified `.tar.gz` archive of their live conversations, tasks, Coordinator transcripts, attachments, skills, and hosted repos (excluding host-bound files `environment-id`, `secretbox.key`, and `vapid.json`), and importing streams that archive into another Cairn server with automatic pre-import undo protection, credential reconciliation across `secretbox.key` boundaries, and automatic pausing of external IM/mail/schedule triggers so bots never double-fire across hosts. On failure, invalid archives return HTTP 400 and remove all temporary staging directories, leaving the live database and existing backups untouched.

## Scope

1. Fresh whole-account export (`POST /api/server/backup/export`) snapshots live `server.db`, `coordinator/*.sqlite`, `attachments/`, `repos/`, and managed `skills/` into a `.tar.gz` archive via `buildSnapshotBundle`, omitting host-bound key/identity files without consuming local backup retention slots.
2. Reversible streaming import (`POST /api/server/backup/import`) streams uploaded `.tar.gz` archives to `.restore-staged/import-*` under strict compressed/uncompressed/file-count caps, validates manifest checksums and SQLite integrity, reconciles encrypted credentials across all eight cipher tables, pauses live external triggers (`im_connection`, `schedule`, `mail_account`), captures a `pre-restore` undo snapshot, and writes `restore-pending.json` atomically for next-boot activation via `applyPendingRestoreIfAny`.
3. Web Settings UI (`BackupSettingsSection`) provides **Download all data** and **Choose backup file** actions with XHR upload progress feedback, confirmation dialog, post-import paused trigger and credential summary toast, and one-click rollback via **Backup history**.
4. Existing encrypted daily S3/local backup rotation (`runBackup`), `prepareRestore`, and live server state remain untouched if export or import validation fails.

## Persisted States & Transitions

```text
IDLE --(POST /api/server/backup/export)--> [buildSnapshotBundle live SQLite backup] --> strip host keys --> gzip bytes --> IDLE
  |
  +--(POST /api/server/backup/import)--> IMPORTING (.restore-staged/import-<id>, streaming gunzip + tar to disk)
         |
         +- parse/limit/manifest/SHA-256/SQLite integrity fail --> delete staged dir --> 400 / IDLE
         |
         +- valid + pauseExternalConnectors=true --> pause ready/connecting/degraded im_connection ('expired', pollOffset=NULL),
         |     enabled schedule rows (enabled=0), and live mail_account rows ('disconnected')
         |
         +- reconcileStagedCredentials:
         |     - archive carries secretbox.key & keepHost=true --> decrypt all 8 cipher tables with archive key & re-seal under target key (updating secret.envSeal)
         |     - archive omits secretbox.key --> keep rows decryptable by target key untouched; scrub undecryptable secret/provider/oauth/github/mcp ciphers and reset im_connection secretCipher to target '{}' ('expired')
         |     then strip host-identity files when keepHost=true, recompute server.db SHA-256, re-verify SQLite integrity & manifest
         |
         +- runBackupUnlocked('pre-restore') on live target --> write restore-pending.json (atomic) --> PENDING_RESTART
                                                                                                         |
                                                              (next server boot: applyPendingRestoreIfAny) v
                                                                                                    BOOT_APPLY --> IDLE
```

## Paths Read and Written

| Path / Table | Export (`exportArchive`) | Import Stage (`prepareImport`) | Boot Apply (`applyPendingRestoreIfAny`) |
|---|---|---|---|
| `server.db` | Fresh SQLite `.backup()` snapshot | Streaming extraction + integrity check; external connectors paused; encrypted columns re-sealed or safely scrubbed so target `secretbox.key` never throws `SecretBoxError` | Copied atomically (`-wal`/`-shm` cleared) |
| `coordinator/*.sqlite` | SQLite `.backup()` per thread | Manifest SHA-256 + SQLite `integrity_check` | Directory replaced from staged snapshot |
| `attachments/`, `repos/`, managed `skills/` | Copied into snapshot | Streamed to disk with strict limits + manifest SHA-256 verified | Directories replaced from staged snapshot |
| `environment-id`, `secretbox.key`, `vapid.json` | Stripped from portable export (`EXPORT_EXCLUDED_PATHS`) | Re-seals credentials if present with `keepHost=true`, then stripped from staged payload + manifest | When `marker.keepHost=true`, preserved untouched on target host |
| `backups/*.cairn-bak` & `backup-status.json` | Untouched (no retention slot consumed) | `pre-restore` undo snapshot created ONLY after full validation succeeds | Target host backups preserved; `pre-restore` remains restorable |
| `restore-pending.json` | Untouched | Atomically written once `pre-restore` succeeds; schedules `onRestart()` | Applied & removed on clean startup |

## Edge cases

| Edge case | What the user sees | Proving test |
|---|---|---|
| Export after new DB writes | Downloaded `.tar.gz` contains newly written project/secrets immediately while excluding host keyfiles | `apps/server/test/backup-service.test.ts`: `exportArchive captures new writes immediately instead of reusing a recent snapshot` |
| Cross-host portable import without `secretbox.key` | Target preserves its own host keys, pauses IM/mail/schedule triggers, scrubs foreign ciphertext so secrets/providers load without 500s, and supports 1-click undo | `apps/server/test/backup-service.test.ts`: `prepareImport imports portable archive cleanly across hosts, pauses external connectors, and supports undo` |
| Cross-host import carrying `secretbox.key` (`keepHost=true`) | Target retains its keyfile while env secrets (`envSeal`), custom providers, IM, and Antigravity OAuth tokens re-seal and decrypt cleanly | `apps/server/test/backup-service.test.ts`: `prepareImport re-seals all credentials onto target keyfile when archive includes secretbox.key` |
| Decompression bomb, malformed tar octal, symlink, or `..` traversal | Archive is rejected cleanly (`BackupImportInvalidError` / limit error) with empty `.restore-staged` cleaned up and zero undo snapshots created | `apps/server/test/backup-service.test.ts`: `streaming extractor rejects decompression bombs, malformed tar octals, symlinks, and path traversal` |
| Symlinked `CAIRN_HOME` path across restart (macOS `/tmp`) | `applyPendingRestoreIfAny` resolves canonical paths via `realpathSync` and applies the staged snapshot cleanly | `apps/server/test/backup-service.test.ts`: `applyPendingRestoreIfAny resolves symlinked dataDir across restarts cleanly` |
| Unauthenticated, cross-origin cookie CSRF, oversized `> 256 MiB`, concurrent 409, or multipart import | HTTP route rejects 401/403/413/400/409 appropriately and accepts valid multipart `FormData` upload with 200 | `apps/server/test/backup-service.test.ts`: `HTTP /api/server/backup/export and /import routes enforce auth, CSRF, size limit, multipart upload, and conflict state` |

## Out of scope

- Resumable multi-part S3/chunked cloud uploads beyond the `256 MiB` streaming HTTP limit (tracked separately for large hosted migrations).
- Exporting or overwriting unencrypted files outside `CAIRN_HOME/server` and managed `skills/`.
- Auto-reconnecting external IM/mail/schedule connectors on the destination host without explicit user action.

## Review

- Verdict: PASS
- Plan-SHA256: f354a75680c22dc9f7325b7382cc15b7fcdbd38f37ac5beecc8191bf1f313b61
- Reviewer: Fresh-context review-head + security-review (404340e9-5923-4112-bce0-2d64f204b0a7)
- Findings: 0 blocking; persisted-state transitions, all 8 cipher tables, streaming archive limits, auth/CSRF, and proving tests verified
