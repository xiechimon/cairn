// #224 diff 全文读面：GET /api/builds/{id}/changes/file?path= —— conv 分支
// 历史态单文件全文按需取（#219 裁决 A：独立于 changes 列表，列表面不被全文
// 撑爆；docpane「显示完整文件」数据源，web 接线归 #225）。
// 失败方式清单（先固化，代码是让场景通过的手段）：
// ① build 不存在 → 404；项目非托管（无本地 bare 读面）→ 404；conv 分支
//    未推 → 404。
// ② query 缺 path / 空 path → 400；路径穿越（`..` 段 / 绝对路径 / NUL）→ 400。
// ③ path 在 conv ref 不存在 → 404；path 命中目录（非 blob）→ 404。
// ④ 文本 → 200 utf-8 全文 = conv 分支历史态（≠ main 旧版）；ref/commit/
//    path/size 回显，封套过 shared diffFileContentSchema。
// ⑤ 二进制（首 8KB 含 NUL）→ 200 encoding:base64，可解码回原字节。
// ⑥ 超 1 MiB 闸门 → 413（闸门前置 `cat-file -s`，超限 blob 不载内存）。

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { conversationBranch, diffFileContentSchema } from '@cairn/shared';
import { afterAll, describe, expect, test } from 'vitest';
import { build as buildTable, todo as todoTable } from '../src/db/schema.js';
import { runGit } from '../src/lib/git.js';
import { bootServer, req } from './helpers.js';

const GIT_ENV = {
  GIT_AUTHOR_NAME: 'diff-probe',
  GIT_AUTHOR_EMAIL: 'probe@localhost',
  GIT_COMMITTER_NAME: 'diff-probe',
  GIT_COMMITTER_EMAIL: 'probe@localhost',
};

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const BUILD_ID = '01a0b85b-0000-7000-8000-000000000224';
const NO_BRANCH_BUILD_ID = '01a0b85b-0000-7000-8000-000000000225';
const CONV_BRANCH = conversationBranch(BUILD_ID);
const MAIN_PLAN = '# plan\n\nbase 版（main）。\n';
const CONV_PLAN = '# plan\n\nconv 分支历史态全文。\n';
const NEW_TS = 'export const x = 1;\n';
const BIN_BYTES = Buffer.from([0x00, 0x01, 0x02, 0xff, 0x00, 0xfe]);
const BIG_BYTES = 1024 * 1024 + 1; // 闸门 = 1 MiB（实现侧 DIFF_FILE_MAX_BYTES）；+1 越界

async function git(args: string[], cwd: string) {
  const r = await runGit(args, { cwd, env: GIT_ENV, timeoutMs: 60_000 });
  expect(r.code, r.stderr).toBe(0);
}

type Server = ReturnType<typeof bootServer>;

function insertBuild(s: Server, projectId: string, buildId: string, todoId: string) {
  const now = Date.now();
  s.db
    .insert(todoTable)
    .values({ id: todoId, teamId: s.team.id, projectId, title: 't', phaseAt: now, seqNum: 1 })
    .run();
  s.db
    .insert(buildTable)
    .values({ id: buildId, todoId, withPlan: false, triggerSource: 'user', createdAt: now })
    .run();
}

/** 托管项目 + build 行 + conv 分支文件史（main 基线 → conv 改动 → file 传输 push）。 */
async function setupWorld() {
  const s = bootServer();
  const res = await req(s.app, 'POST', '/api/projects', {
    name: 'diff-full',
    repoKind: 'hosted',
  });
  expect(res.status).toBe(201);
  const { id: projectId } = (await res.json()) as { id: string };
  insertBuild(s, projectId, BUILD_ID, 'todo-full');
  insertBuild(s, projectId, NO_BRANCH_BUILD_ID, 'todo-nobranch'); // conv 分支永不推

  const dir = mkdtempSync(join(tmpdir(), 'cairn-diff-full-'));
  dirs.push(dir);
  const bareDir = join(s.reposDir, s.team.id, 'diff-full.git');
  const repoDir = join(dir, 'repo');
  await git(['clone', bareDir, repoDir], dir);
  writeFileSync(join(repoDir, 'plan.md'), MAIN_PLAN);
  await git(['add', '-A'], repoDir);
  await git(['commit', '-m', 'base'], repoDir);
  await git(['push', 'origin', 'main'], repoDir);
  await git(['checkout', '-B', CONV_BRANCH], repoDir);
  writeFileSync(join(repoDir, 'plan.md'), CONV_PLAN); // 改
  mkdirSync(join(repoDir, 'src'));
  writeFileSync(join(repoDir, 'src', 'new.ts'), NEW_TS); // 增（嵌套路径）
  writeFileSync(join(repoDir, 'bin.dat'), BIN_BYTES); // 二进制
  writeFileSync(join(repoDir, 'big.txt'), Buffer.alloc(BIG_BYTES, 0x61)); // 超闸门
  await git(['add', '-A'], repoDir);
  await git(['commit', '-m', 'conv round'], repoDir);
  await git(['push', 'origin', CONV_BRANCH], repoDir);
  return { s, projectId, bareDir };
}

