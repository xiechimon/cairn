# GitHub emulator evidence (#3137)

Code: `400621f1368907ac287f626cad42c325af6c218b`.

Command: `VERIFY_EVIDENCE_DIR=<scratch> node .claude/skills/verify-cairn/scripts/vp.mjs drive github-emulator pr-watch`.

The real Cairn poller and GitHub helpers ran against emulate.dev 0.13.0 over loopback HTTP. `result.json` contains the recorded requests, responses, review feedback and DB rows. `github-requests.png` shows Swagger UI executing the check-runs request; `emulate-docs.png` is the official GitHub API documentation screenshot.

| Observation | Before | After |
|---|---|---|
| thread_pr rows | 0 | 1 |
| State | absent | open, then merged |
| Checks | absent | 1 passed, 1 failed, 2 total |
| Feedback | absent | changes-requested review and inline comment |
| Missing PR | merged row | merged row preserved, unreadable=1 |

Recorded HTTP calls: 16. The Swagger UI screenshot adds a separate real GET check-runs request.

Validation: 307 focused GitHub/PrWatch tests; the final emulator integration test was repeated after switching fixture allocation to the tracked cleanup helper. All 30 affected web e2e tests and 71 verify-runner self-tests passed. Lint, workspace typecheck and spec parsing passed. The broad changed-test selection covered 316 files and was stopped; an initial load-sensitive split-case failure passed all three 12000-node cycle cases on focused retry.

Live: Cairn services and migrated SQLite.
Mocked: GitHub emulator (emulate.dev).
Not covered: real GitHub, OAuth exchange/authorization, daemon git/gh, browser PR flow, E2B, Langfuse.

Sources: [CLI documentation](https://emulate.dev/docs), [GitHub API documentation](https://emulate.dev/docs/github), [published package](https://www.npmjs.com/package/emulate/v/0.13.0).
