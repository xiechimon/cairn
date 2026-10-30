import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const directory = import.meta.dirname;
for (const mode of ['readable', 'unreadable', 'missing']) {
  test(`canary ${mode} reports all channels without content`, {
    skip: mode === 'unreadable' && process.getuid() === 0,
  }, (t) => {
    const root = mkdtempSync(join(tmpdir(), 'reach-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const path = join(root, 'secret with spaces');
    if (mode !== 'missing') writeFileSync(path, 'NEVER_PRINT_THIS_SECRET');
    if (mode === 'unreadable') chmodSync(path, 0);
    const run = spawnSync('bash', [join(directory, 'canary.sh'), '--paths', path], {
      encoding: 'utf8',
    });
    assert.equal(run.status, mode === 'readable' ? 1 : 0, run.stderr);
    assert.equal(run.stdout.includes('NEVER_PRINT_THIS_SECRET'), false);
    const lines = run.stdout.trim().split('\n');
    assert.equal(lines.length, 7);
    for (const channel of ['cat', 'symlink', 'python', 'node', 'subprocess', 'dd', 'cp'])
      assert.ok(
        lines.some((line) =>
          line.startsWith(`${mode === 'readable' ? 'READ' : 'BLOCKED'} ${channel} `),
        ),
      );
  });
}
test('canary validates arguments and reports process channels', () => {
  assert.equal(spawnSync('bash', [join(directory, 'canary.sh')]).status, 2);
  const run = spawnSync('bash', [join(directory, 'canary.sh'), '--pid', `${process.pid}`], {
    encoding: 'utf8',
  });
  assert.match(run.stdout, /(?:READ|BLOCKED|SKIPPED) environ /);
  assert.match(run.stdout, /(?:READ|BLOCKED|SKIPPED) mem /);
});
test('setup dry run describes operations and leaves scratch unchanged', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'setup-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'sentinel'), 'unchanged');
  const run = spawnSync('bash', [join(directory, 'setup-runner-linux.sh'), '--dry-run'], {
    encoding: 'utf8',
    cwd: root,
  });
  assert.equal(run.status, 0, run.stderr);
  for (const term of ['cairn-runner', '700', '750', '640', 'quarantine', 'cairn-broker'])
    assert.ok(run.stdout.includes(term));
  assert.deepEqual(readdirSync(root), ['sentinel']);
  assert.equal(readFileSync(join(root, 'sentinel'), 'utf8'), 'unchanged');
});
