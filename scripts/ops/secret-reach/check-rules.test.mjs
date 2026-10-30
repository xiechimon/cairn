import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test('dispatcher checker delegates read-only validation and preserves named failures', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'check-rules-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const apply = join(root, 'apply.sh');
  writeFileSync(
    apply,
    '#!/bin/bash\n[ "$1" = check ] || exit 99\necho "Missing rule: fixture IPv6 destination" >&2\nexit 1\n',
  );
  chmodSync(apply, 0o700);
  const checker = join(root, 'check.sh');
  writeFileSync(
    checker,
    readFileSync(join(import.meta.dirname, 'check-rules.sh'), 'utf8').replaceAll(
      '/etc/cairn-runner-firewall/apply.sh',
      apply,
    ),
  );
  const run = spawnSync('/bin/bash', [checker], { encoding: 'utf8' });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /Missing rule: fixture IPv6 destination/);
  writeFileSync(apply, '#!/bin/bash\n[ "$1" = check ] || exit 99\nexit 0\n');
  assert.equal(spawnSync('/bin/bash', [checker]).status, 0);
  rmSync(apply);
  assert.notEqual(spawnSync('/bin/bash', [checker]).status, 0);
});
