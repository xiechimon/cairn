import { chmodSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { FS_LIST_MAX_ENTRIES } from '@cairn/shared';
import { afterAll, describe, expect, test } from 'vitest';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { HttpError } from '../src/lib/errors.js';
import { listDir } from '../src/services/fs-list.js';
import { bootServer, req } from './helpers.js';

const roots: string[] = [];
function makeRoot(): string {
  const root = makeTestTempDir('cairn-fs-list-');
  roots.push(root);
  return root;
}
afterAll(() => {
  for (const root of roots) {
    chmodSync(root, 0o755);
    rmSync(root, { recursive: true, force: true });
  }
});

const isRoot = process.getuid?.() === 0;

function expectReason(fn: () => unknown, status: number, reason: string): void {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(status);
    expect((err as HttpError).reason).toBe(reason);
    return;
  }
  throw new Error('expected listDir to throw');
}

describe('services/fs-list listDir -- live-scan surface (S family)', () => {
  test('S1 dir default/empty string = server $HOME start', () => {
    const home = realpathSync(homedir());
    expect(listDir(undefined).path).toBe(home);
    expect(listDir('').path).toBe(home);
  });

  test('S2/S17 relative path and `~` prefix = 400 not_absolute (~ not expanded)', () => {
    expectReason(() => listDir('rel/ative'), 400, 'not_absolute');
    expectReason(() => listDir('~/Code'), 400, 'not_absolute');
  });

  test('S3 nonexistent = 400 not_found', () => {
    expectReason(() => listDir(join(makeRoot(), 'gone')), 400, 'not_found');
  });

  test('S4 plain file = 400 not_dir', () => {
    const root = makeRoot();
    writeFileSync(join(root, 'file.txt'), 'x');
    expectReason(() => listDir(join(root, 'file.txt')), 400, 'not_dir');
  });

  test.skipIf(isRoot)('S5 readdir denied (chmod 000) = 400 not_readable', () => {
    const root = makeRoot();
    const locked = join(root, 'locked');
    mkdirSync(locked);
    chmodSync(locked, 0o000);
    try {
      expectReason(() => listDir(locked), 400, 'not_readable');
    } finally {
      chmodSync(locked, 0o755);
    }
  });

  test('S6/S21 symlinked directory = realpath normalization, path returns the canonical identity', () => {
    const root = makeRoot();
    const real = join(root, 'real');
    mkdirSync(join(real, 'inner'), { recursive: true });
    const link = join(root, 'link');
    symlinkSync(real, link);
    const res = listDir(link);
    expect(res.path).toBe(realpathSync(real));
    expect(res.entries.map((e) => e.name)).toEqual(['inner']);
  });

  test('S7 broken link = 400 not_found', () => {
    const root = makeRoot();
    symlinkSync(join(root, 'nowhere'), join(root, 'broken'));
    expectReason(() => listDir(join(root, 'broken')), 400, 'not_found');
  });

  test('S8 symlink cycle (ELOOP) = 400 not_found, does not hang', () => {
    const root = makeRoot();
    symlinkSync(join(root, 'b'), join(root, 'a'));
    symlinkSync(join(root, 'a'), join(root, 'b'));
    expectReason(() => listDir(join(root, 'a')), 400, 'not_found');
  });

  test('S9/S10 mixed entries only list directories: linked directories included, files/link files/broken links invisible', () => {
    const root = makeRoot();
    mkdirSync(join(root, 'plain-dir'));
    writeFileSync(join(root, 'plain-file.txt'), 'x');
    mkdirSync(join(root, 'link-target'));
    symlinkSync(join(root, 'link-target'), join(root, 'dir-link'));
    symlinkSync(join(root, 'plain-file.txt'), join(root, 'file-link'));
    symlinkSync(join(root, 'gone'), join(root, 'broken-link'));
    const res = listDir(root);
    expect(res.entries.map((e) => e.name).sort()).toEqual(['dir-link', 'link-target', 'plain-dir']);
  });

  test('S11 empty directory = entries [] + truncated false', () => {
    const root = makeRoot();
    const empty = join(root, 'empty');
    mkdirSync(empty);
    const res = listDir(empty);
    expect(res.entries).toEqual([]);
    expect(res.truncated).toBe(false);
  });

  test('S12 huge directory = sorted then truncated to FS_LIST_MAX_ENTRIES + truncated true', () => {
    const root = makeRoot();
    const big = join(root, 'big');
    mkdirSync(big);
    const total = FS_LIST_MAX_ENTRIES + 5;
    for (let i = 0; i < total; i += 1) {
      mkdirSync(join(big, `d${String(i).padStart(5, '0')}`));
    }
    const res = listDir(big);
    expect(res.entries).toHaveLength(FS_LIST_MAX_ENTRIES);
    expect(res.truncated).toBe(true);
    expect(res.entries[0]?.name).toBe('d00000');
    expect(res.entries.some((e) => e.name === `d${String(total - 1).padStart(5, '0')}`)).toBe(
      false,
    );
  });

  test('S13/S14 git marks three states and only hints, never filters', () => {
    const root = makeRoot();
    mkdirSync(join(root, 'repo-dir', '.git'), { recursive: true });
    mkdirSync(join(root, 'repo-worktree'));
    writeFileSync(join(root, 'repo-worktree', '.git'), 'gitdir: /somewhere/.git/worktrees/x');
    mkdirSync(join(root, 'no-repo'));
    const res = listDir(root);
    expect(res.entries).toEqual([
      { name: 'no-repo', git: false },
      { name: 'repo-dir', git: true },
      { name: 'repo-worktree', git: true },
    ]);
  });

  test('S15/S16 dotfiles returned in full + space/Chinese/unicode names passed through verbatim', () => {
    const root = makeRoot();
    mkdirSync(join(root, '.config'));
    mkdirSync(join(root, 'my dir'));
    mkdirSync(join(root, '项目'));
    mkdirSync(join(root, 'emoji-🚀'));
    const names = listDir(root).entries.map((e) => e.name);
    expect(names.sort()).toEqual(['.config', 'emoji-🚀', 'my dir', '项目'].sort());
  });

  test('S18/S19 trailing slash and `..` segment normalization', () => {
    const root = makeRoot();
    mkdirSync(join(root, 'sub', 'inner'), { recursive: true });
    const withTrailing = listDir(`${join(root, 'sub')}/`);
    expect(withTrailing.path).toBe(realpathSync(join(root, 'sub')));
    expect(withTrailing.path.endsWith('/')).toBe(false);
    const withDotDot = listDir(join(root, 'sub', 'inner', '..'));
    expect(withDotDot.path).toBe(realpathSync(join(root, 'sub')));
  });

  test('S20 root `/` lists normally, path = /', () => {
    const res = listDir('/');
    expect(res.path).toBe('/');
    expect(Array.isArray(res.entries)).toBe(true);
  });
});

