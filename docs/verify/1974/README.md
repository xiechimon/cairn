# Issue #1974 verification

Feishu configuration persistence only: team-scoped GET/PUT/DELETE at `/api/teams/:id/feishu`, App ID and App Secret encrypted as `feishu_binding` columns (`appIdCipher` / `appSecretCipher`) through SecretBox, translated account controls, and complete unbinding with an explicit confirmation dialog. `services/secrets.ts` is unchanged from main, so ordinary secrets remain fully usable and the binding ciphers stay out of every public secret surface. No transport, SDK, connection startup or approval action is added.

## Failure modes

- Missing, malformed, oversized or blank configuration; a new app without a secret; unsafe origins.
- Unauthenticated requests and reads or writes to a different team.
- Replacing one credential without the other; changing App ID while retaining an unrelated secret; encryption failure leaving partial state.
- Ordinary secret listing, lookup, value opening, creation, rename and deletion accidentally touching the binding ciphers; chief secret tools bypassing the binding; a user secret that shadows the credential name becoming unusable.
- Unbinding without confirmation; unbinding deleting unrelated secrets; repeated unbinding failing.
- Missing migrations, colliding journal indexes or filenames, stale snapshots, or loss of existing main data during upgrade.
- Account configuration not surviving reload; secret fields being refilled; failed saves silently appearing successful; existing account controls regressing.

## Evidence

- `server-red.log`: configuration tests fail before implementation (4 failed, 1 passed).
- `migration-red.log`: fresh/upgrade and snapshot tests fail before implementation (3 failed).
- `e2e-red.log`: corrected browser negative control fails with only the Feishu mount removed. The account page loads, but the form is absent. The original invalid chief stub is not used as acceptance evidence.
- `fix-round-server-red.log`: the binding-column tests fail against the previous name-prefixed design (4 failed): `appIdCipher` is undefined after save, ordinary `feishu.bot.*` secret creation is rejected with 400, and the migrated `feishu_binding` table lacks the cipher and timestamp columns.
- `fix-round-e2e-red.log`: the unbind confirmation spec fails against the immediate-unbind component; the `alertdialog` never appears.
- `targeted-green.log`: 131 passing configuration, migration, schema and shared snapshot tests.
- `legacy-green.log`: 29 passing historical upgrade and registry tests, including the fresh/upgrade Feishu migration cases. Historical fixtures and helpers match origin/main verbatim (verified file by file), preserving the upgrade assertions even as main adds team fields.
- `e2e-green.log` / `fix-round-e2e-green.log`: 9 passing browser cases: configuration, reload, recipient update, secret replacement, failed-save feedback, unbind-cancel leaves configuration intact, confirmed unbinding, plus existing account controls. The Feishu browser case stubs HTTP responses; the separate server tests and runtime probe exercise the real application and SQLite services.
- `probe.json`: actual API status, SQLite encrypted envelope inspection of the binding columns, empty public secret and agent credential views, a user-owned `feishu.bot.` secret created and deleted through the chief tool, and zero bindings after unbinding. Only synthetic data is used; secret plaintext and ciphertext payloads are omitted.
- `migration-numbering.json`: main's journal through `0061_first_pr_report` is preserved verbatim; the generated lane migration is `0062_feishu_binding` with the binding columns and timestamps. Recheck numbering at merge time.
- `prepush-vitest.log`: final locked typecheck and prepush-vitest run exits 0; 345 test files and 4589 tests pass.
- `lint.log`: repository lint passes.
- `spec-parse.log`: every web spec and integration test parses.
- `gates.log`: English, comment and single-use-helper gates report zero; the lessons ledger and E2E family coverage pass.
- `security-review.md`: recorded security review of the trust boundaries and candidate findings, completed in the fix round after the review-gate finding; no confirmed findings remain. The named `security-review` skill is not installed in this session or checkout, which the file states.
- `changed-files.txt`: complete file inventory, including the preserved current-main migration files.

## Reproduce

```sh
pnpm exec vitest run apps/server/test/feishu-config.test.ts apps/server/test/feishu-migration.test.ts apps/server/test/schema.test.ts packages/shared/test/snapshot.test.ts
pnpm --filter @xiechimon/cairn exec tsx ../../docs/verify/1974/probe.mts
flock /tmp/cairn-heavy.lock node scripts/heavy-slots.mjs run -- pnpm --filter @cairn/web exec playwright test account-feishu.spec.ts account-controls.spec.ts
flock /tmp/cairn-heavy.lock pnpm typecheck
flock /tmp/cairn-heavy.lock node scripts/prepush-vitest.mjs
pnpm lint
pnpm spec:parse
node scripts/english-only-gate.mjs
node scripts/single-use-helper-gate.mjs
node scripts/comment-discipline-gate.mjs
```

## Upstream preservation

The required open-PR inspection found overlaps with #2036, #2026, #1867, #1769, #1727 and #1654 in schema/migrations, shared contracts/registry, schema tests, or the account page. Existing lines are preserved. #2026 subsequently landed on main; its migration and schema fields are retained along with #2016's chief-message migration. Additional overlaps in shared snapshots, translations or E2E mappings are #2031, #1993, #1940, #1928 and #1821. The exact file intersections are recorded in `overlaps.json`.

The historical cost-upgrade fixture replaces the production seed call introduced by recently merged #1929, because this issue requires upgrade validation against main's evolving schema. The final historical fixture changes and helper are reused from main PR #2026; their preservation assertions remain unchanged. All main SQL migrations are retained, including the GitHub refresh-token and retirement migrations.

## Fix round (review gate)

The review gate blocked the first head on three findings, all fixed in this round:

1. Credentials moved from name-prefixed `secret` rows into the `feishu_binding` columns (`appIdCipher`, `appSecretCipher`, `createdAt`, `updatedAt`). `services/secrets.ts` is byte-identical to origin/main; no reserved namespace exists, so user secrets named `feishu.bot.*` stay fully usable and the binding ciphers stay out of every public secret surface. Reproduction: `fix-round-server-red.log` (4 failed) then `server-green.log` (12 passed).
2. Unbinding now requires an explicit confirmation dialog; the spec covers cancellation (no DELETE sent) and confirmed unbinding. Reproduction: `fix-round-e2e-red.log` (alertdialog never appears) then `fix-round-e2e-green.log` (9 passed).
3. The security review was completed in this round and recorded with its trust boundaries and candidate findings in `security-review.md`; no confirmed findings remain.

## Delivery

Branch: `lane/1974`. The fix round is committed on `lane/1974`; no push is performed. The commit message ends with `Closes #1974` and carries an Evidence section with one entry per review finding. Playwright manages and closes the servers used by its runs; the runtime probe starts no listening server.
