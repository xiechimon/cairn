import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, expect, test } from 'vitest';

const root = resolve(import.meta.dirname, '../../..');
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test.each([
  ['fresh', true, '2026-10-31T11:59:00Z', 0, 'complete'],
  ['stale', true, '2026-10-30T11:59:59Z', 1, 'incomplete'],
  ['failed', false, '2026-10-31T11:59:00Z', 1, 'incomplete'],
  ['future', true, '2026-11-01T11:59:00Z', 1, 'incomplete'],
  ['invalid', true, 'invalid', 1, 'incomplete'],
])('check reports %s smoke record', (_name, ok, at, status, label) => {
  const dir = mkdtempSync(join(tmpdir(), 'cairn-smoke-'));
  dirs.push(dir);
  const file = join(dir, 'smoke.json');
  writeFileSync(file, JSON.stringify({ ok, at, model: 'claude-sonnet-4-6' }));
  const result = spawnSync(
    process.execPath,
    [join(root, 'scripts/ops/check-real-smoke.mjs'), file, '2026-10-31T12:00:00Z'],
    { encoding: 'utf8' },
  );
  expect(result.status).toBe(status);
  expect(result.stdout.trim()).toBe(label);
});

test('missing and malformed records are incomplete', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cairn-smoke-'));
  dirs.push(dir);
  const file = join(dir, 'smoke.json');
  for (const body of [undefined, '{', '{}', '{"ok":true,"at":"2026-10-31T12:00:00Z"}']) {
    if (body !== undefined) writeFileSync(file, body);
    const result = spawnSync(
      process.execPath,
      [join(root, 'scripts/ops/check-real-smoke.mjs'), file],
      { encoding: 'utf8' },
    );
    expect(result.status).toBe(1);
    expect(result.stdout.trim()).toBe('incomplete');
  }
});

test('nightly timer is persistent and the real runner refuses CI before executing', () => {
  const timer = readFileSync(join(root, 'scripts/ops/systemd/cairn-real-smoke.timer'), 'utf8');
  expect(timer).toContain('OnCalendar=*-*-*');
  expect(timer).toContain('Persistent=true');
  expect(() =>
    execFileSync(process.execPath, [join(root, 'scripts/ops/real-smoke.mjs')], {
      env: { ...process.env, CI: '1' },
      stdio: 'pipe',
    }),
  ).toThrow();
});
