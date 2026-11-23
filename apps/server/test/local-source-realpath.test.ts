import { lstatSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, onTestFinished, test, vi } from 'vitest';
import { realpathOrResolve } from '../src/lib/local-source.js';

vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>();
  return {
    ...fs,
    lstatSync: vi.fn(fs.lstatSync),
    realpathSync: Object.assign(vi.fn(fs.realpathSync), { native: vi.fn(fs.realpathSync.native) }),
  };
});

test('a missing managed root keeps its real parent and every missing component', () => {
  const alias = resolve('fixture', 'alias');
  const real = resolve('fixture', 'real');
  const parent = join(alias, 'existing');
  const missing = join(parent, 'new');
  const root = join(missing, 'workspaces');
  const native = vi.mocked(realpathSync.native);
  const lstat = vi.mocked(lstatSync);
  onTestFinished(() => {
    native.mockReset();
    lstat.mockReset();
  });
  native.mockImplementation((path) => {
    if (path === parent) return join(real, 'existing');
    if (path === missing || path === root) {
      throw Object.assign(new Error('missing path'), { code: 'ENOENT' });
    }
    throw new Error('unexpected realpath call');
  });
  lstat.mockReturnValue(undefined);

  expect(realpathOrResolve(root)).toBe(join(real, 'existing', 'new', 'workspaces'));
});
