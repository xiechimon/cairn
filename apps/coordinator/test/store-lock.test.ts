import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { acquireStoreLock } from '../src/store-lock.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function store(): string {
  const dir = mkdtempSync(join(tmpdir(), 'coord-lock-'));
  dirs.push(dir);
  return join(dir, 'coordinator.sqlite');
}

describe('acquireStoreLock', () => {
  it('writes the pid next to the store and removes it on release', () => {
    const path = store();
    const release = acquireStoreLock(path, 4242, () => false);
    expect(readFileSync(`${path}.lock`, 'utf8')).toBe('4242');
    release();
    expect(existsSync(`${path}.lock`)).toBe(false);
  });

  it('refuses to start while another live sidecar holds the store', () => {
    const path = store();
    writeFileSync(`${path}.lock`, '1111');
    expect(() => acquireStoreLock(path, 4242, (pid) => pid === 1111)).toThrow(/pid 1111/);
    expect(readFileSync(`${path}.lock`, 'utf8')).toBe('1111');
  });

  it('takes over a lock left by a sidecar that died', () => {
    const path = store();
    writeFileSync(`${path}.lock`, '1111');
    acquireStoreLock(path, 4242, () => false);
    expect(readFileSync(`${path}.lock`, 'utf8')).toBe('4242');
  });

  it('release leaves a lock another process has since taken', () => {
    const path = store();
    const release = acquireStoreLock(path, 4242, () => false);
    writeFileSync(`${path}.lock`, '5555');
    release();
    expect(readFileSync(`${path}.lock`, 'utf8')).toBe('5555');
  });
});
