// #1259 agent 归属机闭环：agent.machineId 单源——步只投归属机（worker 闸 +
// chief 主力机投递）；runtime 真闸（enabledRuntimes）保留不变；换绑即改派。
// 失败方式（先于实现固化，仓测试纪律）：
// 1. worker 归属机闸：绑 A → A 领、B 空手；换绑 B → B 领（改派即时生效）；
//    未设归属机 → 任何机器都领不到（留 pending，sweep 的可见失败归
//    build-abandoned-sweep.test.ts）。
// 2. runtime 真闸（#682 语义不变）：归属机未开步所需 runtime → 领不到；
//    开回 → 领到（PATCH 热写秒级生效）。
// 3. chief 步投递（#1260）：去处 = 绑定 Agent 的归属机——Agent 绑 B → 唯
//    B 可领 chief 步；Agent 换绑 A → A 领（chief 行不再持机器槽）。
// 4. PATCH /chief 退役槽：machineId/model/compactionModel 不再受理（schema
//    面归 chief-demotion.test.ts 与 shared records 测试）。
// 5. GET /chief orchestration 封套：homeMachineId（= 绑定 Agent 的归属机）
//    + running/waiting 计数（waiting = 归属机当前不可执行的 pending 回合）。
// 6. 0022 回填（存量 [] 机器行 → ['pi']）幂等，与本票解耦保留。

import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ClaimedStep } from '@cairn/shared';
import {
  claimedStepSchema,
  machineOkResponseSchema,
  machineUploadUrlsResponseSchema,
  PLAN_FILE_NAME,
} from '@cairn/shared';
import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterAll, describe, expect, test } from 'vitest';
import { MIGRATIONS_FOLDER } from '../src/db/client.js';
import * as schema from '../src/db/schema.js';
import {
  agent as agentTable,
  chief as chiefTable,
  machine as machineTable,
  step as stepTable,
} from '../src/db/schema.js';
import { seed } from '../src/db/seed.js';
import {
  bootServer,
  issueApiKey,
  postProject,
  req,
  type TestServer,
  withVerification,
} from './helpers.js';

const AGENT_ID = 'agent-home-1';
const CC_AGENT_ID = 'agent-home-cc';

const temps: string[] = [];
function temp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

