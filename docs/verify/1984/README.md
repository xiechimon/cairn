# Routing benchmark fixtures (#1984)

Extracted from the final revision of closed PR #1888, commit
`dd34ea21f592a37e695843338f0cf3f4aea62960`. The blocking findings recorded
in #1830 were read before implementation. This landing contains only the
21 benchmark tasks, seed generation, oracle execution, and independent
reference checks. Model sessions, anti-cheat grading, reports, resume identity,
and the CLI remain outside this change.

## Reproduce

```sh
pnpm exec vitest run integration/test/routing-bench.test.ts
```

No relay, model credentials, or external packages in the seeded workspace are
required. Each oracle runs as a real Node subprocess. `seedWorkdir` installs only
`seedFiles`; `runOracle` installs `oracle.files` immediately before checking.
Use a fresh workspace for each attempt. Oracle execution is for trusted benchmark
fixtures; it does not provide a sandbox or an anti-cheat boundary.

## Evidence

- `red.log`: the test was run before implementation and failed on the absent benchmark module.
- `oracles.log`: four focused tests passed, including all 21 untouched throwing stubs failing and all 21 independently written references passing the actual oracle subprocesses.
- `integration/test/routing-reference.ts` contains separate reference implementations for every task, including every export in multi-file tasks. They do not copy the seeded vendor implementations.
- Word-wrap checks `wrapText('a b c', 4) === 'a b\nc'` and `wrapText('a b c', 5) === 'a b c'` in both the task description and oracle. The independent greedy reference passes that oracle.
- Seeded directory contents are checked exactly, oracle paths are absent before verification, and their installed contents are checked after verification.

Read-only GitHub overlap inspection found no open PR or recently merged PR
changing the new routing paths. No existing repository source lines were removed.
The pre-existing `pnpm-lock.yaml` modification was left untouched.

## Final verification rerun

The focused suite and `node scripts/prepush-vitest.mjs` both passed all four
tests again; `prepush-vitest.log` records the latter run. English-only,
single-use-helper, and comment-discipline gates each reported zero findings.

A fresh `flock /tmp/cairn-heavy.lock pnpm prepush` invocation waited without
output while the shared lock was occupied (`flock -n` returned 1). That waiting
invocation was cancelled without terminating another process. The earlier full
prepush output supplied with the task reports 25 passing checks; this rerun does
not independently repeat those heavy checks. No server was started.

The open and recently merged PR file lists supplied with the task contain no
routing-path overlap. The existing implementation and its original red/green
logs were present at the start of this final verification pass.
