import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planPush } from './push-queue.mjs';

test('an empty queue or a landed head lets the push through', () => {
  assert.equal(planPush({ queueHead: null, queueHeadLanded: false }).action, 'push');
  assert.equal(planPush({ queueHead: 'a'.repeat(40), queueHeadLanded: true }).action, 'push');
});

test('a head that has not landed makes the push wait on that sha', () => {
  assert.deepEqual(planPush({ queueHead: 'a'.repeat(40), queueHeadLanded: false }), {
    action: 'wait',
    sha: 'a'.repeat(40),
  });
});
