# Issue 1962 verification

The regression run in red.log precedes the fixes and fails on the completed
state reason, contradictory closed/merged evidence, and a claim arriving during
link reads. The green run exercises real server routes, database state and the
outbound GitHub PATCH payload with an injected transport.

Coverage includes sole merged closing references (`state: MERGED`, `merged: true`),
incidental timeline mentions, open links, incomplete evidence, conflicting states,
multiple merged links, merged plus closed-unmerged links, candidate-local 429 and
502 failures, later candidates and projects, next-sweep retries, closure logging,
no orchestration, and unchanged manual imports and task reconciliation.

The legacy string argument to githubCloseIssue retains not_planned plus a comment;
the completed options argument sends only PATCH through the existing writeJson.
PATCH does not acquire the create-only throttle: github-create-throttle.test.ts
covers issue creation, while existing title and close PATCH callers bypass it.
The shared write transport and its error mapping are unchanged.

Overlap lookup on 2026-10-29 used `merged closing` and all five implementation,
test and documentation paths. Issue #1962 is the same request. Open PR #1995
(lane/1667) overlaps README.md for unrelated showcase changes; this branch edits
only the intake environment-variable row. Open PR #2128 (lane/2127) overlaps
github.ts only in pull opener identity fields; this change touches only the
issue-close function, preserving that independent change. Recently merged PR #2156 is the
prerequisite guard: its merged-link deferral and corresponding documentation/test
are intentionally replaced as requested by #1962; all other guards are retained.

No dependency, authentication, migration, CI or prepush gate changes are included.
