import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

function runAuditStep(t, env) {
  const text = readFileSync('.github/workflows/merge-queue-audit.yml', 'utf8');
  const step = text
    .split('      - ')
    .find((part) => part.startsWith('name: Audit every commit that landed\n'));
  assert.ok(step, 'Missing step Audit every commit that landed');
  const body = step.match(/ {8}run: \|\n((?: {10}.*\n|\n)+)/)?.[1].replace(/^ {10}/gm, '');
  assert.ok(body);
  const dir = mkdtempSync(join(tmpdir(), 'queue-audit-workflow-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const calls = join(dir, 'calls');
  writeFileSync(calls, '');
  writeFileSync(
    join(dir, 'node'),
    `#!/bin/sh\necho "queue-audit: #1 merged without a queued label before now"\nexit "$AUDIT_EXIT"\n`,
    { mode: 0o755 },
  );
  writeFileSync(
    join(dir, 'git'),
    `#!/bin/sh\ncase "$*" in\n *rev-list*) echo "$AUDIT_SHAS" ;;\n *) exit 0 ;;\nesac\n`,
    { mode: 0o755 },
  );
  writeFileSync(
    join(dir, 'gh'),
    `#!/bin/sh\necho "$*" >> "$CALLS"\ncase "$1 $2" in\n 'issue list'*) echo '' ;;\n 'issue create'*) echo created ;;\n 'issue comment'*) echo commented ;;\nesac\n`,
    { mode: 0o755 },
  );
  const result = spawnSync('bash', ['-e', '-c', body], {
    cwd: dir,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      CALLS: calls,
      INPUT_SHA: '',
      BEFORE: 'base-sha',
      HEAD_SHA: 'head-sha',
      AUDIT_EXIT: '1',
      AUDIT_SHAS: 'one-sha',
      ...env,
    },
  });
  return { result, calls: () => readFileSync(calls, 'utf8') };
}

test('a violation files the issue before the step exits red', (t) => {
  const f = runAuditStep(t, {});
  assert.equal(f.result.status, 1, f.result.stderr);
  assert.match(f.result.stdout, /merged without a queued label/);
  assert.match(
    f.calls(),
    /issue create --title Merged outside the merge queue --body .* --assignee xiechimon/s,
  );
});

test('a clean merge exits green and files nothing', (t) => {
  const f = runAuditStep(t, { AUDIT_EXIT: '0' });
  assert.equal(f.result.status, 0, f.result.stderr);
  assert.equal(f.calls(), '');
});

test('an audit crash reports the failure without filing', (t) => {
  const f = runAuditStep(t, { AUDIT_EXIT: '2' });
  assert.equal(f.result.status, 2, f.result.stderr);
  assert.equal(f.calls(), '');
});
