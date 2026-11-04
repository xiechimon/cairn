# 1277 artifact-gate drift hard fail

Live verify stack. Server `8791`, web `5273`, scratch `PACMAN_HOME`. No daemon
and no LLM. The probe posts the machine done payload itself.

Payload under test: build step, `status=success`, `hasChanges=true`,
`workBranchDrift` naming both branches, plus `prUrl` / `prNumber`.

| run | code | result |
|---|---|---|
| before | `2ced623f` (origin/main at branch start) | todo `review`, `errorMessage` null, PR stored, step `done`. Detail chip `审核`. 6/6 checks in `before-result.json`. |
| after | `65453701` | todo `failed`, error names both branches, `prUrl` and `prNumber` null, step `failed`. Detail chip `失败`. 9/9 checks in `after-result.json`. |

Controls on both runs: zero changes still fails with `构建零改动`; drift with
`hasChanges=false` still uses the no-commit wording; `hasChanges=true` without
drift still enters review.

Rerun, after `node .claude/skills/verify-pacman/scripts/launch.mjs`:

```sh
node docs/verify/1277/drive-1277-artifact-drift.mjs --expect=old
node docs/verify/1277/drive-1277-artifact-drift.mjs --expect=new
```

`--expect=old` asserts the union (review + stored PR). `--expect=new` asserts
the hard fail.

Unit pin, same assertion, run from `apps/server`:

```sh
corepack pnpm exec vitest run test/artifact-gate.test.ts -t '失败方式 7'
```

Red output on the test commit (before the fix): `server-gate-before-red.txt`.
Green output on the fix: `server-gate-after-green.txt` (full file 13 passed).

`gate-branch-log.txt` is the server log from a temporary line that showed
which branch `stepArtifactGate` took. That line is not in the fix.
