// #1242 项目身份可变面：五字段 PATCH（name/description/repoKind/githubRepo/
// localPath）+ local→github 形态转换。失败方式先列（本文件即失败场景清单，
// 票面失败方式逐条对应）：
//   R1 PATCH {name} → 200 + 行/record 更新（改名能力，票面问题 3）。
//   R2 name 空串/纯空白 → 400（名字不是可清空字段）。
//   R3 未知字段 → 400（strict schema——票面「未支持字段必须 400 明示」）。
//   R4 五键全缺（空 body）→ 400（#1213 时代的静默早退族就此判死）。
//   D1/D2/D3 description 落值 / null 清空 / 空串清空（空 ≡ null 同口径）。
//   N1 真改名 → 项目各 todo 的 latestBuildId 会话各落一条 system 注记
//      （板面可见：transcript note 行）。
//   N2 同名改名 → 200 但零注记（无语义变更不写历史）。
//   N3 无 build 的 todo 不落注记、不报错（无会话宿主）。
//   K1 local→github 转换（githubRepo 可达 + localPath 缺键）→ 200；localPath
//      保留原值（local 绑定路径转加速位——用户 2026-10-11 定案的形态）；
//      record cloneUrl 切 https 派生；注记落各会话。
//   K2 转换带 localPath 字符串 → validateGithubLocalSlotPath 同闸（相对路径
//      400 + reason not_absolute——票面失败方式 2：两条件闸不可绕）。
//   K3 转换带 localPath:null → 加速位清空。
//   K4 转换缺 githubRepo → 400；K5 githubRepo 形状非法 → 400。
//   K6 转换 githubRepo 不可达（mock 404）→ 400（票面：转换时校验可达）。
//   K6b 可达性探测带 token 时走 Authorization 头（openGithubToken 唯一读出
//      点纪律；无连接 = 匿名梯无 auth 头）。
//   K7 有在飞 build（pending 步）→ 409（票面失败方式 1：cloneUrl 派生切换
//      时机钉死在静止点）。
//   K8 github 项目再转换 → 400（已是目标形态）；github→local 反向 → 400。
//   K9 repoKind:'local' / 'hosted' → 400（转换只支持 local→github）。
//   K10 githubRepo 不带 repoKind → 400（githubRepo 只在转换面写）。
//   K11 hosted 项目转换 → 400；K12 普通项目（repoKind null）转换 → 400。
//   C1 转换后 claim 载荷 repo = {kind:'github', cloneUrl, localPath}——既有
//      builds/conv 步按新形态解析（projectRepoRef 现读行单源）。

import {
  type ClaimedStep,
  claimedStepSchema,
  projectConvertedNote,
  projectRenamedNote,
} from '@pacman/shared';
import { eq, inArray } from 'drizzle-orm';
import type { Hono } from 'hono';
import { afterAll, describe, expect, test } from 'vitest';
import {
  agent as agentTable,
  message as messageTable,
  project as projectTable,
  step as stepTable,
} from '../src/db/schema.js';
import type { FetchLike } from '../src/lib/github.js';
import { upsertGithubConnection } from '../src/services/github-connection.js';
import { bindAllAgents, bootServer, issueApiKey, req } from './helpers.js';

// —— 出站 mock（github-issues.test.ts ghMock 同族：零真实出站）——————————————

interface GhRoute {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}

function ghMock(initial: Record<string, GhRoute>) {
  const routes = new Map<string, GhRoute>(Object.entries(initial));
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const impl: FetchLike = async (input, init) => {
    const url = String(input);
    calls.push({ url, headers: { ...(init?.headers ?? {}) } });
    const route = routes.get(new URL(url).pathname) ?? { status: 404, body: {} };
    const status = route.status ?? 200;
    const headers = route.headers ?? {};
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
      json: async () => route.body,
      text: async () => JSON.stringify(route.body),
    };
  };
  return { impl, calls, set: (path: string, res: GhRoute) => routes.set(path, res) };
}

const REACHABLE: Record<string, GhRoute> = { '/repos/octo/conv': { body: { id: 1 } } };

