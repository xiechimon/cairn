import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const script = resolve('scripts/ops/host/tools/governor/brake.sh');
const windowStart = '2026-11-01T13:00:00';
const inWindow = '2026-11-01T14:30:00.000Z';
const expired = '2026-11-01T12:30:00.000Z';

const attempt = (verdict, at = inWindow) => ({
  at,
  pr: 1,
  sha: 'a'.repeat(40),
  verdict,
  action: verdict === 'pass' ? 'auto-merge' : 'auto-merge-off',
  rc: verdict ? 0 : 1,
});
const admin = (action) => ({ at: inWindow, pr: 1, sha: 'a'.repeat(40), action });
const many = (n, make) => Array.from({ length: n }, make);

function runBrake(t, { rows, history = true, brakeOn = false, openIssue = false }) {
  const home = mkdtempSync(join(tmpdir(), 'brake-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const bin = join(home, 'bin');
  mkdirSync(bin);
  mkdirSync(join(home, '.local/state/review-gate'), { recursive: true });
  mkdirSync(join(home, '.local/state/overnight'), { recursive: true });
  if (history)
    writeFileSync(
      join(home, '.local/state/review-gate/runs.jsonl'),
      typeof rows === 'string' ? rows : rows.map((row) => `${JSON.stringify(row)}\n`).join(''),
    );
  const brakeFile = join(home, '.local/state/overnight/brake');
  if (brakeOn) writeFileSync(brakeFile, 'earlier reason\n');
  const calls = join(home, 'calls');
  writeFileSync(calls, '');
  writeFileSync(
    join(bin, 'date'),
    `#!/bin/sh\ncase "$*" in *"-d"*) echo ${windowStart};; *) echo 15:00;; esac\n`,
  );
  writeFileSync(
    join(bin, 'gh'),
    `#!/bin/sh\nprintf '%s\\n' "$*" >> "${calls}"\ncase "$*" in "issue list"*) ${openIssue ? 'echo 2470' : 'true'};; esac\n`,
  );
  chmodSync(join(bin, 'date'), 0o755);
  chmodSync(join(bin, 'gh'), 0o755);
  const result = spawnSync('bash', [script], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}` },
  });
  const gh = readFileSync(calls, 'utf8');
  return {
    result,
    on: existsSync(brakeFile),
    reason: existsSync(brakeFile) ? readFileSync(brakeFile, 'utf8') : '',
    created: gh.includes('issue create'),
    closed: gh.includes('issue close'),
  };
}

test('administrative rows without a verdict never count as failed reviews (#2470)', (t) => {
  const rows = [
    ...many(5, () => attempt('pass')),
    ...many(3, () => attempt(null)),
    ...many(3, () => admin('stall-alert')),
    ...many(3, () => admin('stall-label')),
    ...many(4, () => ({ ...admin('status'), state: 'success' })),
    admin('rearmed'),
    admin('human-label'),
  ];
  const f = runBrake(t, { rows });
  assert.equal(f.result.status, 0, f.result.stderr);
  assert.equal(f.on, false, f.result.stdout);
  assert.equal(f.created, false);
});

test('a brake held only by administrative rows releases and closes its issue', (t) => {
  const rows = [...many(6, () => attempt('pass')), ...many(12, () => admin('status'))];
  const f = runBrake(t, { rows, brakeOn: true, openIssue: true });
  assert.equal(f.on, false, f.result.stdout);
  assert.equal(f.closed, true);
});

test('a true majority of attempts without a verdict still engages the brake', (t) => {
  const rows = [...many(3, () => attempt('pass')), ...many(5, () => attempt(null))];
  const f = runBrake(t, { rows });
  assert.equal(f.on, true);
  assert.match(f.reason, /no verdict \(5 of 8\)/);
  assert.equal(f.created, true);
});

test('exactly half without a verdict does not engage the brake', (t) => {
  const rows = [...many(4, () => attempt('pass')), ...many(4, () => attempt(null))];
  assert.equal(runBrake(t, { rows }).on, false);
});

test('fewer than eight attempts never engage the brake', (t) => {
  assert.equal(runBrake(t, { rows: many(7, () => attempt(null)) }).on, false);
});

test('attempts older than the two-hour window do not count', (t) => {
  const rows = [...many(8, () => attempt(null, expired)), ...many(2, () => attempt('pass'))];
  assert.equal(runBrake(t, { rows }).on, false);
});

test('carried-over passes are not attempts', (t) => {
  const rows = [
    ...many(3, () => attempt('pass')),
    ...many(5, () => attempt(null)),
    ...many(10, () => ({ ...attempt('pass'), action: 'carried-over' })),
  ];
  assert.equal(runBrake(t, { rows }).on, true);
});

test('a BLOCK share over 70% engages the brake and 5 of 8 does not', (t) => {
  const over = [...many(2, () => attempt('pass')), ...many(6, () => attempt('block'))];
  const at = runBrake(t, { rows: over });
  assert.equal(at.on, true);
  assert.match(at.reason, /BLOCK \(6 of 8\)/);
  const under = [...many(3, () => attempt('pass')), ...many(5, () => attempt('block'))];
  assert.equal(runBrake(t, { rows: under }).on, false);
});

test('a missing review history never releases an engaged brake', (t) => {
  const f = runBrake(t, { rows: [], history: false, brakeOn: true, openIssue: true });
  assert.equal(f.on, true);
  assert.equal(f.closed, false);
  assert.match(f.result.stdout + f.result.stderr, /review history unreadable/);
});

test('a corrupt review history never releases an engaged brake', (t) => {
  const f = runBrake(t, { rows: '{"at": broken\n', brakeOn: true, openIssue: true });
  assert.equal(f.on, true);
  assert.equal(f.closed, false);
});
