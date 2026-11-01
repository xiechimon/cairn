import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hostFixture } from './host-fixture.mjs';

const tierNone = '#!/bin/sh\necho none\n';

function dispatch(t, options, env = {}) {
  const fixture = hostFixture(t, {
    ...options,
    hostFiles: { '.cairn/tools/governor/tier.sh': tierNone },
  });
  return fixture.run('lanes/dispatch-issue.sh', ['77', 'implement'], env);
}

test('dispatch-issue refuses a closed issue', (t) => {
  const result = dispatch(t, { gh: { state: 'CLOSED' } });
  assert.equal(result.status, 3);
  assert.match(result.stdout, /#77 not dispatched: issue state is CLOSED/);
});

test('dispatch-issue refuses an issue whose state cannot be read', (t) => {
  const result = dispatch(t, { gh: { state: '' } });
  assert.equal(result.status, 3);
  assert.match(result.stdout, /issue state is unreadable/);
});

test('dispatch-issue lets a main-red note bypass the state check', (t) => {
  const result = dispatch(t, { gh: { state: 'CLOSED' } }, { EXTRA_NOTE: 'main-red follow-up' });
  assert.doesNotMatch(result.stdout, /issue state is/);
});

test('dispatch-issue refuses an issue on the never list before reading its state', (t) => {
  const result = dispatch(t, { gh: { state: 'OPEN' }, lists: { never: ['77'] } });
  assert.equal(result.status, 3);
  assert.match(result.stdout, /#77 is on the never-dispatch list/);
  assert.deepEqual(result.ghLines, []);
});

test('dispatch-issue never-list match is exact, not a prefix', (t) => {
  const result = dispatch(t, { gh: { state: 'OPEN' }, lists: { never: ['770', '7'] } });
  assert.doesNotMatch(result.stdout, /never-dispatch/);
});

test('dispatch-issue does not look at by:batch or batch:B*/batch:C* labels today', (t) => {
  const result = dispatch(t, {
    gh: { state: 'OPEN', labels: ['by:batch', 'batch:B1', 'batch:C1'] },
  });
  assert.match(result.stdout, /#77 has no tier yet; not dispatching/);
  assert.equal(
    result.ghLines.some((line) => /labels/.test(line)),
    false,
  );
});