const s = bootServer({ claimHoldMs: 200, githubFetch: ghMock(REACHABLE).impl });
afterAll(() => s.dispose());

interface ProjectReply {
  id?: string;
  name?: string;
  description?: string | null;
  repoKind?: string;
  githubRepo?: string;
  localPath?: string | null;
  cloneUrl?: string;
  error?: string;
  reason?: string;
}

async function patchProject(
  app: Hono,
  id: string,
  body: unknown,
): Promise<{ status: number; body: ProjectReply }> {
  const res = await req(app, 'PATCH', `/api/projects/${id}`, body);
  return { status: res.status, body: (await res.json()) as ProjectReply };
}

/** 直插 local 形态行（创建闸要求真 git 仓；PATCH/转换面只关心行形态分叉，
 * P3 同律）。返回 id。 */
function insertLocalProject(id: string, localPath: string | null): void {
  s.db
    .insert(projectTable)
    .values({
      id,
      name: `local-${id}`,
      teamId: s.team.id,
      repoKind: 'local',
      repoName: null,
      githubRepo: null,
      localPath,
      description: null,
    })
    .run();
}

/** 普通项目（无 repo 形态）直插。 */
function insertPlainProject(id: string): void {
  s.db
    .insert(projectTable)
    .values({
      id,
      name: `plain-${id}`,
      teamId: s.team.id,
      repoKind: null,
      repoName: null,
      githubRepo: null,
      localPath: null,
      description: null,
    })
    .run();
}

function projectRow(id: string) {
  return s.db.select().from(projectTable).where(eq(projectTable.id, id)).get();
}

function noteRowsFor(conversationIds: string[]) {
  if (conversationIds.length === 0) return [];
  return s.db
    .select()
    .from(messageTable)
    .where(inArray(messageTable.conversationId, conversationIds))
    .all()
    .filter((r) => r.role === 'system');
}

describe('PATCH /api/projects/{id}——name/description 写面（#1242）', () => {
  test('R1 改名 → 200 + 行/record 更新', async () => {
    const id = 'proj-ident-r1';
    insertPlainProject(id);
    const r = await patchProject(s.app, id, { name: '新名字' });
    expect(r.status).toBe(200);
    expect(r.body.name).toBe('新名字');
    expect(projectRow(id)?.name).toBe('新名字');
  });

  test('R2 name 空串/纯空白 → 400', async () => {
    const id = 'proj-ident-r2';
    insertPlainProject(id);
    for (const name of ['', '   ']) {
      const r = await patchProject(s.app, id, { name });
      expect(r.status).toBe(400);
      expect(String(r.body.error)).toContain('name');
    }
    expect(projectRow(id)?.name).toBe(`plain-${id}`);
  });

  test('R3 未知字段 → 400（strict：未支持字段明示拒绝）', async () => {
    const id = 'proj-ident-r3';
    insertPlainProject(id);
    const r = await patchProject(s.app, id, { repoName: 'x', name: 'ok' });
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toContain('repoName');
  });

  test('R4 五键全缺（空 body）→ 400（静默 no-op 族判死）', async () => {
    const id = 'proj-ident-r4';
    insertPlainProject(id);
    const r = await patchProject(s.app, id, {});
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toContain('body');
  });

  test('D1/D2/D3 description 落值、null 清空、空串清空（空 ≡ null）', async () => {
    const id = 'proj-ident-d1';
    insertPlainProject(id);
    const r1 = await patchProject(s.app, id, { description: '一条描述' });
    expect(r1.status).toBe(200);
    expect(r1.body.description).toBe('一条描述');
    const r2 = await patchProject(s.app, id, { description: null });
    expect(r2.status).toBe(200);
    expect(r2.body.description).toBeUndefined();
    expect(projectRow(id)?.description).toBeNull();
    const r3 = await patchProject(s.app, id, { description: '  ' });
    expect(r3.status).toBe(200);
    expect(projectRow(id)?.description).toBeNull();
  });

  test('D4 name + description + localPath 一次多字段 → 各自落位（github 项目）', async () => {
    const res = await req(s.app, 'POST', '/api/projects', {
      name: 'ident-multi',
      kind: 'github',
      githubRepo: 'octo/multi',
    });
    const id = String(((await res.json()) as ProjectReply).id);
    const r = await patchProject(s.app, id, {
      name: '改名带描述',
      description: 'desc',
      localPath: '/Users/who/code/multi',
    });
    expect(r.status).toBe(200);
    expect(r.body.name).toBe('改名带描述');
    expect(r.body.description).toBe('desc');
    expect(r.body.localPath).toBe('/Users/who/code/multi');
  });
});

