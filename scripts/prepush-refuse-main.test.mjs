import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { refusedRefs } from './prepush-refuse-main.mjs';

const root = join(import.meta.dirname, '..');
const sha = 'a'.repeat(40);
const zero = '0'.repeat(40);
const line = (local, remote) => `${local} ${sha} ${remote} ${zero}\n`;

test('refuses a push whose remote ref is main, whatever the local ref is', () => {
  assert.deepEqual(refusedRefs(line('refs/heads/web/chat', 'refs/heads/main')), [
    'refs/heads/main',
  ]);
  assert.deepEqual(refusedRefs(line('HEAD', 'refs/heads/main')), ['refs/heads/main']);
  assert.deepEqual(refusedRefs(line('(delete)', 'refs/heads/main')), ['refs/heads/main']);
});

test('finds main among several pushed refs', () => {
  const stdin = line('refs/heads/a', 'refs/heads/a') + line('refs/heads/b', 'refs/heads/main');
  assert.deepEqual(refusedRefs(stdin), ['refs/heads/main']);
});

test('allows topic branches, tags and a topic branch whose local name is main', () => {
  assert.deepEqual(refusedRefs(line('refs/heads/main', 'refs/heads/main-fix')), []);
  assert.deepEqual(refusedRefs(line('refs/heads/main', 'refs/heads/ops/main')), []);
  assert.deepEqual(refusedRefs(line('refs/heads/main', 'refs/tags/main')), []);
  assert.deepEqual(refusedRefs(''), []);
});

test('the script exits non-zero on stdin that pushes main and zero otherwise', () => {
  const run = (input) =>
    spawnSync(process.execPath, [join(root, 'scripts/prepush-refuse-main.mjs')], {
      input,
      encoding: 'utf8',
    });
  const refused = run(line('refs/heads/x', 'refs/heads/main'));
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /refs\/heads\/main/);
  assert.equal(run(line('refs/heads/x', 'refs/heads/x')).status, 0);
});

test('the pre-push hook runs the guard before the prepush gates', () => {
  const hook = readFileSync(join(root, '.husky/pre-push'), 'utf8');
  const guard = hook.indexOf('node scripts/prepush-refuse-main.mjs');
  assert.notEqual(guard, -1);
  assert.ok(guard < hook.indexOf('pnpm prepush'));
});