describe('GET /api/fs/list -- route wire surface (R family)', () => {
  const s = bootServer();
  afterAll(() => s.dispose());

  test('R1 200 wire shape {path, entries, truncated} exact', async () => {
    const root = makeRoot();
    mkdirSync(join(root, 'alpha', '.git'), { recursive: true });
    const res = await req(s.app, 'GET', `/api/fs/list?dir=${encodeURIComponent(root)}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['entries', 'path', 'truncated']);
    expect(body.path).toBe(realpathSync(root));
    expect(body.truncated).toBe(false);
    expect(body.entries).toEqual([{ name: 'alpha', git: true }]);
  });

  test('R2 error surface {error, reason} exact (#386)', async () => {
    const res = await req(s.app, 'GET', '/api/fs/list?dir=relative/nope');
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['error', 'reason']);
    expect(body.reason).toBe('not_absolute');
    expect(typeof body.error).toBe('string');
  });

  test('R3 default dir (no param/empty string) = server HOME start', async () => {
    const home = realpathSync(homedir());
    const noParam = await req(s.app, 'GET', '/api/fs/list');
    expect(noParam.status).toBe(200);
    expect(((await noParam.json()) as { path: string }).path).toBe(home);
    const empty = await req(s.app, 'GET', '/api/fs/list?dir=');
    expect(empty.status).toBe(200);
    expect(((await empty.json()) as { path: string }).path).toBe(home);
  });
});
