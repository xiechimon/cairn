# #1241 backfill of existing rows (mon's ruling: old default 3 and not manually overridden → follow the recommendation)

Script `backfill-verify.mjs` (node22, server 8801 / web 5291, PACMAN_HOME `/tmp/bf-1241-home`):

1. Start the server from origin/main (`9b027a5c`, without #1241) and register 3 machines: two left at the default 3, one PATCHed to 5 (`api-before-main.json`).
2. Stop main; write a hardware fingerprint (12 cores / 36 GiB) for `bf-legacy-fingerprinted`, simulating the current daemon having reported one beat (main does not store hardware).
3. Start the server from this branch on the **same database**: migration 0043 + the startup backfill `backfillMachineConcurrency` (`api-after-branch-start1.json`, screenshots).
4. Restart once more: the result is unchanged (`api-after-branch-start2.json`) — idempotent.

| machine | on main | after this branch starts |
|---|---|---|
| bf-legacy-fingerprinted (old default 3, has fingerprint) | 3 | **12**, recommended (measured) |
| bf-legacy-blank (old default 3, no fingerprint) | 3 | 3, estimated |
| bf-manual-5 (manual 5) | 5 | 5, manual (untouched) |

Known boundary: a machine **manually set to exactly 3** on main is indistinguishable from the old default and is treated as not overridden (mon accepted this).