function changesFileUrl(buildId: string, path?: string): string {
  return path === undefined
    ? `/api/builds/${buildId}/changes/file`
    : `/api/builds/${buildId}/changes/file?path=${path}`;
}

async function expectErrorShape(res: Response, status: number) {
  expect(res.status).toBe(status);
  const body = (await res.json()) as Record<string, unknown>;
  expect(Object.keys(body)).toEqual(['error']);
  expect(typeof body.error).toBe('string');
}

describe('GET /api/builds/{id}/changes/file（#224 diff 全文读面）', () => {
  test('文本 = conv 分支历史态全文（≠ main 旧版）；封套过 shared schema；嵌套路径同面', async () => {
    const { s, bareDir } = await setupWorld();
    try {
      const res = await req(s.app, 'GET', changesFileUrl(BUILD_ID, 'plan.md'));
      expect(res.status).toBe(200);
      const file = diffFileContentSchema.parse(await res.json());
      expect(file.path).toBe('plan.md');
      expect(file.encoding).toBe('utf-8');
      expect(file.content).toBe(CONV_PLAN); // 历史态语义核心：非 MAIN_PLAN
      expect(file.size).toBe(Buffer.byteLength(CONV_PLAN));
      expect(file.ref).toBe(CONV_BRANCH);
      const head = await runGit(['rev-parse', CONV_BRANCH], { cwd: bareDir });
      expect(file.commit).toBe(head.stdout.toString('utf8').trim());

      const nested = await req(s.app, 'GET', changesFileUrl(BUILD_ID, 'src/new.ts'));
      expect(nested.status).toBe(200);
      expect(diffFileContentSchema.parse(await nested.json()).content).toBe(NEW_TS);
    } finally {
      s.dispose();
    }
  });

  test('二进制 → 200 base64 可解码回原字节；超 1 MiB 闸门 → 413', async () => {
    const { s } = await setupWorld();
    try {
      const bin = diffFileContentSchema.parse(
        await (await req(s.app, 'GET', changesFileUrl(BUILD_ID, 'bin.dat'))).json(),
      );
      expect(bin.encoding).toBe('base64');
      expect(Buffer.from(bin.content, 'base64').equals(BIN_BYTES)).toBe(true);
      expect(bin.size).toBe(BIN_BYTES.byteLength);

      await expectErrorShape(await req(s.app, 'GET', changesFileUrl(BUILD_ID, 'big.txt')), 413);
    } finally {
      s.dispose();
    }
  });

  test('404 面：未知 build / 非托管项目 / conv 分支未推 / 文件不存在 / 目录路径', async () => {
    const { s } = await setupWorld();
    try {
      await expectErrorShape(await req(s.app, 'GET', changesFileUrl('nope', 'plan.md')), 404);
      await expectErrorShape(
        await req(s.app, 'GET', changesFileUrl(NO_BRANCH_BUILD_ID, 'plan.md')),
        404,
      );
      await expectErrorShape(await req(s.app, 'GET', changesFileUrl(BUILD_ID, 'ghost.md')), 404);
      await expectErrorShape(await req(s.app, 'GET', changesFileUrl(BUILD_ID, 'src')), 404);
      // 非托管项目（无 repoKind → 无本地 bare 读面）。
      const plain = await req(s.app, 'POST', '/api/projects', { name: 'plain' });
      const { id: plainId } = (await plain.json()) as { id: string };
      insertBuild(s, plainId, 'build-plain', 'todo-plain');
      await expectErrorShape(await req(s.app, 'GET', changesFileUrl('build-plain', 'x.md')), 404);
    } finally {
      s.dispose();
    }
  });

  test('400 面：缺 path / 空 path / `..` 段 / 绝对路径 / NUL', async () => {
    const { s } = await setupWorld();
    try {
      await expectErrorShape(await req(s.app, 'GET', changesFileUrl(BUILD_ID)), 400);
      await expectErrorShape(await req(s.app, 'GET', changesFileUrl(BUILD_ID, '')), 400);
      await expectErrorShape(await req(s.app, 'GET', changesFileUrl(BUILD_ID, '../secret')), 400);
      await expectErrorShape(await req(s.app, 'GET', changesFileUrl(BUILD_ID, '/etc/passwd')), 400);
      await expectErrorShape(await req(s.app, 'GET', changesFileUrl(BUILD_ID, 'a%00b')), 400);
    } finally {
      s.dispose();
    }
  });
});
