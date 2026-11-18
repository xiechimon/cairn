import { mkdirSync, realpathSync, symlinkSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { FolderPins, resolveFolderPin } from '../src/folder-pins.js';

let scratch: string | undefined;
afterEach(() => {
  if (scratch !== undefined) releaseTestTempDir(scratch);
  scratch = undefined;
});

function dir(...parts: string[]): string {
  if (scratch === undefined) scratch = makeTestTempDir('cairn-folders-');
  const path = join(scratch, ...parts);
  mkdirSync(path, { recursive: true });
  return path;
}

describe('resolveFolderPin', () => {
  test('an existing directory resolves to its canonical path', () => {
    const target = dir('data');
    expect(resolveFolderPin(target)).toBe(realpathSync(target));
  });

  test('relative, traversal, missing, file and root paths are rejected', () => {
    expect(resolveFolderPin('etc/passwd')).toBeNull();
    expect(resolveFolderPin('../up')).toBeNull();
    expect(resolveFolderPin('/srv/../etc')).toBeNull();
    expect(resolveFolderPin(join(dir('a'), 'missing'))).toBeNull();
    expect(resolveFolderPin('/')).toBeNull();
    expect(resolveFolderPin(resolve(sep))).toBeNull();
    expect(resolveFolderPin('~other/Code')).toBeNull();
  });

  test('a tilde pin expands under home and a symlink resolves to its target', () => {
    const home = dir('home');
    const inner = dir('home', 'Code');
    expect(resolveFolderPin('~/Code', home)).toBe(realpathSync(inner));
    const outside = dir('outside');
    const link = join(home, 'link');
    symlinkSync(outside, link);
    expect(resolveFolderPin(link, home)).toBe(realpathSync(outside));
  });
});

describe('FolderPins', () => {
  test('roots always lead with the workspaces root and add enabled confirmed pins', () => {
    const workspaces = dir('workspaces');
    const extra = dir('extra');
    const pins = new FolderPins(workspaces);
    expect(pins.roots()).toEqual([realpathSync(workspaces)]);
    pins.setPins([
      { path: extra, status: 'pending', enabled: true },
      { path: realpathSync(extra), status: 'confirmed', enabled: false },
      { path: dir('confirmed-on'), status: 'confirmed', enabled: true },
    ]);
    const roots = pins.roots();
    expect(roots[0]).toBe(realpathSync(workspaces));
    expect(roots).toHaveLength(2);
  });

  test('report confirms statable pins, rejects invalid ones, and marks vanished pins absent', () => {
    const workspaces = dir('workspaces');
    const good = dir('good');
    const vanished = join(dir('parent'), 'vanished');
    const pins = new FolderPins(workspaces);
    const canonical = realpathSync(good);
    pins.setPins([
      { path: good, status: 'pending', enabled: false },
      { path: 'relative/path', status: 'pending', enabled: false },
      { path: canonical, status: 'confirmed', enabled: true },
      { path: vanished, status: 'confirmed', enabled: true },
    ]);
    const reports = pins.report();
    expect(reports).toEqual([
      { pin: good, status: 'confirmed', canonicalPath: canonical },
      { pin: 'relative/path', status: 'rejected' },
      { pin: canonical, status: 'confirmed', canonicalPath: canonical },
      { pin: vanished, status: 'absent' },
    ]);
  });

  test('a confirmed pin whose stored path is not its canonical path reports absent', () => {
    const workspaces = dir('workspaces');
    const pins = new FolderPins(workspaces);
    const target = dir('target');
    const link = join(dir('links'), 'alias');
    symlinkSync(target, link);
    pins.setPins([{ path: link, status: 'confirmed', enabled: true }]);
    expect(pins.report()).toEqual([{ pin: link, status: 'absent' }]);
  });
});