// —— 注记面（板面可见 = 项目 todos 的 latestBuildId 会话 system 行）———————

/** 建 todo + 起 build（assignment 单 agent）→ 返回 {todoId, buildId}。 */
async function createTodoWithBuild(
  projectId: string,
  title: string,
): Promise<{ todoId: string; buildId: string }> {
  const agentId = 'agent-ident-1';
  s.db
    .insert(agentTable)
    .values({ id: agentId, teamId: s.team.id, displayName: 'ident-builder', modelId: 'm' })
    .onConflictDoNothing()
    .run();
  const todoRes = await req(s.app, 'POST', `/api/projects/${projectId}/todos`, {
    title,
    spec: 'spec',
  });
  const todoId = String(((await todoRes.json()) as { id: string }).id);
  const buildRes = await req(s.app, 'POST', `/api/projects/${projectId}/builds`, {
    todoIds: [todoId],
    assignment: { plan: { agentId }, build: { agentId } },
    withPlan: false,
  });
  expect(buildRes.status).toBe(201);
  const buildId = (((await buildRes.json()) as { builds: { id: string }[] }).builds ?? [])[0]?.id;
  if (buildId === undefined) throw new Error('build not created');
  return { todoId, buildId };
}

describe('PATCH /api/projects/{id}——系统注记面（#1242）', () => {
  test('N1 真改名 → 项目 todos 各会话落一条 system 注记（文本单源）', async () => {
    const id = 'proj-ident-n1';
    insertPlainProject(id);
    const t1 = await createTodoWithBuild(id, '注记探针一');
    const t2 = await createTodoWithBuild(id, '注记探针二');
    const r = await patchProject(s.app, id, { name: '改后名' });
    expect(r.status).toBe(200);
    const notes = noteRowsFor([t1.buildId, t2.buildId]);
    expect(notes).toHaveLength(2);
    for (const n of notes) {
      expect(n.role).toBe('system');
      expect(n.content).toBe(projectRenamedNote({ from: `plain-${id}`, to: '改后名' }));
    }
  });

  test('N2 同名改名 → 200 零注记', async () => {
    const id = 'proj-ident-n2';
    insertPlainProject(id);
    const t = await createTodoWithBuild(id, '同名探针');
    const r = await patchProject(s.app, id, { name: `plain-${id}` });
    expect(r.status).toBe(200);
    expect(noteRowsFor([t.buildId])).toHaveLength(0);
  });

  test('N3 无 build 的 todo 不落注记、不报错', async () => {
    const id = 'proj-ident-n3';
    insertPlainProject(id);
    await req(s.app, 'POST', `/api/projects/${id}/todos`, { title: '空卡', spec: '' });
    const r = await patchProject(s.app, id, { name: '还是改名' });
    expect(r.status).toBe(200);
    // 注记判据 = 改名文本不落任何会话（N1 已写别的注记，全局计数非零——
    // 按 content 锁本事件的可见性）。
    const leaked = s.db
      .select()
      .from(messageTable)
      .all()
      .filter((m) => typeof m.content === 'string' && m.content.includes('还是改名'));
    expect(leaked).toHaveLength(0);
  });
});

// —— local→github 转换面（票面改法 2 + 失败方式 1/2）———————————————

