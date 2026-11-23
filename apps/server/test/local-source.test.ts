import { mkdirSync, symlinkSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { samePathOrInside } from '../src/lib/local-source.js';

const { variantStat, aliasTarget } = vi.hoisted(() => ({
  variantStat: new Map<string, 'enoent' | 'alias' | 'symlink'>(),
  aliasTarget: new Map<string, string>(),
}));

vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>();
  const wrap = (follow: boolean) =>
    ((p: unknown, o?: unknown) => {
      const key = String(p);
      const mode = variantStat.get(key);
      if (mode === 'enoent') {
        const e = new Error('ENOENT') as NodeJS.ErrnoException;
        e.code = 'ENOENT';
        throw e;
      }
      const target = mode === undefined ? key : (aliasTarget.get(key) as string);
      if (mode === 'symlink' && follow) return real.statSync(target, o as never);
      return (follow ? real.statSync : real.lstatSync)(target as never, o as never);
    }) as typeof real.statSync;
  return { ...real, statSync: wrap(true), lstatSync: wrap(false) };
});

function flipName(name: string): string {
  return name.replace(/[a-zA-Z]/g, (c) =>
    c >= 'a' && c <= 'z' ? c.toUpperCase() : c.toLowerCase(),
  );
}

function boundDir(): string {
  const dir = join(makeTestTempDir('cairn-case-bound-'), 'CaseBound');
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('samePathOrInside compares by the probed volume, not the platform', () => {
  test('on a volume that distinguishes case, a case-variant escape reads as outside', () => {
    const dir = boundDir();
    const flipped = join(dirname(dir), flipName(basename(dir)));
    variantStat.set(flipped, 'enoent');
    try {
      expect(samePathOrInside(join(flipped, 'inside'), dir)).toBe(false);
    } finally {
      variantStat.delete(flipped);
    }
  });

  test('on a volume that folds case, a case-variant stays inside', () => {
    const dir = boundDir();
    const flipped = join(dirname(dir), flipName(basename(dir)));
    variantStat.set(flipped, 'alias');
    aliasTarget.set(flipped, dir);
    try {
      expect(samePathOrInside(join(dirname(dir), basename(dir).toLowerCase(), 'inside'), dir)).toBe(
        true,
      );
    } finally {
      variantStat.delete(flipped);
      aliasTarget.delete(flipped);
    }
  });

  test('a flipped-name symlink back to the directory does not prove case folding', () => {
    const dir = boundDir();
    const flipped = join(dirname(dir), flipName(basename(dir)));
    const link = join(makeTestTempDir('cairn-case-link-'), 'link');
    symlinkSync(dir, link);
    variantStat.set(flipped, 'symlink');
    aliasTarget.set(flipped, link);
    try {
      expect(samePathOrInside(join(flipped, 'inside'), dir)).toBe(false);
    } finally {
      variantStat.delete(flipped);
      aliasTarget.delete(flipped);
    }
  });
});
