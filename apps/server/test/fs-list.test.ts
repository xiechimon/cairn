// #441（ADR 0003 D5/D6）GET /api/fs/list：应用内目录浏览数据源——server
// readdir 只读投影，remote/headless 形态下原生对话框 422 unavailable 的兜底。
// 失败方式先行枚举（仓规：先列失败方式再写实现；S 族 = services/fs-list.ts
// 现扫面，R 族 = 路由 wire 面）——
// S1 dir 缺省/空串 = server $HOME 起点（web 无从知道 server HOME）/
// S2 相对路径 = 400 not_absolute / S3 不存在 = 400 not_found /
// S4 普通文件 = 400 not_dir / S5 EACCES = 400 not_readable（root 下 skip）/
// S6 符号链接目录 = realpath 正规化后列出，path 回 canonical 真身 /
// S7 断链 = 400 not_found / S8 符号链接环 ELOOP = 400 not_found 不挂死 /
// S9 混合条目只列目录（statSync 跟随符号链接，skills.ts 同款）/
// S10 条目断链 = 跳过不炸（容错律）/ S11 空目录 = [] + truncated false /
// S12 超大目录 = 排序后截 FS_LIST_MAX_ENTRIES 条 + truncated true /
// S13 git 标记三态（.git 目录 / .git 文件 worktree 形 / 无）/
// S14 git 标记只提示不过滤 / S15 dotfiles 全量返回（隐藏是 web 显示层语义）/
// S16 名字含空格/中文/unicode 原样透传 / S17 `~` 前缀不展开 = not_absolute /
// S18 尾斜杠正规化 / S19 `..` 段正规化（浏览无白名单，D5——穿越只是正规化
//   问题不是安全面）/ S20 根目录 `/` 正常列出 / S21 path = realpath 真值
//   （macOS /var → /private/var 族，面包屑/lastDir 同源无别名漂移）。
// R1 200 wire 形状 {path, entries, truncated} 恰等 / R2 错误面 {error,
//   reason} 恰等（#386）/ R3 缺省 dir = HOME。
// web 契约面 = apps/web/e2e/project-new-dir-browser.spec.ts。

import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { FS_LIST_MAX_ENTRIES } from '@cairn/shared';
import { afterAll, describe, expect, test } from 'vitest';
import { HttpError } from '../src/lib/errors.js';
import { listDir } from '../src/services/fs-list.js';
import { bootServer, req } from './helpers.js';

// —— 隔离脚手架（skills-local.test.ts 同款：自建自清）————————————————————

const roots: string[] = [];
function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'cairn-fs-list-'));
  roots.push(root);
  return root;
}
afterAll(() => {
  for (const root of roots) {
    chmodSync(root, 0o755); // S5 面 chmod 000 的根要先恢复权限才能 rm
    rmSync(root, { recursive: true, force: true });
  }
});

const isRoot = process.getuid?.() === 0;

/** listDir 的 HttpError reason 断言辅助。 */
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