describe('PATCH /api/projects/{id}——local→github 转换（#1242）', () => {
  test('K1 缺键 localPath → 保留原值（local 绑定转加速位）+ cloneUrl 切换 + 注记', async () => {
    const id = 'proj-ident-k1';
    insertLocalProject(id, '/Users/who/code/pacman');
    const t = await createTodoWithBuild(id, '转换探针');
    // 无在飞步的静止点：步收尾走机器协议不在本测范围，直接置终态
    // （409 闸单独测步状态词表，此处只关心转换本体）。
    s.db.update(stepTable).set({ status: 'done' }).where(eq(stepTable.buildId, t.buildId)).run();
    const r = await patchProject(s.app, id, { repoKind: 'github', githubRepo: 'octo/conv' });
    expect(r.status).toBe(200);
    expect(r.body.repoKind).toBe('github');
    expect(r.body.githubRepo).toBe('octo/conv');
    expect(r.body.localPath).toBe('/Users/who/code/pacman');
    expect(r.body.cloneUrl).toBe('https://github.com/octo/conv.git');
    const row = projectRow(id);
    expect(row?.repoKind).toBe('github');
    expect(row?.localPath).toBe('/Users/who/code/pacman');
    const notes = noteRowsFor([t.buildId]);
    expect(notes).toHaveLength(1);
    expect(notes[0]?.content).toBe(
      projectConvertedNote({ githubRepo: 'octo/conv', localPath: '/Users/who/code/pacman' }),
    );
  });

  test('K2 转换带 localPath 字符串：绝对路径落值；相对路径 400 + not_absolute（两条件闸同函数）', async () => {
    const id = 'proj-ident-k2';
    insertLocalProject(id, '/Users/who/code/pacman');
    const ok = await patchProject(s.app, id, {
      repoKind: 'github',
      githubRepo: 'octo/conv',
      localPath: '/data/mea/pacman',
    });
    expect(ok.status).toBe(200);
    expect(projectRow(id)?.localPath).toBe('/data/mea/pacman');
  });

  test('K2b 相对路径 → 400 + reason not_absolute', async () => {
    const id = 'proj-ident-k2b';
    insertLocalProject(id, '/Users/who/code/pacman');
    const r = await patchProject(s.app, id, {
      repoKind: 'github',
      githubRepo: 'octo/conv',
      localPath: 'relative/x',
    });
    expect(r.status).toBe(400);
    expect(r.body.reason).toBe('not_absolute');
    expect(projectRow(id)?.repoKind).toBe('local');
  });

  test('K3 转换带 localPath:null → 加速位清空', async () => {
    const id = 'proj-ident-k3';
    insertLocalProject(id, '/Users/who/code/pacman');
    const r = await patchProject(s.app, id, {
      repoKind: 'github',
      githubRepo: 'octo/conv',
      localPath: null,
    });
    expect(r.status).toBe(200);
    expect(projectRow(id)?.localPath).toBeNull();
  });

  test('K4 缺 githubRepo → 400；K5 形状非法 → 400', async () => {
    const id = 'proj-ident-k4';
    insertLocalProject(id, '/Users/who/code/pacman');
    const r4 = await patchProject(s.app, id, { repoKind: 'github' });
    expect(r4.status).toBe(400);
    expect(String(r4.body.error)).toContain('githubRepo');
    const r5 = await patchProject(s.app, id, { repoKind: 'github', githubRepo: 'no-slash' });
    expect(r5.status).toBe(400);
    expect(String(r5.body.error)).toContain('githubRepo');
    expect(projectRow(id)?.repoKind).toBe('local');
  });

  test('K6 githubRepo 不可达（mock 404）→ 400；无 token 连接 = 匿名梯（无 auth 头）', async () => {
    const mock = ghMock({});
    const s404 = bootServer({ githubFetch: mock.impl });
    try {
      const id = 'proj-ident-k6';
      s404.db
        .insert(projectTable)
        .values({
          id,
          name: 'local-k6',
          teamId: s404.team.id,
          repoKind: 'local',
          repoName: null,
          githubRepo: null,
          localPath: '/Users/who/code/pacman',
          description: null,
        })
        .run();
      const r = await patchProject(s404.app, id, { repoKind: 'github', githubRepo: 'octo/conv' });
      expect(r.status).toBe(400);
      expect(String(r.body.error)).toContain('octo/conv');
      expect(mock.calls).toHaveLength(1);
      expect(mock.calls[0]?.headers.authorization).toBeUndefined();
      expect(
        s404.db.select().from(projectTable).where(eq(projectTable.id, id)).get()?.repoKind,
      ).toBe('local');
    } finally {
      s404.dispose();
    }
  });

  test('K6b 已连接 GitHub → 探测带 Authorization 头（openGithubToken 唯一读出点）', async () => {
    const mock = ghMock(REACHABLE);
    const sAuth = bootServer({ githubFetch: mock.impl });
    try {
      upsertGithubConnection(
        { db: sAuth.db, box: sAuth.secretBox },
        { teamId: sAuth.team.id, login: 'octo', accessToken: 'ghp_ident_probe', scope: 'repo' },
      );
      const id = 'proj-ident-k6b';
      sAuth.db
        .insert(projectTable)
        .values({
          id,
          name: 'local-k6b',
          teamId: sAuth.team.id,
          repoKind: 'local',
          repoName: null,
          githubRepo: null,
          localPath: '/Users/who/code/pacman',
          description: null,
        })
        .run();
      const r = await patchProject(sAuth.app, id, { repoKind: 'github', githubRepo: 'octo/conv' });
      expect(r.status).toBe(200);
      expect(mock.calls[0]?.headers.authorization).toBe('Bearer ghp_ident_probe');
      expect(mock.calls[0]?.url).toBe('https://api.github.com/repos/octo/conv');
    } finally {
      sAuth.dispose();
    }
  });

  test('K7 有在飞 build（pending 步）→ 409；步终态后 → 200', async () => {
    const id = 'proj-ident-k7';
    insertLocalProject(id, '/Users/who/code/pacman');
    const t = await createTodoWithBuild(id, '在飞闸探针');
    const blocked = await patchProject(s.app, id, { repoKind: 'github', githubRepo: 'octo/conv' });
    expect(blocked.status).toBe(409);
    expect(String(blocked.body.error)).toContain('in-flight');
    expect(projectRow(id)?.repoKind).toBe('local');
    s.db.update(stepTable).set({ status: 'done' }).where(eq(stepTable.buildId, t.buildId)).run();
    const ok = await patchProject(s.app, id, { repoKind: 'github', githubRepo: 'octo/conv' });
    expect(ok.status).toBe(200);
  });

  test('K8 github 项目再转换 → 400（已是目标形态）；github→local 反向 → 400', async () => {
    const id = 'proj-ident-k8';
    insertLocalProject(id, '/Users/who/code/pacman');
    const conv = await patchProject(s.app, id, { repoKind: 'github', githubRepo: 'octo/conv' });
    expect(conv.status).toBe(200);
    const again = await patchProject(s.app, id, { repoKind: 'github', githubRepo: 'octo/other' });
    expect(again.status).toBe(400);
    const back = await patchProject(s.app, id, { repoKind: 'local' });
    expect(back.status).toBe(400);
    expect(projectRow(id)?.githubRepo).toBe('octo/conv');
  });

  test('K9 repoKind local/hosted（非 github 目标）→ 400', async () => {
    const id = 'proj-ident-k9';
    insertLocalProject(id, '/Users/who/code/pacman');
    for (const repoKind of ['local', 'hosted'] as const) {
      const r = await patchProject(s.app, id, { repoKind });
      expect(r.status).toBe(400);
      expect(String(r.body.error)).toContain('local→github');
    }
  });

  test('K10 githubRepo 不带 repoKind → 400（githubRepo 只在转换面写）', async () => {
    const res = await req(s.app, 'POST', '/api/projects', {
      name: 'ident-k10',
      kind: 'github',
      githubRepo: 'octo/keep',
    });
    const id = String(((await res.json()) as ProjectReply).id);
    const r = await patchProject(s.app, id, { githubRepo: 'octo/other' });
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toContain('githubRepo');
    expect(projectRow(id)?.githubRepo).toBe('octo/keep');
  });

  test('K11 hosted 项目转换 → 400；K12 普通项目（repoKind null）转换 → 400', async () => {
    const hostedRes = await req(s.app, 'POST', '/api/projects', {
      name: 'ident-hosted',
      kind: 'hosted',
    });
    expect(hostedRes.status).toBe(201);
    const hostedId = String(((await hostedRes.json()) as ProjectReply).id);
    const rh = await patchProject(s.app, hostedId, { repoKind: 'github', githubRepo: 'octo/conv' });
    expect(rh.status).toBe(400);

    const plainId = 'proj-ident-k12';
    insertPlainProject(plainId);
    const rp = await patchProject(s.app, plainId, { repoKind: 'github', githubRepo: 'octo/conv' });
    expect(rp.status).toBe(400);
    expect(projectRow(plainId)?.repoKind).toBeNull();
  });
});

