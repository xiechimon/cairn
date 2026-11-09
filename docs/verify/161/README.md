# Task 161: Feishu retirement evidence

Implementation: eabe49f39d66f335018fe5690adec8fa2cd615b2. Before screenshots and API calls: unchanged origin/main at 30da03d1d. Initial red tests ran against origin/main at 0719ece9f before implementation. Runtime source is the implementation worktree (isolated development server and Vite), not a fixture route.

| Check | Before | After |
| --- | --- | --- |
| Focused API and migration regressions | 9 failed, 1 passed | 10 passed |
| Retired account block, four viewport/theme states | 4 failed: bot form still rendered | 4 passed: no bot request or form; notification preference survives reload |
| Notifications, push, plan auto-confirm, review rejection, token/device auth, shared vocabulary/snapshots and translation coverage | Existing tests | 409 tests across 13 files passed, maxWorkers=4 |
| Account and device-push browser regressions | Existing tests | 21 tests across 3 specs passed, 2 workers |
| lint, typecheck, spec:parse, prepush | Not applicable | All passed |
| Drizzle chain and drift | Binding table present | Chain passes; generation reports no schema changes after 0132 |
| Live HTTP | GET configuration 200 | GET/PUT/DELETE 404; native unread notifications 200 |
| Upgrade SQLite | Configured and empty old databases | Table and index absent; user secrets, plan/build/task, notification and push rows preserved; repeat migration unchanged |

The API card was generated with verify-cairn's api-evidence-card driver. Database observations use a read-only connection. The screenshots show synthetic seeded Owner data and no credentials. No production data or external service was used. No model or daemon was exercised. Authentication was off in live screenshots; token and device authority are covered by focused in-process server tests.

Before images scroll the actual account settings to the bot form. After images show the same page without the form; unchanged.png shows the retained native notification group. Reference images place archived t3code settings on the left and the live app on the right; dark app states use the available light reference, so they are layout comparisons, not theme matches. The removed block has no loading, error, offline, long-content or question state after retirement; surrounding controls are unchanged.

An additional restore-drill run passed 105 of 108 script tests. Its three undated agent-field corruption cases fail with the same absent-agent-table fixture error on unchanged main. These are not required CI checks and are not repaired in this removal. The e2e selection script's tests pass.

Rollback is a one-way data door: restore a pre-upgrade database with the old app. Backups and filesystem remnants are not claimed securely erased. Ordinary user secrets with former bot names are intentionally retained.
