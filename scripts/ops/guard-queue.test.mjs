import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  busyMessage,
  judgeChange,
  PROMOTER,
  RELEASE_MARKER,
  refusalNotice,
  restoreNotice,
} from './guard-queue.mjs';

const X = 'a'.repeat(40);
const Y = 'b'.repeat(40);
const ZERO = '0'.repeat(40);
const lane = 'xiechimon';

test('a push on top of a live candidate is refused as stacked, and one that drops it as replaced', () => {
  const stacked = { event: 'push', actor: lane, before: X, after: Y, live: X };
  assert.deepEqual(judgeChange({ ...stacked, afterContainsLive: true }), {
    action: 'refuse',
    sha: X,
    kind: 'stacked',
  });
  assert.deepEqual(judgeChange({ ...stacked, afterContainsLive: false }), {
    action: 'refuse',
    sha: X,
    kind: 'replaced',
  });
});

test('creating queue/main while an unlanded candidate was deleted is refused as recreated', () => {
  assert.deepEqual(
    judgeChange({
      event: 'push',
      actor: lane,
      before: ZERO,
      after: Y,
      live: X,
      afterContainsLive: false,
    }),
    { action: 'refuse', sha: X, kind: 'recreated' },
  );
});

test('deleting queue/main while a candidate is live restores that candidate', () => {
  assert.deepEqual(judgeChange({ event: 'delete', actor: lane, before: '', after: '', live: X }), {
    action: 'restore',
    sha: X,
  });
});

test('with no live candidate every change is allowed', () => {
  for (const event of ['push', 'delete']) {
    assert.equal(
      judgeChange({ event, actor: lane, before: X, after: Y, live: null, afterContainsLive: false })
        .action,
      'allow',
    );
  }
});

test('only the promoter may remove or rewind a live candidate', () => {
  assert.equal(
    judgeChange({ event: 'delete', actor: PROMOTER, before: '', after: '', live: X }).action,
    'allow',
  );
  assert.equal(
    judgeChange({
      event: 'push',
      actor: PROMOTER,
      before: Y,
      after: X,
      live: Y,
      afterContainsLive: false,
    }).action,
    'allow',
  );
  assert.equal(
    judgeChange({ event: 'delete', actor: 'someone-else[bot]', before: '', after: '', live: X })
      .action,
    'restore',
  );
});

test('pushing the live candidate itself again is allowed', () => {
  assert.equal(
    judgeChange({
      event: 'push',
      actor: lane,
      before: ZERO,
      after: X,
      live: X,
      afterContainsLive: true,
    }).action,
    'allow',
  );
});

test('the notices name the candidate, the refused commit, the deleter and the operator hatch', () => {
  assert.match(
    refusalNotice({ kind: 'stacked', sha: X, after: Y, actor: lane }),
    /on top of a candidate/,
  );
  assert.match(
    refusalNotice({ kind: 'replaced', sha: X, after: Y, actor: lane }),
    /replaced a candidate/,
  );
  const recreated = refusalNotice({ kind: 'recreated', sha: X, after: Y, actor: lane });
  assert.match(recreated, /deleted by xiechimon/);
  assert.match(recreated, /bbbbbbbbb/);
  const restored = restoreNotice({ sha: X, actor: lane });
  assert.match(restored, /deleted by xiechimon/);
  assert.ok(restored.includes(`"${RELEASE_MARKER} <reason>"`));
});

test('the busy message says what the push is waiting on and who owns it', () => {
  const running = busyMessage({
    sha: X,
    subject: 'feat: thing',
    body: 'Amp-Thread-ID: https://ampcode.com/threads/T-1\n',
    run: { status: 'in_progress', html_url: 'https://example.test/run/9' },
  });
  assert.match(running, /aaaaaaaaa \(feat: thing\)/);
  assert.match(running, /ci in_progress/);
  assert.match(running, /threads\/T-1/);
  assert.match(running, /run\/9/);
  assert.match(running, /never delete queue\/main/);
  const rerun = busyMessage({
    sha: X,
    subject: 's',
    body: '',
    run: { status: 'completed', conclusion: 'failure', run_attempt: 2, html_url: 'u' },
  });
  assert.match(rerun, /ci failure after a rerun/);
  assert.match(rerun, /no Amp-Thread-ID or Lane trailer/);
  assert.match(
    busyMessage({ sha: X, subject: 's', body: 'Lane: mac/wt\n' }),
    /Owner: lane mac\/wt\./,
  );
  assert.match(busyMessage({ sha: X, subject: 's', body: '' }), /ci not started/);
});