// —— claim 载荷半（转换后新步按新形态解析——票面改法「既有 builds/conv 分支
// 按新形态解析」的派生单源钉死）———————————————————————————————————————————

const claimDisposables: (() => void)[] = [];
afterAll(() => {
  for (const d of claimDisposables) d();
});

async function call(
  app: Hono,
  method: string,
  path: string,
  opts: { cred?: string; body?: unknown } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.cred) headers.authorization = `Bearer ${opts.cred}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  return Promise.resolve(
    app.request(path, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    }),
  );
}

describe('转换后 claim 载荷 repo 形态（#1242）', () => {
  test('C1 local 转换后新步 claim → repo {kind:github, cloneUrl, localPath}', async () => {
    const mock = ghMock(REACHABLE);
    const s2 = bootServer({ claimHoldMs: 200, githubFetch: mock.impl });
    claimDisposables.push(() => s2.dispose());
    const key = await issueApiKey(s2);
    const enrollRes = await call(s2.app, 'POST', '/api/machine/enroll', {
      cred: key,
      body: { teamId: s2.team.id, name: 'ident-mea', cliVersion: '0.1.0' },
    });
    const machineToken = ((await enrollRes.json()) as { token: string }).token;
    const agentId = 'agent-ident-claim';
    s2.db
      .insert(agentTable)
      .values({ id: agentId, teamId: s2.team.id, displayName: 'ident-claimer', modelId: 'm' })
      .run();
    bindAllAgents(s2);
    const projectId = 'proj-ident-c1';
    s2.db
      .insert(projectTable)
      .values({
        id: projectId,
        name: 'pacman',
        teamId: s2.team.id,
        repoKind: 'local',
        repoName: null,
        githubRepo: null,
        localPath: '/Users/who/code/pacman',
        description: null,
      })
      .run();
    const conv = await patchProject(s2.app, projectId, {
      repoKind: 'github',
      githubRepo: 'octo/conv',
    });
    expect(conv.status).toBe(200);
    const todoRes = await call(s2.app, 'POST', `/api/projects/${projectId}/todos`, {
      body: { title: '转换后施工', spec: '改一行' },
    });
    const todoId = ((await todoRes.json()) as { id: string }).id;
    const buildRes = await call(s2.app, 'POST', `/api/projects/${projectId}/builds`, {
      body: {
        todoIds: [todoId],
        assignment: { plan: { agentId }, build: { agentId } },
        withPlan: false,
      },
    });
    expect(buildRes.status).toBe(201);
    const claimRes = await call(s2.app, 'POST', '/api/machine/tasks/claim', {
      cred: machineToken,
      body: {},
    });
    const body = (await claimRes.json()) as { step: ClaimedStep | null };
    if (!body.step) throw new Error('claim returned no step');
    const claimed = claimedStepSchema.parse(body.step);
    expect(claimed.project?.repo).toEqual({
      kind: 'github',
      cloneUrl: 'https://github.com/octo/conv.git',
      localPath: '/Users/who/code/pacman',
    });
  });
});
