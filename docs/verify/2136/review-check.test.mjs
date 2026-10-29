import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('incident handoff leaves recurrence accounting to the collector', () => {
  const events = readFileSync('docs/lessons/events.jsonl', 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(events.filter(event => event.kind === 'recurrence' && event.pr === '2134').length, 0);
});

test('dispatcher message exists and retains the closing trailer', () => {
  const message = spawnSync('git', ['log', '-1', '--format=%B', '--', 'docs/verify/2136/review-check.test.mjs'], { encoding: 'utf8' });
  assert.equal(message.status, 0, message.stderr);
  assert.match(message.stdout, /^Closes #2136$/m);
});

test('recovery fixture executes the recipe without incident wording assertions', () => {
  const source = readFileSync('scripts/commit-author-recovery.test.mjs', 'utf8');
  assert.equal(source.includes("guidance.split('### Incident #2136')"), false);
});
