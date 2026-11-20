import { existsSync, lstatSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import {
  claudeConfigHome,
  migrateRuntimeHomes,
  piHome,
  runtimeHome,
  toolInstallRoot,
} from '../src/runtime-homes.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) releaseTestTempDir(dir);
});

function tmp(): string {
  const dir = makeTestTempDir('runtime-homes-');
  dirs.push(dir);
  return dir;
}

describe('migrateRuntimeHomes', () => {
  test('moves every legacy layout into homes/ and tools/', () => {
    const cairn = join(tmp(), 'cairn');
    const real = join(tmp(), 'real');
    for (const dir of [
      join(cairn, 'claude'),
      join(cairn, 'agent-runtime'),
      join(cairn, 'agent-homes', 'gemini'),
      join(real, '.local', 'share', 'cairn', 'devin', 'home'),
      join(real, '.local', 'share', 'cairn', 'antigravity'),
    ]) {
      mkdirSync(dir, { recursive: true });
    }

    const moved = migrateRuntimeHomes(cairn, real);

    expect(moved.sort()).toEqual(
      [
        'agent-homes/gemini',
        'agent-runtime',
        'claude',
        'devin-home',
        'tools/antigravity',
        'tools/devin',
      ].sort(),
    );
    expect(existsSync(claudeConfigHome(cairn))).toBe(true);
    expect(existsSync(piHome(cairn))).toBe(true);
    expect(existsSync(runtimeHome(cairn, 'gemini'))).toBe(true);
    expect(existsSync(runtimeHome(cairn, 'devin'))).toBe(true);
    expect(existsSync(toolInstallRoot(cairn, 'devin'))).toBe(true);
    expect(existsSync(toolInstallRoot(cairn, 'antigravity'))).toBe(true);
    expect(existsSync(join(cairn, 'claude'))).toBe(false);
  });

  test('keeps the destination when both trees exist', () => {
    const cairn = join(tmp(), 'cairn');
    const real = join(tmp(), 'real');
    mkdirSync(join(cairn, 'claude'), { recursive: true });
    mkdirSync(claudeConfigHome(cairn), { recursive: true });
    writeFileSync(join(claudeConfigHome(cairn), 'settings.json'), '{}\n');
    writeFileSync(join(cairn, 'claude', 'settings.json'), '{"stale":true}\n');

    const moved = migrateRuntimeHomes(cairn, real);

    expect(moved).toEqual([]);
    expect(existsSync(join(cairn, 'claude', 'settings.json'))).toBe(true);
  });

  test('never moves a symlinked legacy path', () => {
    const cairn = join(tmp(), 'cairn');
    const real = join(tmp(), 'real');
    const elsewhere = join(real, 'elsewhere');
    mkdirSync(elsewhere, { recursive: true });
    writeFileSync(join(elsewhere, 'token'), 'secret\n');
    mkdirSync(cairn, { recursive: true });
    mkdirSync(join(real, '.local', 'share', 'cairn'), { recursive: true });
    symlinkSync(elsewhere, join(cairn, 'claude'));
    symlinkSync(elsewhere, join(real, '.local', 'share', 'cairn', 'devin'));

    const moved = migrateRuntimeHomes(cairn, real);

    expect(moved).toEqual([]);
    expect(lstatSync(join(cairn, 'claude')).isSymbolicLink()).toBe(true);
    expect(lstatSync(join(real, '.local', 'share', 'cairn', 'devin')).isSymbolicLink()).toBe(true);
    expect(existsSync(claudeConfigHome(cairn))).toBe(false);
    expect(existsSync(toolInstallRoot(cairn, 'devin'))).toBe(false);
  });
});
