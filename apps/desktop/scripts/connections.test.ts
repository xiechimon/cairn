import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  activeConnectionOf,
  addRemoteConnection,
  LOCAL_CONNECTION_ID,
  normalizeRemoteUrl,
  readConnectionCatalog,
  removeRemoteConnection,
  runnerHomeForConnection,
  setActiveConnection,
} from '../src/connections.js';

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cairn-conn-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('desktop connection catalog', () => {
  test('defaults to local connection and normalizes remote URLs', () => {
    const dir = tempDir();
    const initial = readConnectionCatalog(dir);
    expect(activeConnectionOf(initial)).toEqual({ kind: 'local', id: LOCAL_CONNECTION_ID });
    expect(normalizeRemoteUrl('http://mac-mini.tailnet.ts.net:8787/app/')).toBe(
      'http://mac-mini.tailnet.ts.net:8787',
    );
    expect(() => normalizeRemoteUrl('ftp://invalid')).toThrow();
  });

  test('adds, switches, isolates runner homes, and removes remote connections', () => {
    const dir = tempDir();
    const { added } = addRemoteConnection(dir, {
      name: 'Mac mini',
      url: 'http://100.64.0.21:8787/',
    });
    const switched = setActiveConnection(dir, added.id);
    expect(activeConnectionOf(switched)).toEqual({
      kind: 'remote',
      id: added.id,
      name: 'Mac mini',
      url: 'http://100.64.0.21:8787',
    });

    const baseRunner = join(dir, 'base-runner');
    expect(runnerHomeForConnection(baseRunner, dir, LOCAL_CONNECTION_ID)).toBe(baseRunner);
    expect(runnerHomeForConnection(baseRunner, dir, added.id)).toBe(
      join(dir, 'runner-homes', added.id),
    );

    const afterRemove = removeRemoteConnection(dir, added.id);
    expect(activeConnectionOf(afterRemove)).toEqual({ kind: 'local', id: LOCAL_CONNECTION_ID });
  });
});
