import assert from 'node:assert/strict';
import { test } from 'node:test';
import { busyMessage, judgePush } from './guard-queue.mjs';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const ZERO = '0'.repeat(40);

test('a push on top of a candidate that has not landed is refused', () => {
  assert.deepEqual(
    judgePush({ before: A, after: B, beforeLanded: false, afterContainsBefore: true }),
    { action: 'refuse' },
  );
});

test('a push after the previous candidate landed is allowed', () => {
  assert.equal(
    judgePush({ before: A, after: B, beforeLanded: true, afterContainsBefore: false }).action,
    'allow',
  );
});

test('creating, deleting and rewriting the ref are allowed', () => {
  assert.equal(
    judgePush({ before: ZERO, after: B, beforeLanded: false, afterContainsBefore: false }).action,
    'allow',
  );
  assert.equal(
    judgePush({ before: A, after: ZERO, beforeLanded: false, afterContainsBefore: false }).action,
    'allow',
  );
  assert.equal(
    judgePush({ before: A, after: B, beforeLanded: false, afterContainsBefore: false }).action,
    'allow',
  );
});

test('the busy message says what the push is waiting on and who owns it', () => {
  const running = busyMessage({
    sha: A,
    subject: 'feat: thing',
    body: 'Amp-Thread-ID: https://ampcode.com/threads/T-1\n',
    run: { status: 'in_progress', html_url: 'https://example.test/run/9' },
  });
  assert.match(running, /aaaaaaaaa \(feat: thing\)/);
  assert.match(running, /ci in_progress/);
  assert.match(running, /threads\/T-1/);
  assert.match(running, /run\/9/);
  const rerun = busyMessage({
    sha: A,
    subject: 's',
    body: '',
    run: { status: 'completed', conclusion: 'failure', run_attempt: 2, html_url: 'u' },
  });
  assert.match(rerun, /ci failure after a rerun/);
  assert.match(rerun, /no Amp-Thread-ID/);
  assert.match(busyMessage({ sha: A, subject: 's', body: '' }), /ci not started/);
});
