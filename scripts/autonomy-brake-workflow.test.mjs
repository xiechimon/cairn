import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

function runStep(t, file, name, env) {
  const text = readFileSync(file, 'utf8');
  const step = text.split('      - ').find((part) => part.startsWith(`name: ${name}\n`));
  assert.ok(step, `Missing step ${name}`);
  const body = step.match(/ {8}run: \|\n((?: {10}.*\n|\n)+)/)?.[1].replace(/^ {10}/gm, '');
  assert.ok(body);
  const dir = mkdtempSync(join(tmpdir(), 'brake-workflow-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const calls = join(dir, 'calls');
  writeFileSync(calls, '');
  writeFileSync(
    join(dir, 'node'),
    `#!/bin/sh\necho "$*" >> "$CALLS"\ncase "$*" in\n *status) echo '{"paused":'"$PAUSED"'}';;\n *check-pr*) if [ "$PAUSED" = true ]; then exit "$RECOVERY_EXIT"; fi;;\n *verify-recovery*) exit "$RECOVERY_EXIT";;\nesac\n`,
    { mode: 0o755 },
  );
  writeFileSync(join(dir, 'git'), '#!/bin/sh\necho base-brake\n', { mode: 0o755 });
  writeFileSync(join(dir, 'gh'), '#!/bin/sh\necho "$*" >> "$CALLS"\n', { mode: 0o755 });
  const result = spawnSync('bash', ['-e', '-c', body], {
    cwd: dir,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      CALLS: calls,
      RUNNER_TEMP: dir,
      GITHUB_REPOSITORY: 'owner/repo',
      RUN_EVENT: 'push',
      HEAD_REPOSITORY: 'owner/repo',
      PAUSED: 'false',
      RECOVERY_EXIT: '1',
      ...env,
    },
  });
  return { result, dir, calls: () => readFileSync(calls, 'utf8') };
}
test('workflow_run success does not pause or sweep', (t) => {
  const f = runStep(t, '.github/workflows/autonomy-brake.yml', 'Apply the brake', {
    EVENT_NAME: 'workflow_run',
    CONCLUSION: 'success',
    HEAD_BRANCH: 'main',
  });
  assert.equal(f.result.status, 0, f.result.stderr);
  assert.equal(f.calls(), '');
});
test('schedule without a marker restores head signals without opening a marker', (t) => {
  const f = runStep(t, '.github/workflows/autonomy-brake.yml', 'Apply the brake', {
    EVENT_NAME: 'schedule',
  });
  assert.equal(f.result.status, 0, f.result.stderr);
  assert.doesNotMatch(f.calls(), /pause --reason/);
  assert.match(f.calls(), /sweep/);
});
test('failed main workflow pauses and synchronizes the brake', (t) => {
  const f = runStep(t, '.github/workflows/autonomy-brake.yml', 'Apply the brake', {
    EVENT_NAME: 'workflow_run',
    CONCLUSION: 'failure',
    HEAD_BRANCH: 'main',
    FAILED_SHA: 'abc',
    RUN_URL: 'https://example.com/run',
  });
  assert.equal(f.result.status, 0, f.result.stderr);
  assert.match(f.calls(), /pause --reason.*abc.*https:\/\/example.com\/run/);
});
for (const valid of [false, true])
  test(`paused PR recovery=${valid} gates and disarms correctly`, (t) => {
    const f = runStep(t, '.github/workflows/pr-evidence.yml', 'Check the autonomy brake', {
      PAUSED: 'true',
      RECOVERY_EXIT: valid ? '0' : '1',
      PR_NUMBER: '7',
    });
    assert.equal(f.result.status, valid ? 0 : 1, f.result.stderr);
    const disarm = readFileSync('.github/workflows/pr-evidence.yml', 'utf8')
      .split('      - name: Mark the decision pending and disarm auto-merge')[1]
      .split('        run: |\n')[1]
      .replace(/^ {10}/gm, '');
    const r = spawnSync('bash', ['-e', '-c', disarm], {
      cwd: f.dir,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${f.dir}:${process.env.PATH}`,
        CALLS: join(f.dir, 'calls'),
        PR_NUMBER: '7',
        GITHUB_REPOSITORY: 'owner/repo',
      },
    });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(f.calls().includes('--disable-auto'), !valid);
  });
test('required check shape retains unconditional job, trigger coverage, and brake before body checks', () => {
  const text = readFileSync('.github/workflows/pr-evidence.yml', 'utf8');
  assert.ok(
    text.indexOf('name: Check the autonomy brake') < text.indexOf('name: Check PR body evidence'),
  );
  assert.match(text, /needs-decision\.flag.*autonomy-paused\.flag/);
});

test('paused schedule sweeps and workflow permissions and triggers retain the outage path', (t) => {
  const f = runStep(t, '.github/workflows/autonomy-brake.yml', 'Apply the brake', {
    EVENT_NAME: 'schedule',
    PAUSED: 'true',
  });
  assert.equal(f.result.status, 0, f.result.stderr);
  assert.match(f.calls(), /sweep/);
  assert.doesNotMatch(f.calls(), /pause --reason/);
  const text = readFileSync('.github/workflows/autonomy-brake.yml', 'utf8');
  for (const line of [
    'workflows: [ci]',
    'types: [completed]',
    'branches: [main]',
    "cron: '*/15 * * * *'",
    'contents: write',
    'pull-requests: write',
    'issues: write',
  ])
    assert.ok(text.includes(line), line);
  assert.match(text, /actions\/checkout@[a-f0-9]{40}/);
  assert.match(text, /ref: main\n\s+fetch-depth: 0/);
});

test('PR evidence executes only the trusted base brake', (t) => {
  const f = runStep(t, '.github/workflows/pr-evidence.yml', 'Check the autonomy brake', {
    PR_NUMBER: '7',
  });
  assert.equal(f.result.status, 0, f.result.stderr);
  assert.doesNotMatch(f.calls(), /(?:^|\n)scripts\/autonomy-brake\.mjs/);
  assert.match(f.calls(), /autonomy-brake\.mjs check-pr 7/);
  const text = readFileSync('.github/workflows/pr-evidence.yml', 'utf8');
  assert.match(
    text,
    /git show origin\/main:scripts\/autonomy-brake\.mjs > "\$RUNNER_TEMP\/autonomy-brake\.mjs"/,
  );
});
for (const conclusion of ['cancelled', 'timed_out'])
  test(`main push conclusion ${conclusion} applies the brake`, (t) => {
    const f = runStep(t, '.github/workflows/autonomy-brake.yml', 'Apply the brake', {
      EVENT_NAME: 'workflow_run',
      CONCLUSION: conclusion,
      HEAD_BRANCH: 'main',
    });
    assert.equal(f.result.status, 0, f.result.stderr);
    assert.match(f.calls(), /pause --reason/);
  });
for (const event of ['pull_request', 'push'])
  test(`fork main ${event} cannot apply the brake`, (t) => {
    const f = runStep(t, '.github/workflows/autonomy-brake.yml', 'Apply the brake', {
      EVENT_NAME: 'workflow_run',
      RUN_EVENT: event,
      HEAD_REPOSITORY: 'fork/repo',
      CONCLUSION: 'failure',
      HEAD_BRANCH: 'main',
    });
    assert.equal(f.result.status, 0, f.result.stderr);
    assert.equal(f.calls(), '');
  });
