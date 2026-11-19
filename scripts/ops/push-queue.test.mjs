import assert from 'node:assert/strict';
import { test } from 'node:test';
import { laneName, planPush, stampCommand, unownedCommits } from './push-queue.mjs';

const X = 'a'.repeat(40);

test('with no live candidate the push goes through', () => {
  assert.equal(planPush({ live: null, queueHead: null }).action, 'push');
  assert.equal(planPush({ live: null, queueHead: X }).action, 'push');
});

test('a live candidate makes the push wait on it, and says when queue/main was deleted under it', () => {
  assert.deepEqual(planPush({ live: X, queueHead: X }), {
    action: 'wait',
    sha: X,
    restoring: false,
  });
  assert.deepEqual(planPush({ live: X, queueHead: null }), {
    action: 'wait',
    sha: X,
    restoring: true,
  });
});

test('commits without an Amp-Thread-ID or Lane trailer are the ones that get stamped', () => {
  const commits = [
    { sha: '1', body: 'a\n\nAmp-Thread-ID: https://ampcode.com/threads/T-1\n' },
    { sha: '2', body: 'b\n\nsome text\n' },
    { sha: '3', body: 'c\n\nLane: mac/wt\n' },
    { sha: '4', body: 'd mentions Lane: x in the subject\n' },
  ];
  assert.deepEqual(unownedCommits(commits), ['2', '4']);
});

test('the lane name is host and worktree, safe for a trailer and a shell quote', () => {
  assert.equal(
    laneName('xmons-MacBook', 'ecstatic-brahmagupta-aee8fe'),
    'xmons-MacBook/ecstatic-brahmagupta-aee8fe',
  );
  assert.equal(laneName("my host's", 'wt dir'), 'my-host-s/wt-dir');
  assert.match(stampCommand('mac/wt'), /--trailer 'Lane: mac\/wt'/);
});
