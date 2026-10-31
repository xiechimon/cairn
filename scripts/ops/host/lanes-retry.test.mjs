import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { hostFixture, recordingDispatch } from './host-fixture.mjs';

const depsClear = 'process.exit(0);\n';
const tierSimple = '#!/bin/sh\necho simple\n';

function retryRun(t, { lists, dispatchScript, extra = {} }) {
  const fixture = hostFixture(t, {
    lists,
    hostFiles: {
      '.cairn/tools/merge-order/deps-open.mjs': depsClear,
      '.cairn/tools/governor/tier.sh': tierSimple,
      ...(dispatchScript ? { 'lanes/dispatch-issue.sh': dispatchScript } : {}),
      ...extra,
    },
  });
  return { fixture, result: fixture.run('tools/merge-order/lanes-retry.sh') };
}

const dispatches = (result) => result.calls.filter((call) => call[0] === 'dispatch-issue');
const pending = (fixture) => readFileSync(join(fixture.state, 'pending'), 'utf8').trim();

test('the never list wins over pending: dispatch-issue refuses and the ticket stays pending', (t) => {
  const { fixture, result } = retryRun(t, { lists: { pending: ['88'], never: ['88'] } });
  assert.equal(result.stdout, '');
  assert.equal(
    result.ghLines.some(
      (line) => line.startsWith('issue view 88') && line.includes('--json state'),
    ),
    false,
  );
  assert.equal(pending(fixture), '88');
});

test('a pending ticket that is not on the never list reaches dispatch-issue', (t) => {
  const { result } = retryRun(t, {
    lists: { pending: ['88'] },
    dispatchScript: recordingDispatch(),
  });
  assert.deepEqual(dispatches(result), [['dispatch-issue', '88', 'implement']]);
});

test('pending tickets are not dispatched while the brake is on', (t) => {
  const { result } = retryRun(t, {
    lists: { pending: ['88'] },
    dispatchScript: recordingDispatch(),
    extra: { '.local/state/overnight/brake': 'on\n' },
  });
  assert.deepEqual(dispatches(result), []);
});
