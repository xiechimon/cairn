import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const WORKFLOWS = join(import.meta.dirname, '..', '.github/workflows');

function concurrencyOf(name) {
  const text = readFileSync(join(WORKFLOWS, `${name}.yml`), 'utf8');
  const block = /^concurrency:\n {2}group: (.+)\n {2}cancel-in-progress: (.+)\n/m.exec(text);
  assert.ok(block, `${name}.yml needs a top-level concurrency block`);
  return { group: block[1], cancel: block[2] };
}

function evaluate(text, context) {
  const format = (template, ...values) => template.replace(/\{(\d+)\}/g, (_, i) => values[i]);
  const run = (expression) =>
    new Function('github', 'format', `return (${expression});`)(context, format);
  const whole = /^\$\{\{\s*([\s\S]*?)\s*\}\}$/.exec(text);
  if (whole) return run(whole[1]);
  if (!text.includes('${{')) return run(text);
  return text.replace(/\$\{\{\s*([\s\S]*?)\s*\}\}/g, (_, expression) => run(expression));
}

const pull = (number, action = 'synchronize') => ({
  event_name: 'pull_request',
  ref: `refs/pull/${number}/merge`,
  event: { action, pull_request: { number } },
});
const push = (ref) => ({ event_name: 'push', ref, event: {} });

function decision(name, context) {
  const { group, cancel } = concurrencyOf(name);
  return { group: evaluate(group, context), cancel: evaluate(cancel, context) === true };
}

test('ci runs one group per pull request and cancels a superseded head', () => {
  const first = decision('ci', pull(7));
  assert.equal(first.group, 'ci-pr-7');
  assert.equal(first.cancel, true);
  assert.notEqual(first.group, decision('ci', pull(8)).group);
  assert.equal(decision('ci', pull(7, 'opened')).group, first.group);
});

test('ci main pushes share one group and never cancel a running main run', () => {
  const main = decision('ci', push('refs/heads/main'));
  assert.equal(main.group, 'ci-main');
  assert.equal(main.cancel, false);
});

test('prototype pushes are keyed by ref, apart from main and from each other, and never cancel', () => {
  const a = decision('ci', push('refs/heads/prototype/a'));
  const b = decision('ci', push('refs/heads/prototype/b'));
  assert.notEqual(a.group, 'ci-main');
  assert.notEqual(a.group, b.group);
  assert.equal(a.cancel, false);
  assert.equal(b.cancel, false);
});

test('a Mergify merge-queue pull request never shares a group with a main push', () => {
  const queue = decision('ci', pull(2900));
  assert.notEqual(queue.group, decision('ci', push('refs/heads/main')).group);
  assert.match(queue.group, /^ci-pr-\d+$/);
});

for (const name of ['diagram-text-fit', 'commit-author']) {
  test(`${name} cancels a superseded pull request head and never a main push`, () => {
    assert.equal(decision(name, pull(7)).cancel, true);
    assert.notEqual(decision(name, pull(7)).group, decision(name, pull(8)).group);
    if (name === 'commit-author') {
      const main = decision(name, push('refs/heads/main'));
      assert.equal(main.cancel, false);
      assert.notEqual(main.group, decision(name, pull(7)).group);
    }
  });
}

test('pr-evidence keeps no concurrency group (a cancelled newest suite blocked PRs, #2461 and #2496)', () => {
  assert.doesNotMatch(readFileSync(join(WORKFLOWS, 'pr-evidence.yml'), 'utf8'), /^concurrency:/m);
});

test('autonomy-brake keeps its own group without cancelling', () => {
  assert.match(
    readFileSync(join(WORKFLOWS, 'autonomy-brake.yml'), 'utf8'),
    /cancel-in-progress: false/,
  );
  assert.equal(existsSync(join(WORKFLOWS, 'review-gate.yml')), false);
});
