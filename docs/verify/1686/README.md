# Web Push rework verification

The owner decision in the acceptance-checklist comment on issue #1686 supersedes the original immediate phase-push plan: only chief decision questions push immediately, once per request, including the question and every option. Plan-ready, review, failed, completed and merged events enter a persisted twice-daily digest. Default times are 09:00 and 18:00 in server-local time.

## Regression evidence

- `push-red.log`: four failing cases before fixes for complete decision text, snapshot queue deletion, transient delivery retention and time validation.
- `scheduler-red.log`: an unresolved morning delivery overlapped the evening sweep.
- `migration-red.log`: an existing database skipped migration 0060 because its timestamp preceded migration 0059.
- `focused-green.log`: real subscription routes, ownership and authentication checks, HTTPS stub transport, expired-subscription pruning, decision deduplication, digest routing, scheduler ticks, production startup and database upgrade tests.

The production single-file server was built with `node build.mjs` in `apps/server`, then started from `dist/index.mjs` with a temporary data directory and port 0. It generated VAPID keys and emitted `cairn-server online`. The verification terminated and reaped the child. An initial probe falsely missed buffered stdout; collecting the complete child output confirmed startup.

## Final checks

- `flock /tmp/cairn-heavy.lock node scripts/prepush-vitest.mjs`: passed, 409 files and 5544 tests (181.38 seconds). The final HTTPS-origin regression and startup timeout-budget adjustment were also verified in the focused run: 3 files, 46 tests passed.
- `flock /tmp/cairn-heavy.lock pnpm typecheck`: passed across shared, server, web, daemon and integration, including a final run after configuration changes.
- `flock /tmp/cairn-heavy.lock node scripts/heavy-slots.mjs run -- pnpm --filter @cairn/web exec playwright test e2e/push-device-switch.spec.ts`: 2 passed against a fresh fixture build.
- `pnpm lint`: passed.
- `pnpm spec:parse`: passed, 1344 web cases collected and 40 integration test files parsed.
- English-only, single-use-helper and comment-discipline gates: all 0.
- Lessons ledger gate and `git diff --check`: passed.
- The Playwright wrapper exited successfully; port 8399 had no listener after the run. All explicitly started production/bundle server children were terminated and reaped.

The `@cairn/server` package filter in the issue is stale: this checkout names the server package `@xiechimon/cairn`. The recursive typecheck includes it.

Full amendment file list: [changed-files.txt](changed-files.txt).

## Security and code review

Manual review covered token-auth middleware registration before push routes, user/team ownership on writes and deletes, endpoint host restrictions against arbitrary HTTP requests, subscription rate and retention limits, restricted VAPID file permissions, server-controlled HTTPS navigation origin, decision idempotency and digest snapshot deletion. Existing SSE and email delivery were not changed. The named global `code-review`, `security-review` and `simplify` skills are not installed in this session; this records the performed manual review rather than claiming those skills ran.

Transient failures retain the group's queued events until a later scheduled digest. A partial failure can therefore repeat the digest on a device that already received it. Digest bodies are bounded summaries; their deep link opens the app. Very large decision text can exceed push-service payload limits and is logged as a delivery failure. Scheduler slot history is process-local, so a restart can perform a catch-up digest for an elapsed slot.

## Overlap audit

Before editing, both requested GitHub PR-list commands were run. Open PRs overlapping this feature's paths: #2030, #2027, #2026, #1995, #1993, #1940, #1928, #1867, #1839, #1821, #1769, #1727 (this PR), and #1654. The rework preserves unrelated lines and only replaces this feature's immediate phase pushes as requested.

### Migration integration follow-up

The sandbox handoff prohibits Git writes, so the working tree contains the
three-way integration result against `origin/main`; branch ancestry and the
two original commits remain unchanged for the external rebase/squash step.
All main-only file changes are preserved byte for byte. Conflicts in
`services/builds.ts`, `i18n/en.ts` and `records/index.ts` retain both sides,
including the first-PR prompt from #2026 and recording-trigger exports.

Main's migrations `0060_chief_message_project` and `0061_first_pr_report`,
their snapshots and every journal entry are preserved. Running
`pnpm --filter @xiechimon/cairn db:generate --name push_subscription` generated
`0062_push_subscription.sql` and its snapshot. The snapshot extends 0061,
retains every existing table definition and adds only the two push tables.
The generated timestamp is later than main's last migration.

- `rebase-schema-red.log`: requiring migration 0062 fails before generation.
- `rebase-server-green.log`: all 177 server test files and 2949 tests pass.
- `rebase-typecheck-green.log`: recursive typecheck passes in every package.
- `rebase-vitest-green.log`: prepush Vitest passes, 424 files and 5773 tests.
- `rebase-spec-green.log`: 1362 web cases collected and 46 integration files parsed.
- Drizzle chain check and lint pass; English-only, single-use-helper and
  comment-discipline gates each report 0.

The initial package-manager metadata change in `pnpm-lock.yaml` was preserved.
Current open overlaps: #2050, #2036, #2027, #1995, #1993, #1940, #1928,
#1867, #1821, #1769, #1727 and #1654. No unrelated overlap lines were removed.

## Outstanding acceptance

Android Chrome and iOS home-screen PWA lock-screen delivery and tap-through were not tested: no physical devices are available in this execution environment. No screenshots or recordings are claimed. The original real-device acceptance remains open.

No push or PR update was performed. `COMMIT_MSG.txt` supplies the full amendment message for the sandbox handoff.