describe('services/fs-list listDir——现扫面（S 族）', () => {
  test('S1 dir 缺省/空串 = server $HOME 起点', () => {
    const home = realpathSync(homedir());
    expect(listDir(undefined).path).toBe(home);
    expect(listDir('').path).toBe(home);
  });

  test('S2/S17 相对路径与 `~` 前缀 = 400 not_absolute（~ 不展开）', () => {
    expectReason(() => listDir('rel/ative'), 400, 'not_absolute');
    expectReason(() => listDir('~/Code'), 400, 'not_absolute');
  });

  test('S3 不存在 = 400 not_found', () => {
    expectReason(() => listDir(join(makeRoot(), 'gone')), 400, 'not_found');
  });

  test('S4 普通文件 = 400 not_dir', () => {
    const root = makeRoot();
    writeFileSync(join(root, 'file.txt'), 'x');
    expectReason(() => listDir(join(root, 'file.txt')), 400, 'not_dir');
  });

  test.skipIf(isRoot)('S5 readdir 被拒（chmod 000）= 400 not_readable', () => {
    const root = makeRoot();
    const locked = join(root, 'locked');
    mkdirSync(locked);
    chmodSync(locked, 0o000);
    try {
      expectReason(() => listDir(locked), 400, 'not_readable');
    } finally {
      chmodSync(locked, 0o755); // 恢复权限，否则 afterAll rmSync 递归被拒
    }
  });

  test('S6/S21 符号链接目录 = realpath 正规化，path 回 canonical 真身', () => {
    const root = makeRoot();
    const real = join(root, 'real');
    mkdirSync(join(real, 'inner'), { recursive: true });
    const link = join(root, 'link');
    symlinkSync(real, link);
    const res = listDir(link);
    // macOS tmpdir /var → /private/var 族：path 恒为 realpath 真值。
    expect(res.path).toBe(realpathSync(real));
    expect(res.entries.map((e) => e.name)).toEqual(['inner']);
  });

  test('S7 断链 = 400 not_found', () => {
    const root = makeRoot();
    symlinkSync(join(root, 'nowhere'), join(root, 'broken'));
    expectReason(() => listDir(join(root, 'broken')), 400, 'not_found');
  });

  test('S8 符号链接环（ELOOP）= 400 not_found，不挂死', () => {
    const root = makeRoot();
    symlinkSync(join(root, 'b'), join(root, 'a'));
    symlinkSync(join(root, 'a'), join(root, 'b'));
    expectReason(() => listDir(join(root, 'a')), 400, 'not_found');
  });

  test('S9/S10 混合条目只列目录：链接目录收录，文件/链接文件/断链不可见', () => {
    const root = makeRoot();
    mkdirSync(join(root, 'plain-dir'));
    writeFileSync(join(root, 'plain-file.txt'), 'x');
    mkdirSync(join(root, 'link-target'));
    symlinkSync(join(root, 'link-target'), join(root, 'dir-link'));
    symlinkSync(join(root, 'plain-file.txt'), join(root, 'file-link'));
    symlinkSync(join(root, 'gone'), join(root, 'broken-link'));
    const res = listDir(root);
    // link-target 是真目录、dir-link 是链接目录——同律收录（skills.ts S11）；
    // 文件/链接文件/断链不可见。
    expect(res.entries.map((e) => e.name).sort()).toEqual(['dir-link', 'link-target', 'plain-dir']);
  });

  test('S11 空目录 = entries [] + truncated false', () => {
    const root = makeRoot();
    const empty = join(root, 'empty');
    mkdirSync(empty);
    const res = listDir(empty);
    expect(res.entries).toEqual([]);
    expect(res.truncated).toBe(false);
  });

  test('S12 超大目录 = 排序后截 FS_LIST_MAX_ENTRIES 条 + truncated true', () => {
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
    // 排序后截断：字典序头部在场、尾部出闸。
    expect(res.entries[0]?.name).toBe('d00000');
    expect(res.entries.some((e) => e.name === `d${String(total - 1).padStart(5, '0')}`)).toBe(
      false,
    );
  });

  test('S13/S14 git 标记三态且只提示不过滤', () => {
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

  test('S15/S16 dotfiles 全量返回 + 空格/中文/unicode 名字原样透传', () => {
    const root = makeRoot();
    mkdirSync(join(root, '.config'));
    mkdirSync(join(root, 'my dir'));
    mkdirSync(join(root, '项目'));
    mkdirSync(join(root, 'emoji-🚀'));
    const names = listDir(root).entries.map((e) => e.name);
    expect(names.sort()).toEqual(['.config', 'emoji-🚀', 'my dir', '项目'].sort());
  });

  test('S18/S19 尾斜杠与 `..` 段正规化', () => {
    const root = makeRoot();
    mkdirSync(join(root, 'sub', 'inner'), { recursive: true });
    const withTrailing = listDir(`${join(root, 'sub')}/`);
    expect(withTrailing.path).toBe(realpathSync(join(root, 'sub')));
    expect(withTrailing.path.endsWith('/')).toBe(false);
    const withDotDot = listDir(join(root, 'sub', 'inner', '..'));
    expect(withDotDot.path).toBe(realpathSync(join(root, 'sub')));
  });

  test('S20 根目录 `/` 正常列出，path = /', () => {
    const res = listDir('/');
    expect(res.path).toBe('/');
    expect(Array.isArray(res.entries)).toBe(true);
  });
});

describe('GET /api/fs/list——路由 wire 面（R 族）', () => {
  const s = bootServer();
  afterAll(() => s.dispose());

  test('R1 200 wire 形状 {path, entries, truncated} 恰等', async () => {
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

  test('R2 错误面 {error, reason} 恰等（#386）', async () => {
    const res = await req(s.app, 'GET', '/api/fs/list?dir=relative/nope');
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['error', 'reason']);
    expect(body.reason).toBe('not_absolute');
    expect(typeof body.error).toBe('string');
  });

  test('R3 缺省 dir（无参数/空串）= server HOME 起点', async () => {
    const home = realpathSync(homedir());
    const noParam = await req(s.app, 'GET', '/api/fs/list');
    expect(noParam.status).toBe(200);
    expect(((await noParam.json()) as { path: string }).path).toBe(home);
    const empty = await req(s.app, 'GET', '/api/fs/list?dir=');
    expect(empty.status).toBe(200);
    expect(((await empty.json()) as { path: string }).path).toBe(home);
  });
});
