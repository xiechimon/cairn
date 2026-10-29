import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('incident handoff leaves recurrence accounting to the collector', () => {
  const events = readFileSync('docs/lessons/events.jsonl', 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(events.filter(event => event.kind === 'recurrence' && event.pr === '2134').length, 0);
});

test('dispatcher message exists and retains the closing trailer', () => {
  assert.match(readFileSync('COMMIT_MSG.txt', 'utf8'), /\nCloses #2136\n$/);
});

test('recovery fixture executes the recipe without incident wording assertions', () => {
  const source = readFileSync('scripts/commit-author-recovery.test.mjs', 'utf8');
  assert.equal(source.includes("guidance.split('### Incident #2136')"), false);
});
