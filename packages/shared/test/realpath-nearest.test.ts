import { mkdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { cleanupTestTempDirs, makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { realpathOfNearest } from '../src/node/realpath-nearest.js';

const root = realpathSync(makeTestTempDir('realpath-nearest-'));
afterAll(() => cleanupTestTempDirs());

describe('realpathOfNearest', () => {
  test('resolves existing paths and missing descendants beneath an existing directory', () => {
    const dir = join(root, 'existing');
    mkdirSync(dir, { recursive: true });
    expect(realpathOfNearest(dir)).toBe(dir);
    expect(realpathOfNearest(join(dir, 'a', 'b'))).toBe(join(dir, 'a', 'b'));
  });

  test('follows dangling absolute, relative, chained, and nested symlinks', () => {
    const base = join(root, 'dangling');
    const secret = join(base, '.ssh');
    const work = join(base, 'work');
    mkdirSync(secret, { recursive: true });
    mkdirSync(work, { recursive: true });

    const absLink = join(work, 'abs');
    symlinkSync(join(secret, 'new_key'), absLink);
    expect(realpathOfNearest(absLink)).toBe(join(secret, 'new_key'));
    expect(realpathOfNearest(`${absLink}/`)).toBe(join(secret, 'new_key'));
    expect(realpathOfNearest(`${absLink}//child`)).toBe(join(secret, 'new_key', 'child'));

    const relLink = join(work, 'rel');
    symlinkSync('../.ssh/rel_key', relLink);
    expect(realpathOfNearest(relLink)).toBe(join(secret, 'rel_key'));

    const dirLink = join(work, 'dir');
    symlinkSync(join(secret, 'sub'), dirLink);
    expect(realpathOfNearest(join(dirLink, 'deep', 'id'))).toBe(join(secret, 'sub', 'deep', 'id'));

    const hop2 = join(work, 'hop2');
    const hop1 = join(work, 'hop1');
    const hopTrailing = join(work, 'hop-trailing');
    symlinkSync(join(secret, 'chain'), hop2);
    symlinkSync(join(hop2, 'tail'), hop1);
    symlinkSync(`${hop2}/`, hopTrailing);
    expect(realpathOfNearest(hop1)).toBe(join(secret, 'chain', 'tail'));
    expect(realpathOfNearest(hopTrailing)).toBe(join(secret, 'chain'));

    const existingFile = join(secret, 'existing');
    writeFileSync(existingFile, 'secret');
    const fileLink = join(work, 'file-link');
    symlinkSync(existingFile, fileLink);
    expect(realpathOfNearest(`${fileLink}/`)).toBe(existingFile);
    expect(realpathOfNearest(`${fileLink}//x`)).toBe(join(existingFile, 'x'));
  });

  test('resolves symlink before parent traversal instead of lexically collapsing it', () => {
    const base = join(root, 'dotdot');
    const secret = join(base, '.ssh');
    const nested = join(secret, 'sub');
    const work = join(base, 'work');
    mkdirSync(nested, { recursive: true });
    mkdirSync(work, { recursive: true });

    const link = join(work, 'link');
    symlinkSync(nested, link);
    expect(realpathOfNearest(`${link}/../missing`)).toBe(join(secret, 'missing'));
  });

  test('handles symlink cycles, deep chains, null bytes, and ENOTDIR paths safely', () => {
    const base = join(root, 'edge');
    mkdirSync(base, { recursive: true });
    const a = join(base, 'a');
    const b = join(base, 'b');
    const c = join(base, 'c');
    symlinkSync(b, a);
    symlinkSync(c, b);
    symlinkSync(a, c);
    expect(realpathOfNearest(a)).toBe(a);
    expect(realpathOfNearest(join(a, 'child'))).toBe(join(a, 'child'));
    expect(() => realpathOfNearest(a, { onLoop: 'throw' })).toThrow(/ELOOP/);

    expect(() => realpathOfNearest(`${base}\0bad`)).toThrow(/null byte/);

    const file = join(base, 'plain');
    writeFileSync(file, 'ok');
    expect(realpathOfNearest(join(file, 'child'))).toBe(join(file, 'child'));
  });
});
