# Candidate collection verification

Run the read-only collector from a Git checkout with a populated `origin/main`:

```sh
node scripts/escape-trace.mjs --since 2026-10-01T00:00:00Z --until 2026-10-15T00:00:00Z
node --test scripts/escape-trace.test.mjs
```

The interval includes the start and excludes the end, using committer timestamps normalized to UTC. The collector reads the local remote-tracking ref without fetching or changing the checkout. It walks all reachable history without a commit-count limit. Records sort by timestamp and SHA; paths are unique and sorted. Full messages retain their final newline. `fixingPr` is the trailing subject PR number, or null; originating PR attribution is outside this ticket.

Recognized subjects are conventional fix/hotfix/bugfix types, Cairn scoped subjects whose description begins with fix/hotfix/bugfix, Git's quoted Revert subjects, and conventional revert types. Incidental revert mentions do not qualify.

The temporary repositories cover origin/main versus unrelated HEAD commits, both interval boundaries, nonmonotonic commit dates, 205 qualifying commits, Cairn and conventional syntax, genuine revert syntax, incidental mentions, multiline messages, unusual paths, stable serialization, and invalid input. The runner test selects the actual behavior-test command from both prepush plans and verifies a deliberately failing assertion exits nonzero through runPlan. CI already invokes the shared plan with `pnpm prepush --ci`.

`red.log` records the missing CLI and missing runner wiring before implementation. `green.log` records the completed behavior tests, including both negative runner controls.

Existing worktree changes to `pnpm-lock.yaml` are unrelated and preserved. Open PRs #2035 and #2032 also touch `scripts/prepush.mjs`; this change only adds one required test command. Recently merged PR lines remain intact.

Final checks passed: 20 node:test cases, repository lint, typecheck, spec parsing (1,301 web cases and 39 integration files), test-spawn gate, and diff whitespace validation. The English, single-use helper, and comment gates each reported zero violations. `prepush-vitest.mjs` exited successfully with no affected Vitest files; the node:test cases above are executed separately and through both prepush plans. No development servers or browser tests were started.
