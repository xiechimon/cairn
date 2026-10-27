# Issue 1775 research verification

Date: 2026-10-27. Baseline: `5adc14e419cef531c41759039ffb287d2bb6447b`.

## Scope

Research only. No gateway, policy schema, secret behavior, network enforcement, dependency or server was introduced. The issue explicitly reserves implementation until Ian approves the design. The pre-existing `pnpm-lock.yaml` modification was preserved.

The required open PR inventory and last 30 merged PRs were read before editing. No changed research path overlaps those inventories. Proposed implementation overlaps are listed in the design brief. No recently merged lines were deleted.

## Failing regression, before document edits

Executed with Node v26.8.2 using the actual tool implementation and synthetic credentials only:

```sh
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { buildSecretTool } from './apps/daemon/src/secret-channel.ts';
const sentinel = 'sentinel-1775-not-a-real-secret';
const tool = buildSecretTool({ creds: { provider: null, git: null, secrets: { names: ['HTTP_TOKEN'], take: () => sentinel } }, stepId: 'research-1775', agentId: 'probe', onAudit: () => {} });
const result = await tool.execute({ name: 'HTTP_TOKEN' });
assert.equal(result, 'cairn-secret:HTTP_TOKEN');
assert.ok(!result.includes(sentinel));
JS
```

Observed failure:

```text
AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
+ actual - expected

+ 'sentinel-1775-not-a-real-secret'
- 'cairn-secret:HTTP_TOKEN'
```

This is an intentionally red research probe. No HTTP-only policy exists today, and no production change was made to turn it green. It is not installed in the automated test suite. Future implementation must first add the policy-aware regression and real transcript capture described in the design brief. The probe demonstrates tool disclosure, not every downstream persistence path.

## Checks

- `node scripts/prepush-vitest.mjs`, through `flock /tmp/cairn-heavy.lock`: exit 0; no affected test files selected for the research-only change.
- `flock /tmp/cairn-heavy.lock pnpm exec vitest run apps/daemon/test/secret-channel.test.ts`: exit 0; 1 file and all 6 tests passed, preserving baseline behavior.
- `node scripts/english-only-gate.mjs`: 0 Chinese lines. Direct `--text` checks on both research notes, this evidence file and `COMMIT_MSG.txt` also reported 0. The direct checks cover untracked Markdown because the sandbox instruction prohibits `git add -N`.
- `node scripts/single-use-helper-gate.mjs`: 0 single-use helpers.
- `node scripts/comment-discipline-gate.mjs`: 0 new comment lines.
- No typecheck, build, server, TLS interception or e2e was needed for these documentation additions. No server was started; no process was killed.

## Handoff

`COMMIT_MSG.txt` supplies the requested English commit message because the task's sandbox instruction reserves committing to the caller. No push or GitHub write operation was performed. Product implementation remains blocked on the explicit decisions in the design brief; this research does not fix plaintext exposure.
