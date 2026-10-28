# Issue #1948 verification

The integration suite exercises real authenticated Hono server routes backed by
an in-memory migrated database. It uses no daemon or listening server. Sixteen
cases cover successful second-project submission and all three polling routes,
missing/incorrect/swapped credentials, invalid projects, machine identity,
credential-safe serialization and partial submission record retention.

- `serialization-red.log`: failing test before replacing enumerable credential
  properties with JavaScript private fields. Ephemeral test tokens are redacted.
- `partial-submission-red.log`: failing test before retaining the created todo ID
  when a build request fails.
- `integration-green.log`: final targeted integration result.
- `requests.json`: actual successful request outcomes and created record IDs.
- `prepush-vitest.log`, `typecheck.log`, `lint.log`, `spec-parse.log`: final checks.
- `gates.log`: language, helper and comment checks.

Before editing, both required PR lists and all #1518 comments were read.
No open PR changes these exact files. Open #2049 adds different files in
`integration/eval/harbor/`; this change preserves them. None of the 30 recent
merged PRs changes these files. #1792 is an open issue, and its executor is absent
from this checkout, so only the independently reusable boundary is delivered.
Workspace execution and benchmark scoring remain outside #1948.

Review checked credential routing, validation before writes, project isolation,
error redaction, redirect rejection and retained IDs after a partial failure.
Creation is not transactional; callers must inspect retained evidence before a
retry. The polling timeout controls the loop; an individual request has its own
30-second timeout. The worktree's fixture typing errors were caught by typecheck
and recorded in `docs/lessons/1948-test-fixture-types.md`.
