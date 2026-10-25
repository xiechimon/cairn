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
const BIG_BYTES = 1024 * 1024 + 1;

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

async function setupWorld() {
  const s = bootServer();
  const res = await req(s.app, 'POST', '/api/projects', {
    name: 'diff-full',
    repoKind: 'hosted',
  });
  expect(res.status).toBe(201);
  const { id: projectId } = (await res.json()) as { id: string };
  insertBuild(s, projectId, BUILD_ID, 'todo-full');
  insertBuild(s, projectId, NO_BRANCH_BUILD_ID, 'todo-nobranch');

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
  writeFileSync(join(repoDir, 'plan.md'), CONV_PLAN);
  mkdirSync(join(repoDir, 'src'));
  writeFileSync(join(repoDir, 'src', 'new.ts'), NEW_TS);
  writeFileSync(join(repoDir, 'bin.dat'), BIN_BYTES);
  writeFileSync(join(repoDir, 'big.txt'), Buffer.alloc(BIG_BYTES, 0x61));
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

describe('GET /api/builds/{id}/changes/file (#224 diff full-text read surface)', () => {
  test('text = conv branch history state full text (not main old version); envelope passes the shared schema; nested paths same surface', async () => {
    const { s, bareDir } = await setupWorld();
    try {
      const res = await req(s.app, 'GET', changesFileUrl(BUILD_ID, 'plan.md'));
      expect(res.status).toBe(200);
      const file = diffFileContentSchema.parse(await res.json());
      expect(file.path).toBe('plan.md');
      expect(file.encoding).toBe('utf-8');
      expect(file.content).toBe(CONV_PLAN);
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

  test('binary -> 200 base64 decodes back to the original bytes; over the 1 MiB gate -> 413', async () => {
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

  test('404 surface: unknown build / non-managed project / conv branch not pushed / file missing / directory path', async () => {
    const { s } = await setupWorld();
    try {
      await expectErrorShape(await req(s.app, 'GET', changesFileUrl('nope', 'plan.md')), 404);
      await expectErrorShape(
        await req(s.app, 'GET', changesFileUrl(NO_BRANCH_BUILD_ID, 'plan.md')),
        404,
      );
      await expectErrorShape(await req(s.app, 'GET', changesFileUrl(BUILD_ID, 'ghost.md')), 404);
      await expectErrorShape(await req(s.app, 'GET', changesFileUrl(BUILD_ID, 'src')), 404);
      const plain = await req(s.app, 'POST', '/api/projects', { name: 'plain' });
      const { id: plainId } = (await plain.json()) as { id: string };
      insertBuild(s, plainId, 'build-plain', 'todo-plain');
      await expectErrorShape(await req(s.app, 'GET', changesFileUrl('build-plain', 'x.md')), 404);
    } finally {
      s.dispose();
    }
  });

  test('400 surface: missing path / empty path / `..` segment / absolute path / NUL', async () => {
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
