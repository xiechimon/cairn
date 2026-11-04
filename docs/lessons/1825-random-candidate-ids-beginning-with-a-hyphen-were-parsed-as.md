---
Category: Random candidate IDs beginning with a hyphen were parsed as CLI options, making curation lifecycle tests fail intermittently / Generated record ids could start with `-` (the leading character was drawn from the 64-character alphabet), so a candidate id fed to the curate CLI in space form was read by node:util parseArgs as an unknown option once every 64 ids, and the run failed with the CLI's generic catch-all message; the trajectory-reflect dismissal test went red in CI on an otherwise green lane
Source: #1825 (2026-10-26) / #1873 (2026-10-26)
Level: 2
Safeguard: Curation lifecycle tests pin hyphen-prefixed IDs and pass them with `--confirm=<id>` and `--dismiss=<id>` / `apps/server/test/ids.test.ts` asserts over 5000 draws that `newRecordId` matches `^[A-Za-z0-9][A-Za-z0-9_-]{20}$`; the leading character now comes from a 62-character alphanumeric alphabet
Intercepts: 3
Recurrences: 0
Notes: Negative controls: separate option values reproduce the generic curation error for both confirmation and dismissal; attached values preserve the lifecycle assertions / Deterministic repro: `--dismiss -Repro0123456789abcd` exits 1 with the exact CI stderr, an alphanumeric-leading control id succeeds; a dash-leading value needs the `--flag=value` form; the failing surface is byte-identical on origin/main, so the flake is inherited, and the `--confirm` test in the same file has the same exposure
---
