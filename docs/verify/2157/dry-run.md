# epic-done dry run against live GitHub (#2157)

Read-only run on 2026-10-29. The checker ran from a clean detached worktree at origin/main `e6a95e74e13853dc183cc5c7508907dd227d5870`. The manifests lived in an unreferenced local commit `1c16b1c6b88173f2b5d2aaa0ea8111b770cfe3bb` (parent: that main SHA), passed with `--ref`, and were never pushed. GitHub data came from the authenticated `gh` CLI. No GitHub write happened.

## Manifests

`dryrun-complete` lists two issues closed by merged PRs (#2054 by #2153, #2055 by #2151):

```json
{"epic":"dryrun-complete","issues":[2054,2055],"requiredChecks":["check","pack-smoke","e2e-gate"],"checks":[{"name":"node runs","run":["node","--version"]},{"name":"AGENTS.md exists","run":["test","-f","AGENTS.md"]}],"maxHours":6}
```

`dryrun-open` adds the open issue #1997:

```json
{"epic":"dryrun-open","issues":[2054,1997],"requiredChecks":["check","pack-smoke","e2e-gate"],"checks":[{"name":"node runs","run":["node","--version"]}],"maxHours":6}
```

`dryrun-prcheck` requires `pr-evidence`, a check that runs only on pull requests and never on main pushes:

```json
{"epic":"dryrun-prcheck","issues":[2054,2055],"requiredChecks":["check","pr-evidence"],"checks":[{"name":"node runs","run":["node","--version"]}],"maxHours":6}
```

## Output

Each run prints its state on the first line and exits with the state's code (complete 0, incomplete 10, paused 20, failed 30, unknown 2). The fifth run shows that `--fail` does not override a complete epic. The last run asks for a manifest that does not exist.

```text
$ node scripts/epic-done.mjs dryrun-complete --ref 1c16b1c6b88173f2b5d2aaa0ea8111b770cfe3bb --started-at 2026-10-29T13:21:33Z
state: complete
Every issue is completed on main; required checks passed at e6a95e74e13853dc183cc5c7508907dd227d5870.
exit=0

$ node scripts/epic-done.mjs dryrun-open --ref 1c16b1c6b88173f2b5d2aaa0ea8111b770cfe3bb --started-at 2026-10-29T13:21:33Z
state: incomplete
Issue #1997 is open.
exit=10

$ node scripts/epic-done.mjs dryrun-prcheck --ref 1c16b1c6b88173f2b5d2aaa0ea8111b770cfe3bb --started-at 2026-10-29T13:21:33Z
state: incomplete
No green main commit examined since 3733c4757b0934d53881f76eb35be759d265e430.
required check "pr-evidence" has no run on e6a95e74e13853dc183cc5c7508907dd227d5870
exit=10

$ node scripts/epic-done.mjs dryrun-open --ref 1c16b1c6b88173f2b5d2aaa0ea8111b770cfe3bb --started-at 2026-10-29T13:21:33Z --pause Codex weekly quota exhausted, resets 2026-11-03T22:35Z
state: paused
Issue #1997 is open.
Paused: Codex weekly quota exhausted, resets 2026-11-03T22:35Z
exit=20

$ node scripts/epic-done.mjs dryrun-complete --ref 1c16b1c6b88173f2b5d2aaa0ea8111b770cfe3bb --started-at 2026-10-29T00:00:00Z --fail check cannot pass without editing the frozen manifest
state: complete
Every issue is completed on main; required checks passed at e6a95e74e13853dc183cc5c7508907dd227d5870.
exit=0

$ node scripts/epic-done.mjs dryrun-missing --ref 1c16b1c6b88173f2b5d2aaa0ea8111b770cfe3bb
fatal: path '.claude/epics/dryrun-missing.json' does not exist in '1c16b1c6b88173f2b5d2aaa0ea8111b770cfe3bb'
state: unknown
Command failed: git show 1c16b1c6b88173f2b5d2aaa0ea8111b770cfe3bb:.claude/epics/dryrun-missing.json
fatal: path '.claude/epics/dryrun-missing.json' does not exist in '1c16b1c6b88173f2b5d2aaa0ea8111b770cfe3bb'

exit=2

$ node scripts/epic-done.mjs dryrun-open --ref 1c16b1c6b88173f2b5d2aaa0ea8111b770cfe3bb --started-at 2026-10-29T00:00:00Z
state: failed
Issue #1997 is open.
Time cap of 6 hours elapsed since 2026-10-29T00:00:00Z.
exit=30
```

## Tests

On origin/main, before this change:

```text
$ node --test scripts/epic-done.test.mjs
Could not find 'scripts/epic-done.test.mjs'
```

On this branch:

```text
$ node --test scripts/epic-done.test.mjs
ℹ tests 38
ℹ pass 38
ℹ fail 0
ℹ duration_ms 121.20125
```
