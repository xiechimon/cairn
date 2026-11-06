import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readConfig, readMachineToken } from '../src/config.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tokenFile(mode: number, content = 'tok-123\n'): string {
  const dir = mkdtempSync(join(tmpdir(), 'coord-cfg-'));
  dirs.push(dir);
  const path = join(dir, 'machine-token');
  writeFileSync(path, content);
  chmodSync(path, mode);
  return path;
}

describe('readMachineToken', () => {
  it('reads a 0600 token file', () => {
    expect(readMachineToken(tokenFile(0o600))).toBe('tok-123');
  });

  it('refuses a token file other users can read', () => {
    expect(() => readMachineToken(tokenFile(0o644))).toThrow(/chmod 600/);
  });

  it('refuses an empty token file', () => {
    expect(() => readMachineToken(tokenFile(0o600, '\n'))).toThrow(/empty/);
  });
});
