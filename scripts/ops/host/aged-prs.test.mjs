import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hostFixture, recordingDispatch } from './host-fixture.mjs';

const head = 'a'.repeat(40);
const hostFiles = { 'lanes/dispatch-issue.sh': recordingDispatch() };

function agedRun(t, ref, lists = {}) {
  const fixture = hostFixture(t, { gh: { agedPrs: `5 ${ref} ${head}` }, lists, hostFiles });
  return fixture.run('tools/governor/aged-prs.sh');
}

const issueCreates = (result) => result.ghLines.filter((line) => line.startsWith('issue create'));
const dispatches = (result) => result.calls.filter((call) => call[0] === 'dispatch-issue');
const worktrees = (result) =>
  result.calls.filter((call) => call[0] === 'git' && call.includes('worktree'));

for (const ref of ['codex/work', 'claude/work', 'cursor/agent-task']) {
  test(`aged-prs treats ${ref} as foreign: stale-pr issue, no worker`, (t) => {
    const result = agedRun(t, ref);
    assert.equal(issueCreates(result).length, 1);
    assert.match(issueCreates(result)[0], /stale PR #5/);
    assert.deepEqual(dispatches(result), []);
    assert.deepEqual(worktrees(result), []);
  });
}

test('aged-prs re-dispatches a lane/N branch instead of opening an issue', (t) => {
  const result = agedRun(t, 'lane/123');
  assert.deepEqual(dispatches(result), [['dispatch-issue', '123', 'implement']]);
  assert.deepEqual(issueCreates(result), []);
});

test('aged-prs skips a lane branch on the never list', (t) => {
  const result = agedRun(t, 'lane/123', { never: ['123'] });
  assert.deepEqual(dispatches(result), []);
  assert.deepEqual(issueCreates(result), []);
});

test('aged-prs skips a lane branch on the hold list', (t) => {
  const result = agedRun(t, 'lane/123', { hold: ['123'] });
  assert.deepEqual(dispatches(result), []);
});

test('aged-prs gives any other prefix its own worktree worker rather than a stale-pr issue', (t) => {
  const result = agedRun(t, 'feature/x');
  assert.deepEqual(issueCreates(result), []);
  assert.deepEqual(dispatches(result), []);
  assert.equal(worktrees(result).length, 1);
  assert.match(result.stdout, /aged: worker on branch feature\/x for PR #5/);
});

test('aged-prs handles each PR head once', (t) => {
  const fixture = hostFixture(t, { gh: { agedPrs: `5 codex/work ${head}` }, hostFiles });
  fixture.run('tools/governor/aged-prs.sh');
  const second = fixture.run('tools/governor/aged-prs.sh');
  assert.equal(issueCreates(second).length, 1);
});