/** 带 Bearer 的请求（machine wire 面，g2t2 同律——helpers.req 不带鉴权头）。 */
function call(
  app: TestServer['app'],
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

/** 注册一台机器换 claim token（enroll 缺省 enabledRuntimes=['pi']，#682）。 */
async function enroll(s: TestServer, name: string): Promise<string> {
  const key = await issueApiKey(s);
  const res = await call(s.app, 'POST', '/api/machine/enroll', {
    cred: key,
    body: { teamId: s.team.id, name, cliVersion: '0.1.0' },
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { token: string }).token;
}

async function claim(app: TestServer['app'], token: string): Promise<ClaimedStep | null> {
  const res = await call(app, 'POST', '/api/machine/tasks/claim', { cred: token, body: {} });
  const body = (await res.json()) as { step: ClaimedStep | null };
  return body.step === null ? null : claimedStepSchema.parse(body.step);
}

function seedAgent(s: TestServer, id: string, provider: string, machineId: string | null) {
  s.db
    .insert(agentTable)
    .values({
      id,
      teamId: s.team.id,
      displayName: id,
      status: 'active',
      avatarUrl: null,
      provider,
      modelId: 'stub-model',
      thinkingLevel: null,
      tools: [],
      secrets: [],
      defaultSkill: null,
      skillsAllowlist: null,
      mcpServers: [],
      machineId,
    })
    .run();
}

interface World {
  s: TestServer;
  tokenA: string;
  tokenB: string;
  machineAId: string;
  machineBId: string;
  projectId: string;
}

async function setupWorld(): Promise<World> {
  const s = bootServer({ claimHoldMs: 200 });
  temps.push(''); // dispose 由 bootServer 拥有的目录自身管理；空占位避免误删
  const tokenA = await enroll(s, 'home-mbp');
  const tokenB = await enroll(s, 'home-other');
  const machineAId = s.db
    .select()
    .from(machineTable)
    .where(eq(machineTable.name, 'home-mbp'))
    .get()!.id;
  const machineBId = s.db
    .select()
    .from(machineTable)
    .where(eq(machineTable.name, 'home-other'))
    .get()!.id;
  // #1259：agent 出生即绑归属机（worker 面缺省形态）。
  seedAgent(s, AGENT_ID, 'stub-gw', machineAId);
  seedAgent(s, CC_AGENT_ID, 'claude-code', machineAId);
  const projectId = await postProject(s.app, 'home-proj');
  return { s, tokenA, tokenB, machineAId, machineBId, projectId };
}

async function createTodo(s: TestServer, projectId: string): Promise<string> {
  const res = await req(s.app, 'POST', `/api/projects/${projectId}/todos`, {
    title: '',
    spec: '探针任务',
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function startBuild(s: TestServer, projectId: string, todoId: string): Promise<string> {
  const res = await req(s.app, 'POST', `/api/projects/${projectId}/builds`, {
    todoIds: [todoId],
    assignment: { plan: null, build: { agentId: AGENT_ID } },
    withPlan: false,
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { builds: { id: string }[] }).builds[0]!.id as string;
}

describe('#1259 worker 归属机闸', () => {
  test('绑 A → A 领、B 空手；换绑 B → B 领（改派即时生效）', async () => {
    const w = await setupWorld();
    const todoId = await createTodo(w.s, w.projectId);
    await startBuild(w.s, w.projectId, todoId);

    // 别机空手。
    expect(await claim(w.s.app, w.tokenB)).toBeNull();
    // 归属机领到。
    const got = await claim(w.s.app, w.tokenA);
    expect(got).not.toBeNull();
    expect(got!.step.machineId).toBe(w.machineAId);

    // 换绑 B：下一条步 B 领、A 空手。
    const rebind = await req(w.s.app, 'PATCH', `/api/teams/${w.s.team.id}/agents/${AGENT_ID}`, {
      machineId: w.machineBId,
    });
    expect(rebind.status).toBe(200);
    const todoId2 = await createTodo(w.s, w.projectId);
    await startBuild(w.s, w.projectId, todoId2);
    expect(await claim(w.s.app, w.tokenA)).toBeNull();
    const got2 = await claim(w.s.app, w.tokenB);
    expect(got2).not.toBeNull();
    expect(got2!.step.machineId).toBe(w.machineBId);
  });

  test('未设归属机 → 任何机器都领不到（留 pending）', async () => {
    const w = await setupWorld();
    seedAgent(w.s, 'agent-homeless', 'stub-gw', null);
    const todoId = await createTodo(w.s, w.projectId);
    const res = await req(w.s.app, 'POST', `/api/projects/${w.projectId}/builds`, {
      todoIds: [todoId],
      assignment: { plan: null, build: { agentId: 'agent-homeless' } },
      withPlan: false,
    });
    expect(res.status).toBe(201);
    expect(await claim(w.s.app, w.tokenA)).toBeNull();
    expect(await claim(w.s.app, w.tokenB)).toBeNull();
  });
});

describe('#1312 续接会话的异机标记', () => {
  async function finishPlan(w: World, stepId: string, sessionId: string): Promise<void> {
    const urlsRes = await call(w.s.app, 'POST', `/api/machine/upload-urls/${stepId}`, {
      cred: w.tokenA,
      body: { files: [{ name: PLAN_FILE_NAME }] },
    });
    expect(urlsRes.status).toBe(200);
    const planUpload = machineUploadUrlsResponseSchema.parse(await urlsRes.json()).uploads[0]!;
    const planPath = planUpload.url.replace(/^https?:\/\/[^/]+/, '');
    const planPut = await w.s.app.request(planPath, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${w.tokenA}`,
        'content-type': 'text/markdown',
      },
      body: withVerification('# 方案\nContext: 1312\n'),
    });
    expect(machineOkResponseSchema.parse(await planPut.json())).toEqual({ ok: true });
    const doneRes = await call(w.s.app, 'POST', `/api/machine/done/${stepId}`, {
      cred: w.tokenA,
      body: { status: 'success', sessionId, hasChanges: false },
    });
    expect(doneRes.status).toBe(200);
  }

  test('同机续接不带 priorMachineId；换绑后领取带上一轮机器', async () => {
    const w = await setupWorld();
    const todoId = await createTodo(w.s, w.projectId);
    const buildRes = await req(w.s.app, 'POST', `/api/projects/${w.projectId}/builds`, {
      todoIds: [todoId],
      assignment: { plan: { agentId: AGENT_ID }, build: { agentId: AGENT_ID } },
      withPlan: true,
    });
    expect(buildRes.status).toBe(201);
    const plan = await claim(w.s.app, w.tokenA);
    expect(plan?.step.kind).toBe('plan');
    await finishPlan(w, plan!.step.id, 'sess-home');

    const confirmRes = await req(w.s.app, 'POST', `/api/builds/${plan!.step.buildId}/steps`, {
      action: 'confirm',
    });
    expect(confirmRes.status).toBe(202);
    const sameMachine = await claim(w.s.app, w.tokenA);
    expect(sameMachine?.step.kind).toBe('build');
    expect(sameMachine?.session).toEqual({ action: 'continue', sessionId: 'sess-home' });

    const todoId2 = await createTodo(w.s, w.projectId);
    const buildRes2 = await req(w.s.app, 'POST', `/api/projects/${w.projectId}/builds`, {
      todoIds: [todoId2],
      assignment: { plan: { agentId: AGENT_ID }, build: { agentId: AGENT_ID } },
      withPlan: true,
    });
    expect(buildRes2.status).toBe(201);
    const plan2 = await claim(w.s.app, w.tokenA);
    expect(plan2?.step.kind).toBe('plan');
    await finishPlan(w, plan2!.step.id, 'sess-moved');
    const rebind = await req(w.s.app, 'PATCH', `/api/teams/${w.s.team.id}/agents/${AGENT_ID}`, {
      machineId: w.machineBId,
    });
    expect(rebind.status).toBe(200);
    const confirm2 = await req(w.s.app, 'POST', `/api/builds/${plan2!.step.buildId}/steps`, {
      action: 'confirm',
    });
    expect(confirm2.status).toBe(202);
    expect(await claim(w.s.app, w.tokenA)).toBeNull();
    const moved = await claim(w.s.app, w.tokenB);
    expect(moved).not.toBeNull();
    expect(moved!.step.kind).toBe('build');
    expect(moved!.session.action).toBe('continue');
    expect(moved!.session.sessionId).toBe('sess-moved');
    const priorMachineId = (moved!.session as { priorMachineId?: string }).priorMachineId;
    expect(priorMachineId).toBe(w.machineAId);
  });
});

describe('#682 runtime 真闸（语义不变，归属机版）', () => {
  test('归属机未开步所需 runtime → 领不到；开回 → 领到（PATCH 热写）', async () => {
    const w = await setupWorld();
    // 关掉 A 的 pi：agent（stub-gw → pi 档）的步领不到。
    const off = await req(w.s.app, 'PATCH', `/api/machines/${w.machineAId}`, {
      enabledRuntimes: [],
    });
    expect(off.status).toBe(200);
    const todoId = await createTodo(w.s, w.projectId);
    await startBuild(w.s, w.projectId, todoId);
    expect(await claim(w.s.app, w.tokenA)).toBeNull();

    // 开回 → 领到（热写秒级生效）。
    const on = await req(w.s.app, 'PATCH', `/api/machines/${w.machineAId}`, {
      enabledRuntimes: ['pi'],
    });
    expect(on.status).toBe(200);
    const got = await claim(w.s.app, w.tokenA);
    expect(got).not.toBeNull();
  });

  test('claude-code agent 步在只开 pi 的归属机上领不到；换绑到双开机器领到', async () => {
    const w = await setupWorld();
    // B 开双 runtime。
    const dual = await req(w.s.app, 'PATCH', `/api/machines/${w.machineBId}`, {
      enabledRuntimes: ['pi', 'claude-code'],
    });
    expect(dual.status).toBe(200);
    const todoId = await createTodo(w.s, w.projectId);
    const res = await req(w.s.app, 'POST', `/api/projects/${w.projectId}/builds`, {
      todoIds: [todoId],
      assignment: { plan: null, build: { agentId: CC_AGENT_ID } },
      withPlan: false,
    });
    expect(res.status).toBe(201);
    // A 只开 pi：领不到 claude-code 步。
    expect(await claim(w.s.app, w.tokenA)).toBeNull();
    // 换绑校验（#1259 模型闸）：B 未上报模型清单 → 400 拒。
    const denied = await req(w.s.app, 'PATCH', `/api/teams/${w.s.team.id}/agents/${CC_AGENT_ID}`, {
      machineId: w.machineBId,
    });
    expect(denied.status).toBe(400);
    // B 上报含该模型的清单 → 换绑放行 → 领到。
    w.s.db
      .update(machineTable)
      .set({
        claudeCodeReport: {
          installed: true,
          hostname: 'home-other',
          models: [{ id: 'stub-model', name: 'stub-model', slot: 'default' }],
        },
      })
      .where(eq(machineTable.id, w.machineBId))
      .run();
    const rebind = await req(w.s.app, 'PATCH', `/api/teams/${w.s.team.id}/agents/${CC_AGENT_ID}`, {
      machineId: w.machineBId,
    });
    expect(rebind.status).toBe(200);
    const got = await claim(w.s.app, w.tokenB);
    expect(got).not.toBeNull();
  });
});

describe('#1260 chief 步投递 = 绑定 Agent 归属机', () => {
  function bindChief(w: World): void {
    const chiefId = `chief-${w.s.user.id}-${w.s.team.id}`;
    w.s.db
      .insert(chiefTable)
      .values({
        id: chiefId,
        userId: w.s.user.id,
        teamId: w.s.team.id,
        agentId: AGENT_ID,
        charter: '',
        createdAt: Date.now(),
      })
      .run();
  }

  test('Agent 绑 B → 唯 B 可领 chief 步；Agent 换绑 A → A 领（改派即时生效）', async () => {
    const w = await setupWorld();
    bindChief(w);
    // Agent 换绑 B：chief 步只投 B。
    const rebind = await req(w.s.app, 'PATCH', `/api/teams/${w.s.team.id}/agents/${AGENT_ID}`, {
      machineId: w.machineBId,
    });
    expect(rebind.status).toBe(200);
    const todoId = await createTodo(w.s, w.projectId);
    const res = await req(w.s.app, 'POST', `/api/todos/${todoId}/orchestrate`, {});
    expect(res.status).toBe(201);
    expect(await claim(w.s.app, w.tokenA)).toBeNull();
    const got = await claim(w.s.app, w.tokenB);
    expect(got).not.toBeNull();
    expect(got!.step.kind).toBe('chief');

    // 换回 A：新回合 A 领、B 空手。
    const back = await req(w.s.app, 'PATCH', `/api/teams/${w.s.team.id}/agents/${AGENT_ID}`, {
      machineId: w.machineAId,
    });
    expect(back.status).toBe(200);
    const todoId2 = await createTodo(w.s, w.projectId);
    const res2 = await req(w.s.app, 'POST', `/api/todos/${todoId2}/orchestrate`, {});
    expect(res2.status).toBe(201);
    expect(await claim(w.s.app, w.tokenB)).toBeNull();
    const got2 = await claim(w.s.app, w.tokenA);
    expect(got2).not.toBeNull();
    expect(got2!.step.kind).toBe('chief');
  });
});

describe('#895 GET /chief orchestration 封套（spec 21 A5；#1260 换源）', () => {
  interface OrchestrationBlock {
    orchestration: {
      homeMachineId: string | null;
      activity: { machineId: string; running: number; waiting: number }[];
    };
  }

  async function getEnvelope(w: World): Promise<OrchestrationBlock> {
    const res = await req(w.s.app, 'GET', `/api/teams/${w.s.team.id}/chief`);
    expect(res.status).toBe(200);
    return (await res.json()) as OrchestrationBlock;
  }

  /** 改写 POST 已入队的 chief 步（封套计数的事实源——每线程恰好一步，不
   *  另插行以免重复计数）。 */
  function setChiefStep(
    s: TestServer,
    threadId: string,
    opts: { status: 'claimed' | 'pending'; machineId?: string | null },
  ): void {
    const row = s.db.select().from(stepTable).where(eq(stepTable.buildId, threadId)).get()!;
    s.db
      .update(stepTable)
      .set({ status: opts.status, machineId: opts.machineId ?? null })
      .where(eq(stepTable.id, row.id))
      .run();
  }

  test('失败方式 G：投影——homeMachineId + running（claimed）/ waiting（归属机不可执行的 pending）计数', async () => {
    const w = await setupWorld();
    // chief 绑定 AGENT_ID（出生绑 A）→ homeMachineId = A。
    await req(w.s.app, 'PATCH', `/api/teams/${w.s.team.id}/chief`, {
      agent: { agentId: AGENT_ID },
    });
    // running：A 上一个 claimed chief 步。
    const t1 = await req(w.s.app, 'POST', `/api/teams/${w.s.team.id}/chief/threads`, {
      content: '回合一',
    });
    const thread1 = ((await t1.json()) as { thread: { id: string } }).thread.id;
    setChiefStep(w.s, thread1, { status: 'claimed', machineId: w.machineAId });
    // waiting：归属机 A 离线（直写 DB），新回合 pending → 计入 A 的 waiting。
    w.s.db
      .update(machineTable)
      .set({ online: false })
      .where(eq(machineTable.id, w.machineAId))
      .run();
    await req(w.s.app, 'POST', `/api/teams/${w.s.team.id}/chief/threads`, {
      content: '回合二',
    });

    const body = await getEnvelope(w);
    expect(body.orchestration.homeMachineId).toBe(w.machineAId);
    const activityA = body.orchestration.activity.find((a) => a.machineId === w.machineAId);
    expect(activityA?.running).toBe(1);
    expect(activityA?.waiting).toBe(1);
  });

  test('失败方式 H：waiting 判据——归属机在线但 runtime 闸关也计入（T3 缝隙可见性）', async () => {
    const w = await setupWorld();
    // B 只开 claude-code；chief 绑定 agent = stub-gw → pi 档；Agent 换绑 B。
    await req(w.s.app, 'PATCH', `/api/teams/${w.s.team.id}/chief`, {
      agent: { agentId: AGENT_ID },
    });
    const rebind = await req(w.s.app, 'PATCH', `/api/teams/${w.s.team.id}/agents/${AGENT_ID}`, {
      machineId: w.machineBId,
    });
    expect(rebind.status).toBe(200);
    await req(w.s.app, 'PATCH', `/api/machines/${w.machineBId}`, {
      enabledRuntimes: ['claude-code'],
    });
    w.s.db
      .update(machineTable)
      .set({ online: true })
      .where(eq(machineTable.id, w.machineBId))
      .run();
    await req(w.s.app, 'POST', `/api/teams/${w.s.team.id}/chief/threads`, {
      content: '回合',
    });

    const body = await getEnvelope(w);
    expect(body.orchestration.homeMachineId).toBe(w.machineBId);
    const activityB = body.orchestration.activity.find((a) => a.machineId === w.machineBId);
    expect(activityB?.waiting).toBe(1);
  });

  test('回归红线：chief 未绑定 Agent + 无 chief 步 → homeMachineId null + activity 空', async () => {
    const w = await setupWorld();
    const body = await getEnvelope(w);
    expect(body.orchestration.homeMachineId).toBeNull();
    expect(body.orchestration.activity).toEqual([]);
  });
});

describe('#682 0022 回填（存量 [] 机器行 → [pi]）', () => {
  function readJournal(folder: string): { entries: { idx: number; tag: string }[] } {
    return JSON.parse(readFileSync(join(folder, 'meta', '_journal.json'), 'utf8'));
  }

  /** 定位含 machine.enabledRuntimes 回填 UPDATE 的 migration（不写死序号，
   * 撞号纪律同 agent-tool-backfill.test.ts）。 */
  function pinMigrationIdx(): number {
    const journal = readJournal(MIGRATIONS_FOLDER);
    const idx = journal.entries.findIndex((entry) =>
      /UPDATE `machine` SET `enabledRuntimes`/i.test(
        readFileSync(join(MIGRATIONS_FOLDER, `${entry.tag}.sql`), 'utf8'),
      ),
    );
    expect(idx, 'journal 里找不到 enabledRuntimes 回填 migration').toBeGreaterThan(0);
    return idx;
  }

  function prePinMigrations(): string {
    const journal = readJournal(MIGRATIONS_FOLDER);
    const cut = pinMigrationIdx();
    const dir = temp('cairn-migrations-pre-pin-');
    mkdirSync(join(dir, 'meta'));
    for (const entry of journal.entries.slice(0, cut)) {
      cpSync(join(MIGRATIONS_FOLDER, `${entry.tag}.sql`), join(dir, `${entry.tag}.sql`));
      const snapshot = join(MIGRATIONS_FOLDER, 'meta', `${entry.tag}_snapshot.json`);
      try {
        cpSync(snapshot, join(dir, 'meta', `${entry.tag}_snapshot.json`));
      } catch {
        /* snapshot 缺位先例（agent-tool-backfill 同律） */
      }
    }
    const full = readJournal(MIGRATIONS_FOLDER);
    writeFileSync(
      join(dir, 'meta', '_journal.json'),
      JSON.stringify({ ...full, entries: full.entries.slice(0, cut) }, null, 2),
    );
    return dir;
  }

  function buildPrePinDb(): string {
    const dir = temp('cairn-pin-db-');
    const dbPath = join(dir, 'server.db');
    const sqlite = new Database(dbPath);
    const db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder: prePinMigrations() });
    const { team } = seed(db);
    const insert = sqlite.prepare(
      'INSERT INTO machine (id, teamId, name, enabledRuntimes) VALUES (?, ?, ?, ?)',
    );
    insert.run('m-legacy-off', team.id, 'legacy-off', '[]');
    insert.run('m-legacy-cc', team.id, 'legacy-cc', '["claude-code"]');
    sqlite.close();
    return dbPath;
  }

  function readRuntimes(dbPath: string, id: string): string[] {
    const sqlite = new Database(dbPath, { readonly: true });
    const row = sqlite.prepare('SELECT enabledRuntimes FROM machine WHERE id = ?').get(id) as {
      enabledRuntimes: string;
    };
    sqlite.close();
    return JSON.parse(row.enabledRuntimes);
  }

  test('升级前旧库 → 补跑全量 migration：[] 行回填 [pi]，已开 claude-code 行不动', () => {
    const dbPath = buildPrePinDb();
    const sqlite = new Database(dbPath);
    const db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    sqlite.close();
    expect(readRuntimes(dbPath, 'm-legacy-off')).toEqual(['pi']);
    expect(readRuntimes(dbPath, 'm-legacy-cc')).toEqual(['claude-code']);
  });

  test('回填 UPDATE 幂等（防御性重放不重复；ALTER 段不在重放面）', () => {
    const dbPath = buildPrePinDb();
    const entry = readJournal(MIGRATIONS_FOLDER).entries[pinMigrationIdx()]!;
    const sql = readFileSync(join(MIGRATIONS_FOLDER, `${entry.tag}.sql`), 'utf8');
    // 幂等面只覆盖回填 UPDATE（ALTER 段双跑必然 duplicate column——迁移框架
    // 用 journal 保证单跑，重放防护只需数据语句自身幂等，0018 同律）。
    const updateStmt = sql
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .find((s) => /^UPDATE `machine`/i.test(s))!;
    const sqlite = new Database(dbPath);
    sqlite.exec(updateStmt);
    sqlite.exec(updateStmt);
    sqlite.close();
    expect(readRuntimes(dbPath, 'm-legacy-off')).toEqual(['pi']);
  });
});
