import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
  const startsWith = (value, prefix) => String(value).startsWith(prefix);
  const run = (expression) =>
    new Function('github', 'format', 'startsWith', `return (${expression});`)(
      context,
      format,
      startsWith,
    );
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
const push = (ref, sha = '1111111111111111111111111111111111111111') => ({
  event_name: 'push',
  ref,
  sha,
  event: {},
});

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

test('ci main pushes get per-commit concurrency groups and never cancel running commits', () => {
  const first = decision('ci', push('refs/heads/main', 'aaaaaaa'));
  const second = decision('ci', push('refs/heads/main', 'bbbbbbb'));
  assert.equal(first.group, 'ci-push-refs/heads/main-aaaaaaa');
  assert.equal(second.group, 'ci-push-refs/heads/main-bbbbbbb');
  assert.notEqual(first.group, second.group);
  assert.equal(first.cancel, false);
  assert.equal(second.cancel, false);
});

test('non-pr fallback refs stay separate from main pushes and never cancel', () => {
  const main = decision('ci', push('refs/heads/main', 'aaaaaaa'));
  const manual = decision('ci', {
    event_name: 'workflow_dispatch',
    ref: 'refs/heads/main',
    event: {},
  });
  assert.notEqual(manual.group, main.group);
  assert.equal(manual.cancel, false);
});

test('a pull request never shares a group with a main push', () => {
  const pr = decision('ci', pull(2900));
  assert.notEqual(pr.group, decision('ci', push('refs/heads/main')).group);
  assert.match(pr.group, /^ci-pr-\d+$/);
});

test('queue pushes share one ref group and a newer head cancels the stale run', () => {
  const first = decision('ci', push('refs/heads/queue/main', 'aaaaaaa'));
  const second = decision('ci', push('refs/heads/queue/main', 'bbbbbbb'));
  assert.equal(first.group, 'ci-queue-refs/heads/queue/main');
  assert.equal(first.group, second.group);
  assert.equal(first.cancel, true);
  assert.equal(second.cancel, true);
});

test('queue cancellation does not leak into main or other branches', () => {
  const main = decision('ci', push('refs/heads/main', 'aaaaaaa'));
  assert.equal(main.group, 'ci-push-refs/heads/main-aaaaaaa');
  assert.equal(main.cancel, false);
  const other = decision('ci', push('refs/heads/feature-x', 'bbbbbbb'));
  assert.equal(other.group, 'ci-push-refs/heads/feature-x-bbbbbbb');
  assert.equal(other.cancel, false);
});

test('promote listens for completed ci runs on queue refs and serializes promotions', () => {
  const text = readFileSync(join(WORKFLOWS, 'promote.yml'), 'utf8');
  assert.match(
    text,
    /workflow_run:\s*\n\s*workflows: \[ci\]\s*\n\s*types: \[completed\]\s*\n\s*branches: \['queue\/\*\*'\]/,
  );
  const { group, cancel } = concurrencyOf('promote');
  assert.equal(group, 'promote-main');
  assert.equal(cancel, 'false');
});
