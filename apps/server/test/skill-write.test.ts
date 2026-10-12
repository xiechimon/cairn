// XMON-109 S1：技能库写路径（spec 13 回摆——「网页上传建技能 / chief 自动
// 安装制作技能」两件 Out of Scope 移入 scope）。三入口同落 services/skills.ts
// 写路径 + skill_audit 审计行：REST（member 执行者）、worker relay（agent 行
// tools 开关执法，requestMerge 403 同形）、chief relay（免开关，leader 拍板）。
// machine-wire GET /api/machine/skills/{stepId} = S2 daemon 物化消费契约
// （per-step 凭证 + agent.skillsAllowlist 白名单交集 + 按需拉；null = 全量，#1169）。
//
// 失败方式先行枚举（仓规：先列失败方式再写实现）——
// V 校验面（create/update 共用闸，全 400 可读文本）：V1 files 无 SKILL.md /
//   V2 SKILL.md frontmatter 缺 name / 缺 description（各各自点名）/
//   V3 frontmatter 与 body 声明不一致（frontmatter 是唯一真值）/
//   V4 目录名非法（'..'、'a/b'、反斜杠、'-x'、空、>64）/
//   V5 单文件超 MAX_SKILL_FILE_BYTES / V6 总量超 MAX_SKILL_TOTAL_BYTES /
//   V7 路径逃逸（'../x'、'.'/'..' 段、空段）/ V8 重复 path。
// C create：C1 正常 → 201 + 目录落盘 + GET 立即可见 / C2 目录名已占用 → 409 /
//   C3 他目录同 id（frontmatter 同名）→ 409。
// U update：U1 未知 id → 404 / U2 覆写语义（列出者覆写、未列者保留）/
//   U3 写面只落本 skill 子目录（逃逸/落点已是目录/穿越符号链接 → 400）/
//   U4 改名 = SKILL.md 新 frontmatter；撞他 id → 409；无 SKILL.md 改名 → 400 /
//   U5 无 SKILL.md 的更新：name/description 声明须与现 frontmatter 一致。
// A 审计：A1 REST 双动作各一行（actor member、字段齐、bytes = 写入字节数）/
//   A2 worker relay（actor agent）/ A3 chief relay（actor = 绑定 agent）。
// R worker relay：R1 claim 词表恒列 create_skill/update_skill /
//   R2 无开关 → 403 文本点名「创建技能」/ R3 有开关 create → 落盘 + 审计 /
//   R4 update 同律（无开关 → 403 点名「更新技能」，有 → 落盘 + 审计）。
//   （无 agent 步的 409 拒绝 = 纵深防御面：agent 空槽步不入 claim 候选，
//   公开 wire 构造不出来，与记忆三件套 409 同处境，不单测。）
// K chief relay：K1 create_skill 免开关可用 + 审计行 / K2 update_skill 同律 /
//   K3 未知 skillId → 404。
// M machine-wire（#920 清单 + 按需拉）：M1 白名单技能清单（agent.skillsAllowlist ∩
//   现扫；每文件 path/sizeBytes/sha256，selection=whitelist）/ M2 白名单外
//   技能不列 / M3 非本步凭证（他机 token）→ 404 / M4 未知 stepId → 404 /
//   M5 超限文件不再让整包失败（分发面无字节闸：真实 size 入清单、字节完整
//   下发）/ M6 chief 步 = 全量信任面（selection=all）/ M7 白名单空集 = 空
//   清单不炸 / M8 file 端点原始字节下发（含二进制诚实）/ M9 file 端点清单
//   外·白名单外·逃逸形 404 不泄存在性 / M10 file 端点归属面 404。

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AGENT_TOOL_SKILL_CREATE,
  AGENT_TOOL_SKILL_UPDATE,
  type ClaimedStep,
  MAX_SKILL_FILE_BYTES,
  MAX_SKILL_TOTAL_BYTES,
  machineSkillsManifestResponseSchema,
  skillRecordSchema,
} from '@pacman/shared';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { afterAll, describe, expect, test } from 'vitest';
import { agent as agentTable, skillAudit } from '../src/db/schema.js';
import { type ChiefToolCtx, executeChiefTool } from '../src/services/chief-tools.js';
import { bindAllAgents, bootServer, issueApiKey, postProject, req } from './helpers.js';

// —— 脚手架（隔离技能根 + 技能 body 组装）——————————————————————————————————

const roots: string[] = [];
function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'pacman-skills-'));
  roots.push(root);
  return root;
}
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function skillMd(name: string, description: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n# ${name}\n步骤…\n`;
}

function createBody(
  name: string,
  description: string,
  extra: { path: string; content: string }[] = [],
): { name: string; description: string; files: { path: string; content: string }[] } {
  return {
    name,
    description,
    files: [{ path: 'SKILL.md', content: skillMd(name, description) }, ...extra],
  };
}

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

async function errorText(res: Response): Promise<string> {
  return ((await res.json()) as { error?: string }).error ?? '';
}

// —— V 校验面 + C create + U update（REST 写面）———————————————————————————

describe('REST 写面（POST /api/skills + PUT teams/{id}/skills/{sid}）', () => {
  test('C1：正常 create → 201 record + 落盘 + GET 立即可见（无缓存现扫）', async () => {
    const skillsDir = makeRoot();
    const s = bootServer({ skillsDir });
    try {
      const res = await req(
        s.app,
        'POST',
        '/api/skills',
        createBody('deploy', '部署流程', [{ path: 'scripts/run.sh', content: 'echo ok\n' }]),
      );
      expect(res.status).toBe(201);
      const record = skillRecordSchema.parse(await res.json());
      expect(record).toMatchObject({ id: 'deploy', name: 'deploy', description: '部署流程' });
      expect(readFileSync(join(skillsDir, 'deploy', 'SKILL.md'), 'utf8')).toBe(
        skillMd('deploy', '部署流程'),
      );
      expect(readFileSync(join(skillsDir, 'deploy', 'scripts/run.sh'), 'utf8')).toBe('echo ok\n');
      const list = (await (await req(s.app, 'GET', `/api/skills?teamId=${s.team.id}`)).json()) as {
        id: string;
      }[];
      expect(list.map((r) => r.id)).toEqual(['deploy']);
    } finally {
      s.dispose();
    }
  });

  test('V1：files 无 SKILL.md → 400 点名', async () => {
    const s = bootServer({ skillsDir: makeRoot() });
    try {
      const res = await req(s.app, 'POST', '/api/skills', {
        name: 'noskill',
        description: 'x',
        files: [{ path: 'README.md', content: 'no entry file' }],
      });
      expect(res.status).toBe(400);
      expect(await errorText(res)).toContain('SKILL.md');
    } finally {
      s.dispose();
    }
  });

  test('V2：frontmatter 缺 name / 缺 description → 400 各自点名', async () => {
    const s = bootServer({ skillsDir: makeRoot() });
    try {
      const noName = await req(s.app, 'POST', '/api/skills', {
        name: 'a',
        description: 'd',
        files: [{ path: 'SKILL.md', content: '---\ndescription: d\n---\nbody\n' }],
      });
      expect(noName.status).toBe(400);
      expect(await errorText(noName)).toContain('name');

      const noDesc = await req(s.app, 'POST', '/api/skills', {
        name: 'b',
        description: 'd',
        files: [{ path: 'SKILL.md', content: '---\nname: b\n---\nbody\n' }],
      });
      expect(noDesc.status).toBe(400);
      expect(await errorText(noDesc)).toContain('description');
    } finally {
      s.dispose();
    }
  });

  test('V3：frontmatter 与 body 声明不一致 → 400（frontmatter 是唯一真值）', async () => {
    const s = bootServer({ skillsDir: makeRoot() });
    try {
      const res = await req(s.app, 'POST', '/api/skills', {
        name: 'body-name',
        description: 'body desc',
        files: [{ path: 'SKILL.md', content: skillMd('fm-name', 'fm desc') }],
      });
      expect(res.status).toBe(400);
      const text = await errorText(res);
      expect(text).toContain('frontmatter');
      expect(text).toContain('fm-name');
    } finally {
      s.dispose();
    }
  });

  test('V4：目录名非法（..、子路径、反斜杠、-x、空、超 64 字符）→ 400', async () => {
    const s = bootServer({ skillsDir: makeRoot() });
    try {
      for (const name of ['..', 'a/b', 'a\\b', '-x', '', 'x'.repeat(65)]) {
        const res = await req(s.app, 'POST', '/api/skills', {
          name,
          description: 'd',
          files: [{ path: 'SKILL.md', content: `---\nname: ${name}\ndescription: d\n---\n` }],
        });
        expect(res.status, JSON.stringify(name)).toBe(400);
        expect(await errorText(res)).toContain('name');
      }
    } finally {
      s.dispose();
    }
  });

  test('V5/V6：单文件超 512k / 总量超 MAX_SKILL_TOTAL_BYTES → 400 点名上限', async () => {
    const s = bootServer({ skillsDir: makeRoot() });
    try {
      const big = 'x'.repeat(MAX_SKILL_FILE_BYTES + 1);
      const perFile = await req(
        s.app,
        'POST',
        '/api/skills',
        createBody('big', 'd', [{ path: 'big.txt', content: big }]),
      );
      expect(perFile.status).toBe(400);
      const perFileError = await errorText(perFile);
      expect(perFileError).toContain('big.txt');
      expect(perFileError).toContain(`${MAX_SKILL_FILE_BYTES}`);

      // 总量超限用例：每份都低于单文件上限，只让总和破 2M（避开 V5 抢先命中）。
      const total = await req(
        s.app,
        'POST',
        '/api/skills',
        createBody('fat', 'd', [
          { path: 'a.txt', content: 'x'.repeat(420_000) },
          { path: 'b.txt', content: 'x'.repeat(420_000) },
          { path: 'c.txt', content: 'x'.repeat(420_000) },
          { path: 'd.txt', content: 'x'.repeat(420_000) },
          { path: 'e.txt', content: 'x'.repeat(420_000) },
        ]),
      );
      expect(total.status).toBe(400);
      const totalError = await errorText(total);
      expect(totalError).toContain('total');
      expect(totalError).toContain(`${MAX_SKILL_TOTAL_BYTES}`);
    } finally {
      s.dispose();
    }
  });

  test('V7/V8：路径逃逸与重复 path → 400（先全量校验后落盘，无半写）', async () => {
    const skillsDir = makeRoot();
    const s = bootServer({ skillsDir });
    try {
      for (const path of ['../escape.txt', './x.md', 'a//b.txt', 'a/../b.txt', '/abs.txt']) {
        const res = await req(
          s.app,
          'POST',
          '/api/skills',
          createBody('guard', 'd', [{ path, content: 'x' }]),
        );
        expect(res.status, JSON.stringify(path)).toBe(400);
        expect(await errorText(res)).toContain('path');
      }
      const dup = await req(
        s.app,
        'POST',
        '/api/skills',
        createBody('dup', 'd', [
          { path: 'a.txt', content: 'x' },
          { path: 'a.txt', content: 'y' },
        ]),
      );
      expect(dup.status).toBe(400);
      expect(await errorText(dup)).toContain('a.txt');
      expect(existsSync(join(skillsDir, 'dup'))).toBe(false);
    } finally {
      s.dispose();
    }
  });

  test('C2/C3：目录已占用 → 409；他目录同 id → 409 点名来源目录', async () => {
    const skillsDir = makeRoot();
    mkdirSync(join(skillsDir, 'busy')); // 空目录占位（非技能）
    mkdirSync(join(skillsDir, 'other'));
    writeFileSync(join(skillsDir, 'other', 'SKILL.md'), skillMd('clash', '既有技能'));
    const s = bootServer({ skillsDir });
    try {
      const busy = await req(s.app, 'POST', '/api/skills', createBody('busy', 'd'));
      expect(busy.status).toBe(409);
      expect(await errorText(busy)).toContain('busy');

      const clash = await req(s.app, 'POST', '/api/skills', createBody('clash', 'd'));
      expect(clash.status).toBe(409);
      expect(await errorText(clash)).toContain('other');
    } finally {
      s.dispose();
    }
  });

  test('U1：PUT 未知 id → 404', async () => {
    const s = bootServer({ skillsDir: makeRoot() });
    try {
      const res = await req(
        s.app,
        'PUT',
        `/api/teams/${s.team.id}/skills/ghost`,
        createBody('ghost', 'd'),
      );
      expect(res.status).toBe(404);
    } finally {
      s.dispose();
    }
  });

  test('U2：update 覆写语义——列出者覆写、未列者保留 → 200', async () => {
    const skillsDir = makeRoot();
    const dir = join(skillsDir, 'pkg');
    mkdirSync(dir);
    writeFileSync(join(dir, 'SKILL.md'), skillMd('pkg', '旧描述'));
    writeFileSync(join(dir, 'note.txt'), '旧笔记');
    const s = bootServer({ skillsDir });
    try {
      const res = await req(
        s.app,
        'PUT',
        `/api/teams/${s.team.id}/skills/pkg`,
        createBody('pkg', '新描述', [{ path: 'extra.md', content: '新增\n' }]),
      );
      expect(res.status).toBe(200);
      expect(skillRecordSchema.parse(await res.json())).toMatchObject({
        id: 'pkg',
        description: '新描述',
      });
      expect(readFileSync(join(dir, 'SKILL.md'), 'utf8')).toBe(skillMd('pkg', '新描述'));
      expect(readFileSync(join(dir, 'extra.md'), 'utf8')).toBe('新增\n');
      expect(readFileSync(join(dir, 'note.txt'), 'utf8')).toBe('旧笔记'); // 未列保留
    } finally {
      s.dispose();
    }
  });

  test('U3：update 写面只落本 skill 子目录（逃逸/落点已是目录/穿越符号链接 → 400）', async () => {
    const skillsDir = makeRoot();
    const dir = join(skillsDir, 'victim');
    mkdirSync(dir);
    writeFileSync(join(dir, 'SKILL.md'), skillMd('victim', 'd'));
    mkdirSync(join(dir, 'already-dir'));
    const outside = join(skillsDir, 'outside-target');
    mkdirSync(outside);
    symlinkSync(outside, join(dir, 'linked'));
    const s = bootServer({ skillsDir });
    try {
      const escapeReq = await req(
        s.app,
        'PUT',
        `/api/teams/${s.team.id}/skills/victim`,
        createBody('victim', 'd', [{ path: '../escape.txt', content: 'x' }]),
      );
      expect(escapeReq.status).toBe(400);

      const isDir = await req(
        s.app,
        'PUT',
        `/api/teams/${s.team.id}/skills/victim`,
        createBody('victim', 'd', [{ path: 'already-dir', content: 'x' }]),
      );
      expect(isDir.status).toBe(400);

      // linked → 技能根外的目录：写 sub/x 会经符号链接出域 → 拒绝
      const throughLink = await req(
        s.app,
        'PUT',
        `/api/teams/${s.team.id}/skills/victim`,
        createBody('victim', 'd', [{ path: 'linked/x.txt', content: 'x' }]),
      );
      expect(throughLink.status).toBe(400);
      expect(existsSync(join(outside, 'x.txt'))).toBe(false);
    } finally {
      s.dispose();
    }
  });

  test('U4：改名 = SKILL.md 新 frontmatter（目录不动，id 随 frontmatter）；撞他 id → 409；无 SKILL.md 改名 → 400', async () => {
    const skillsDir = makeRoot();
    const dir = join(skillsDir, 'old-name');
    mkdirSync(dir);
    writeFileSync(join(dir, 'SKILL.md'), skillMd('old-name', 'd'));
    mkdirSync(join(skillsDir, 'other'));
    writeFileSync(join(skillsDir, 'other', 'SKILL.md'), skillMd('taken', 'd'));
    const s = bootServer({ skillsDir });
    try {
      const renamed = await req(
        s.app,
        'PUT',
        `/api/teams/${s.team.id}/skills/old-name`,
        createBody('fresh-id', '新描述'),
      );
      expect(renamed.status).toBe(200);
      expect(skillRecordSchema.parse(await renamed.json())).toMatchObject({ id: 'fresh-id' });
      // 旧 id 解析不到、新 id 可见（目录名不变，id 随 frontmatter）
      expect((await req(s.app, 'GET', `/api/teams/${s.team.id}/skills/old-name`)).status).toBe(404);
      expect((await req(s.app, 'GET', `/api/teams/${s.team.id}/skills/fresh-id`)).status).toBe(200);

      // fresh-id 再改名撞 taken → 409
      const collide = await req(
        s.app,
        'PUT',
        `/api/teams/${s.team.id}/skills/fresh-id`,
        createBody('taken', 'd'),
      );
      expect(collide.status).toBe(409);

      // 不带 SKILL.md 的更新试图改名 → 400（frontmatter 才能改身份）
      const noMd = await req(s.app, 'PUT', `/api/teams/${s.team.id}/skills/fresh-id`, {
        name: 'another-id',
        description: '新描述',
        files: [{ path: 'a.txt', content: 'x' }],
      });
      expect(noMd.status).toBe(400);
    } finally {
      s.dispose();
    }
  });

  test('U5：无 SKILL.md 的更新——声明须与现 frontmatter 一致，不一致 → 400', async () => {
    const skillsDir = makeRoot();
    const dir = join(skillsDir, 'fixed');
    mkdirSync(dir);
    writeFileSync(join(dir, 'SKILL.md'), skillMd('fixed', '锁定描述'));
    const s = bootServer({ skillsDir });
    try {
      const wrongDesc = await req(s.app, 'PUT', `/api/teams/${s.team.id}/skills/fixed`, {
        name: 'fixed',
        description: '别的描述',
        files: [{ path: 'a.txt', content: 'x' }],
      });
      expect(wrongDesc.status).toBe(400);
      expect(await errorText(wrongDesc)).toContain('SKILL.md');

      const ok = await req(s.app, 'PUT', `/api/teams/${s.team.id}/skills/fixed`, {
        name: 'fixed',
        description: '锁定描述',
        files: [{ path: 'a.txt', content: 'x' }],
      });
      expect(ok.status).toBe(200);
    } finally {
      s.dispose();
    }
  });

  test('A1：REST 双动作各落一行审计（actor member、字段齐、bytes = 写入字节数）', async () => {
    const skillsDir = makeRoot();
    const s = bootServer({ skillsDir });
    try {
      const created = createBody('audit', '审计面', [{ path: 'a.txt', content: '12345' }]);
      await req(s.app, 'POST', '/api/skills', created);
      await req(s.app, 'PUT', `/api/teams/${s.team.id}/skills/audit`, created);
      const rows = s.db.select().from(skillAudit).all();
      expect(rows).toHaveLength(2);
      type AuditRow = typeof skillAudit.$inferSelect;
      const [createRow, updateRow] = rows.sort((a, b) => a.createdAt - b.createdAt) as [
        AuditRow,
        AuditRow,
      ];
      const bytes = created.files.reduce((sum, f) => sum + Buffer.byteLength(f.content, 'utf8'), 0);
      for (const row of [createRow, updateRow]) {
        expect(row.skillId).toBe('audit');
        expect(row.actorType).toBe('member');
        expect(row.actorId).toBe(s.user.id);
        expect(row.bytes).toBe(bytes);
      }
      expect(createRow.action).toBe('create');
      expect(updateRow.action).toBe('update');
    } finally {
      s.dispose();
    }
  });
});

// —— R worker relay（写词执法：agent 行 tools 开关，requestMerge 403 同形）———

const WORKER_AGENT_ID = 'agent-skill-writer';

describe('worker relay 技能写词（POST /api/machine/tool/{stepId}）', () => {
  async function workerWorld(opts: { tools: string[] }) {
    const skillsDir = makeRoot();
    const s = bootServer({ skillsDir, claimHoldMs: 250 });
    const key = await issueApiKey(s);
    const enroll = await call(s.app, 'POST', '/api/machine/enroll', {
      cred: key,
      body: { teamId: s.team.id, name: 'skill-write', cliVersion: '0.1.0' },
    });
    const { token } = (await enroll.json()) as { token: string };
    s.db
      .insert(agentTable)
      .values({
        id: WORKER_AGENT_ID,
        teamId: s.team.id,
        displayName: '写技能的',
        provider: 'p',
        modelId: 'm',
        tools: opts.tools,
        defaultSkill: null,
        skillsAllowlist: null,
      })
      .run();
    bindAllAgents(s); // #1259：测试世界单机——agent 全部绑它（可领缺省形态）

    const projectId = await postProject(s.app);
    const todoRes = await call(s.app, 'POST', `/api/projects/${projectId}/todos`, {
      body: { title: '', spec: '写一个部署技能\n\n现在的情况：部署靠手工' },
    });
    const { id: todoId } = (await todoRes.json()) as { id: string };
    await call(s.app, 'POST', `/api/projects/${projectId}/builds`, {
      body: {
        todoIds: [todoId],
        assignment: { plan: null, build: { agentId: WORKER_AGENT_ID } },
        withPlan: false,
      },
    });
    const claimRes = await call(s.app, 'POST', '/api/machine/tasks/claim', {
      cred: token,
      body: {},
    });
    const { step } = (await claimRes.json()) as { step: ClaimedStep | null };
    if (!step) throw new Error('no step claimed');
    return { s, skillsDir, token, step };
  }

  const relay = (app: Hono, token: string, stepId: string, body: unknown) =>
    call(app, 'POST', `/api/machine/tool/${stepId}`, {
      cred: token,
      body: { name: 'create_skill', params: body },
    });

  test('R1：claim 词表恒列 create_skill / update_skill（worker 恒列）', async () => {
    const { s, step } = await workerWorld({ tools: [] });
    try {
      expect(step.remoteTools?.map((t) => t.name)).toContain('create_skill');
      expect(step.remoteTools?.map((t) => t.name)).toContain('update_skill');
    } finally {
      s.dispose();
    }
  });

  test('R2：无「创建技能」开关 → 403 文本点名开关（Agent 详情页权限 tab）', async () => {
    const { s, token, step } = await workerWorld({ tools: [] });
    try {
      const res = await relay(s.app, token, step.step.id, createBody('denied', '无权'));
      expect(res.status).toBe(403);
      const text = await errorText(res);
      expect(text).toContain(AGENT_TOOL_SKILL_CREATE);
      expect(text).toContain('未获');
    } finally {
      s.dispose();
    }
  });

  test('R3：有开关 create_skill → 200 落盘 + 审计行（actor agent）', async () => {
    const { s, skillsDir, token, step } = await workerWorld({
      tools: [AGENT_TOOL_SKILL_CREATE],
    });
    try {
      const res = await relay(s.app, token, step.step.id, createBody('by-agent', 'agent 建'));
      expect(res.status).toBe(200);
      const { text } = (await res.json()) as { text: string };
      expect(skillRecordSchema.parse(JSON.parse(text))).toMatchObject({ id: 'by-agent' });
      expect(readFileSync(join(skillsDir, 'by-agent', 'SKILL.md'), 'utf8')).toContain('by-agent');
      const rows = s.db.select().from(skillAudit).all();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        skillId: 'by-agent',
        actorType: 'agent',
        actorId: WORKER_AGENT_ID,
        action: 'create',
      });
    } finally {
      s.dispose();
    }
  });

  test('R4：update_skill 同律——无「更新技能」→ 403；有 → 200 落盘 + 审计', async () => {
    const { s, skillsDir, token, step } = await workerWorld({ tools: [] });
    try {
      mkdirSync(join(skillsDir, 'seeded'));
      writeFileSync(join(skillsDir, 'seeded', 'SKILL.md'), skillMd('seeded', '旧'));
      const denied = await call(s.app, 'POST', `/api/machine/tool/${step.step.id}`, {
        cred: token,
        body: {
          name: 'update_skill',
          params: { skillId: 'seeded', ...createBody('seeded', '新') },
        },
      });
      expect(denied.status).toBe(403);
      expect(await errorText(denied)).toContain(AGENT_TOOL_SKILL_UPDATE);
      s.db
        .update(agentTable)
        .set({ tools: [AGENT_TOOL_SKILL_UPDATE] })
        .where(eq(agentTable.id, WORKER_AGENT_ID))
        .run();
      const ok = await call(s.app, 'POST', `/api/machine/tool/${step.step.id}`, {
        cred: token,
        body: {
          name: 'update_skill',
          params: { skillId: 'seeded', ...createBody('seeded', '新') },
        },
      });
      expect(ok.status).toBe(200);
      expect(readFileSync(join(skillsDir, 'seeded', 'SKILL.md'), 'utf8')).toContain('新');
      const rows = s.db.select().from(skillAudit).all();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        skillId: 'seeded',
        actorType: 'agent',
        actorId: WORKER_AGENT_ID,
        action: 'update',
      });
    } finally {
      s.dispose();
    }
  });
});

// —— K chief relay（组织面新增两词，chief 免开关）———————————————————————————

describe('chief relay 技能写词（免开关，actor = 绑定 agent）', () => {
  const CHIEF_AGENT_ID = 'agent-chief-bound';

  function setup() {
    const skillsDir = makeRoot();
    const s = bootServer({ skillsDir });
    s.db
      .insert(agentTable)
      .values({
        id: CHIEF_AGENT_ID,
        teamId: s.team.id,
        displayName: '总管绑定',
        provider: 'p',
        modelId: 'm',
        tools: [], // chief 免开关：tools 空 也必须可用
        defaultSkill: null,
        skillsAllowlist: null,
      })
      .run();
    const ctx: ChiefToolCtx = {
      teamId: s.team.id,
      userId: s.user.id,
      chiefId: 'chief-x',
      threadId: 'chief-thread-x',
      chiefAgentId: CHIEF_AGENT_ID,
      conversationId: 'chief-thread-x',
    };
    const deps = {
      db: s.db,
      hub: s.hub,
      machineHub: s.machineHub,
      box: s.secretBox,
      user: s.user,
      reposDir: s.reposDir,
      attachmentsDir: s.attachmentsDir,
      skillsDir,
    };
    return { s, skillsDir, ctx, deps };
  }

  test('K1：create_skill 免开关可用 + 审计行（actor = 绑定 agent）', async () => {
    const { s, skillsDir, deps, ctx } = setup();
    try {
      const text = await executeChiefTool(
        deps,
        ctx,
        'create_skill',
        createBody('chief-made', '总管建'),
      );
      expect(skillRecordSchema.parse(JSON.parse(text))).toMatchObject({ id: 'chief-made' });
      expect(readFileSync(join(skillsDir, 'chief-made', 'SKILL.md'), 'utf8')).toContain(
        'chief-made',
      );
      const rows = s.db.select().from(skillAudit).all();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        skillId: 'chief-made',
        actorType: 'agent',
        actorId: CHIEF_AGENT_ID,
        action: 'create',
      });
    } finally {
      s.dispose();
    }
  });

  test('K2：update_skill 免开关可用 + 审计行', async () => {
    const { s, skillsDir, deps, ctx } = setup();
    try {
      mkdirSync(join(skillsDir, 'chief-skill'));
      writeFileSync(join(skillsDir, 'chief-skill', 'SKILL.md'), skillMd('chief-skill', '旧'));
      const text = await executeChiefTool(deps, ctx, 'update_skill', {
        skillId: 'chief-skill',
        ...createBody('chief-skill', '新'),
      });
      expect(skillRecordSchema.parse(JSON.parse(text))).toMatchObject({
        id: 'chief-skill',
        description: '新',
      });
      expect(readFileSync(join(skillsDir, 'chief-skill', 'SKILL.md'), 'utf8')).toContain('新');
      expect(s.db.select().from(skillAudit).all()).toHaveLength(1);
    } finally {
      s.dispose();
    }
  });

  test('K3：update_skill 未知 skillId → 404', async () => {
    const { s, deps, ctx } = setup();
    try {
      await expect(
        executeChiefTool(deps, ctx, 'update_skill', {
          skillId: 'ghost',
          ...createBody('ghost', 'd'),
        }),
      ).rejects.toThrowError(/skill ghost/);
    } finally {
      s.dispose();
    }
  });

  test('K1 附：无绑定 agent 时 actor = member（userId）', async () => {
    const { s, deps, ctx } = setup();
    ctx.chiefAgentId = null; // 无绑定：审计落 member 面
    try {
      await executeChiefTool(deps, ctx, 'create_skill', createBody('user-made', '人建'));
      const rows = s.db.select().from(skillAudit).all();
      expect(rows[0]).toMatchObject({ actorType: 'member', actorId: s.user.id });
    } finally {
      s.dispose();
    }
  });
});

// —— M machine-wire（#920 清单 + 按需拉：GET /api/machine/skills/{stepId} +
// 同前缀 /file；S2 daemon 消费契约）———————————————————————————————————————

describe('machine-wire 技能清单与按需拉取（GET /api/machine/skills/{stepId}[/file]）', () => {
  async function claimWorld(
    opts: { defaultSkill?: string | null; skillsAllowlist?: string[] | null; root?: string } = {},
  ) {
    const skillsDir = opts.root ?? makeRoot();
    if (opts.root === undefined) {
      for (const name of ['alpha', 'beta']) {
        mkdirSync(join(skillsDir, name));
        writeFileSync(join(skillsDir, name, 'SKILL.md'), skillMd(name, `${name} 技能`));
        writeFileSync(join(skillsDir, name, 'helper.md'), `${name} 助手文件\n`);
      }
    }
    const s = bootServer({ skillsDir, claimHoldMs: 250 });
    const key = await issueApiKey(s);
    const enroll = await call(s.app, 'POST', '/api/machine/enroll', {
      cred: key,
      body: { teamId: s.team.id, name: 'skill-pkg', cliVersion: '0.1.0' },
    });
    const { token } = (await enroll.json()) as { token: string };
    s.db
      .insert(agentTable)
      .values({
        id: WORKER_AGENT_ID,
        teamId: s.team.id,
        displayName: '领技能包的',
        provider: 'p',
        modelId: 'm',
        tools: [],
        defaultSkill: opts.defaultSkill ?? null,
        skillsAllowlist: opts.skillsAllowlist ?? null,
      })
      .run();
    bindAllAgents(s); // #1259：测试世界单机——agent 全部绑它（可领缺省形态）
    const projectId = await postProject(s.app);
    const todoRes = await call(s.app, 'POST', `/api/projects/${projectId}/todos`, {
      body: { title: '', spec: '干活\n\n现在的情况：没技能' },
    });
    const { id: todoId } = (await todoRes.json()) as { id: string };
    await call(s.app, 'POST', `/api/projects/${projectId}/builds`, {
      body: {
        todoIds: [todoId],
        assignment: { plan: null, build: { agentId: WORKER_AGENT_ID } },
        withPlan: false,
      },
    });
    const claimRes = await call(s.app, 'POST', '/api/machine/tasks/claim', {
      cred: token,
      body: {},
    });
    const { step } = (await claimRes.json()) as { step: ClaimedStep | null };
    if (!step) throw new Error('no step claimed');
    return { s, skillsDir, token, step, key };
  }

  const pkg = (app: Hono, cred: string, stepId: string) =>
    call(app, 'GET', `/api/machine/skills/${stepId}`, { cred });

  const fileGet = (app: Hono, cred: string, stepId: string, dirName: string, path: string) =>
    call(
      app,
      'GET',
      `/api/machine/skills/${stepId}/file?${new URLSearchParams({ dirName, path }).toString()}`,
      { cred },
    );

  function sha256Hex(bytes: Buffer): string {
    return createHash('sha256').update(bytes).digest('hex');
  }

  test('M1/M2：白名单交集出清单（dirName + 逐文件 path/sizeBytes/sha256）；白名单外不列', async () => {
    const { s, token, step, skillsDir } = await claimWorld({ skillsAllowlist: ['alpha', 'ghost'] });
    try {
      const res = await pkg(s.app, token, step.step.id);
      expect(res.status).toBe(200);
      const body = machineSkillsManifestResponseSchema.parse(await res.json());
      expect(body.selection).toBe('whitelist');
      expect(body.skills).toHaveLength(1);
      const alpha = body.skills[0]!;
      expect(alpha).toMatchObject({ id: 'alpha', name: 'alpha', dirName: 'alpha' });
      expect(alpha.files.map((f) => f.path).sort()).toEqual(['SKILL.md', 'helper.md']);
      // 清单三元组 = 盘上真值（sizeBytes/sha256 逐文件对拍）。
      for (const f of alpha.files) {
        const onDisk = readFileSync(join(skillsDir, 'alpha', f.path));
        expect(f.sizeBytes).toBe(onDisk.byteLength);
        expect(f.sha256).toBe(sha256Hex(onDisk));
      }
    } finally {
      s.dispose();
    }
  });

  test('M3/M4/M10：非本步凭证（他机 token）→ 404；未知 stepId → 404（清单与 file 双面）', async () => {
    const { s, token, step } = await claimWorld({ skillsAllowlist: ['alpha'] });
    try {
      // 同 apiKey 重注册会复用 machineId（r3 §1.2），他机须另发一把 key。
      const key2 = await issueApiKey(s);
      const enroll2 = await call(s.app, 'POST', '/api/machine/enroll', {
        cred: key2,
        body: { teamId: s.team.id, name: 'other-machine', cliVersion: '0.1.0' },
      });

      bindAllAgents(s); // #1259：测试世界单机——agent 全部绑它（可领缺省形态）
      const { token: token2 } = (await enroll2.json()) as { token: string };
      const notYours = await pkg(s.app, token2, step.step.id);
      expect(notYours.status).toBe(404);
      const unknown = await pkg(s.app, token, 'no-such-step');
      expect(unknown.status).toBe(404);
      // file 端点同闸（ownedStep 单源）。
      const fileNotYours = await fileGet(s.app, token2, step.step.id, 'alpha', 'SKILL.md');
      expect(fileNotYours.status).toBe(404);
      const fileUnknown = await fileGet(s.app, token, 'no-such-step', 'alpha', 'SKILL.md');
      expect(fileUnknown.status).toBe(404);
    } finally {
      s.dispose();
    }
  });

  test('M5：超限文件不再让整包失败——超单文件闸的资产真实 size 入清单、字节完整下发；总量超旧包闸照常出清单', async () => {
    // fat：白名单内技能带一个超旧单文件上限（512,000）的文件——#920 根因
    // 形态（archify/assets/template.html 727,976 字节同形）。
    const fatRoot = makeRoot();
    mkdirSync(join(fatRoot, 'fat'));
    writeFileSync(join(fatRoot, 'fat', 'SKILL.md'), skillMd('fat', '大'));
    const big = Buffer.from('x'.repeat(MAX_SKILL_FILE_BYTES + 1), 'utf8');
    writeFileSync(join(fatRoot, 'fat', 'big.txt'), big);
    const fatWorld = await claimWorld({ skillsAllowlist: ['fat'], root: fatRoot });
    try {
      const res = await pkg(fatWorld.s.app, fatWorld.token, fatWorld.step.step.id);
      expect(res.status).toBe(200);
      const body = machineSkillsManifestResponseSchema.parse(await res.json());
      const bigEntry = body.skills[0]!.files.find((f) => f.path === 'big.txt');
      expect(bigEntry).toBeDefined();
      expect(bigEntry!.sizeBytes).toBe(big.byteLength);
      expect(bigEntry!.sha256).toBe(sha256Hex(big));
      const fileRes = await fileGet(
        fatWorld.s.app,
        fatWorld.token,
        fatWorld.step.step.id,
        'fat',
        'big.txt',
      );
      expect(fileRes.status).toBe(200);
      expect(Buffer.from(await fileRes.arrayBuffer())).toEqual(big);
    } finally {
      fatWorld.s.dispose();
    }

    // heavy：总量超旧整包上限（2,000,000）——分发面不再设总量闸，照常出清单。
    const heavyRoot = makeRoot();
    mkdirSync(join(heavyRoot, 'heavy'));
    writeFileSync(join(heavyRoot, 'heavy', 'SKILL.md'), skillMd('heavy', '重'));
    for (let i = 0; i < 5; i++) {
      writeFileSync(join(heavyRoot, 'heavy', `p${i}.txt`), 'x'.repeat(450_000));
    }
    const heavyWorld = await claimWorld({ skillsAllowlist: ['heavy'], root: heavyRoot });
    try {
      const totalOnDisk = 5 * 450_000;
      expect(totalOnDisk).toBeGreaterThan(MAX_SKILL_TOTAL_BYTES);
      const res = await pkg(heavyWorld.s.app, heavyWorld.token, heavyWorld.step.step.id);
      expect(res.status).toBe(200);
      const body = machineSkillsManifestResponseSchema.parse(await res.json());
      expect(body.skills[0]!.files).toHaveLength(6); // SKILL.md + p0..p4
      expect(body.skills[0]!.files.reduce((n, f) => n + f.sizeBytes, 0)).toBeGreaterThan(
        MAX_SKILL_TOTAL_BYTES,
      );
    } finally {
      heavyWorld.s.dispose();
    }
  });

  test('M6：chief 步 = 全量目录（信任面不受白名单约束）', async () => {
    const skillsDir = makeRoot();
    for (const name of ['alpha', 'beta']) {
      mkdirSync(join(skillsDir, name));
      writeFileSync(join(skillsDir, name, 'SKILL.md'), skillMd(name, `${name} 技能`));
    }
    const s = bootServer({ skillsDir, claimHoldMs: 250 });
    const key = await issueApiKey(s);
    const enroll = await call(s.app, 'POST', '/api/machine/enroll', {
      cred: key,
      body: { teamId: s.team.id, name: 'chief-pkg', cliVersion: '0.1.0' },
    });
    const { token } = (await enroll.json()) as { token: string };
    s.db
      .insert(agentTable)
      .values({
        id: WORKER_AGENT_ID,
        teamId: s.team.id,
        displayName: '总管',
        provider: 'p',
        modelId: 'stub-model',
        tools: [],
        // chief 即使行上白名单为空也拿全量（信任面）；#1169 两槽 null 形。
        defaultSkill: null,
        skillsAllowlist: null,
      })
      .run();
    bindAllAgents(s); // #1259：测试世界单机——agent 全部绑它（可领缺省形态）

    await call(s.app, 'PATCH', `/api/teams/${s.team.id}/chief`, {
      body: { agent: { agentId: WORKER_AGENT_ID, thinkingLevel: null } },
    });
    await call(s.app, 'POST', `/api/teams/${s.team.id}/chief/threads`, {
      body: { content: '整理一下团队技能。' },
    });
    const claimRes = await call(s.app, 'POST', '/api/machine/tasks/claim', {
      cred: token,
      body: {},
    });
    const { step } = (await claimRes.json()) as { step: ClaimedStep | null };
    if (!step) throw new Error('no chief step claimed');
    try {
      expect(step.step.kind).toBe('chief');
      const res = await pkg(s.app, token, step.step.id);
      expect(res.status).toBe(200);
      const body = machineSkillsManifestResponseSchema.parse(await res.json());
      expect(body.selection).toBe('all');
      expect(body.skills.map((sk) => sk.id)).toEqual(['alpha', 'beta']);
    } finally {
      s.dispose();
    }
  });

  test('M7：显式勾空（skillsAllowlist: []）= 空清单不炸（selection=whitelist）', async () => {
    const { s, token, step } = await claimWorld({ skillsAllowlist: [] });
    try {
      const res = await pkg(s.app, token, step.step.id);
      expect(res.status).toBe(200);
      const body = machineSkillsManifestResponseSchema.parse(await res.json());
      expect(body).toEqual({ selection: 'whitelist', skills: [] });
    } finally {
      s.dispose();
    }
  });

  test('M8（#1169）：worker 步 skillsAllowlist=null（不限制）→ selection=all 全量清单', async () => {
    // 失败方式：null 被读成空交集（selection=whitelist + 空清单）→ 不限制
    // agent 的技能面塌缩成全拒（daemon 物化面）。
    const { s, token, step } = await claimWorld({ skillsAllowlist: null });
    try {
      const res = await pkg(s.app, token, step.step.id);
      expect(res.status).toBe(200);
      const body = machineSkillsManifestResponseSchema.parse(await res.json());
      expect(body.selection).toBe('all');
      expect(body.skills.map((sk) => sk.id)).toEqual(['alpha', 'beta']);
    } finally {
      s.dispose();
    }
  });

  test('M8：file 端点原始字节下发——文本逐字节、二进制诚实（非 utf8 不损坏）', async () => {
    const root = makeRoot();
    mkdirSync(join(root, 'bin'));
    writeFileSync(join(root, 'bin', 'SKILL.md'), skillMd('bin', '二进制'));
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0xfe]);
    mkdirSync(join(root, 'bin', 'assets'));
    writeFileSync(join(root, 'bin', 'assets', 'logo.png'), png);
    const { s, token, step } = await claimWorld({ skillsAllowlist: ['bin'], root });
    try {
      const res = await fileGet(s.app, token, step.step.id, 'bin', 'assets/logo.png');
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('application/octet-stream');
      expect(Buffer.from(await res.arrayBuffer())).toEqual(png);
      // 清单侧同真值：sizeBytes/sha256 按盘上原始字节计。
      const manifestRes = await pkg(s.app, token, step.step.id);
      const body = machineSkillsManifestResponseSchema.parse(await manifestRes.json());
      const entry = body.skills[0]!.files.find((f) => f.path === 'assets/logo.png');
      expect(entry).toEqual({
        path: 'assets/logo.png',
        sizeBytes: png.byteLength,
        sha256: sha256Hex(png),
      });
    } finally {
      s.dispose();
    }
  });

  test('M9：file 端点 404 面——白名单外技能 / 清单外路径（未知文件、目录、符号链接）/ 逃逸形，一律不泄存在性', async () => {
    const root = makeRoot();
    for (const name of ['alpha', 'beta']) {
      mkdirSync(join(root, name));
      writeFileSync(join(root, name, 'SKILL.md'), skillMd(name, `${name} 技能`));
    }
    mkdirSync(join(root, 'alpha', 'refs'));
    writeFileSync(join(root, 'alpha', 'refs', 'inner.md'), 'inner\n');
    writeFileSync(join(root, 'outside-secret.txt'), 'server 侧技能根外的秘密\n');
    symlinkSync(join(root, 'outside-secret.txt'), join(root, 'alpha', 'leak.txt'));
    const { s, token, step } = await claimWorld({ skillsAllowlist: ['alpha'], root });
    const stepId = step.step.id;
    try {
      const cases: [string, string][] = [
        ['beta', 'SKILL.md'], // 白名单外技能
        ['alpha', 'no-such.md'], // 清单外未知文件
        ['alpha', 'refs'], // 目录不是文件
        ['alpha', 'refs/inner.md/../SKILL.md'], // 穿越形（规范化后也不受理）
        ['alpha', '../beta/SKILL.md'], // 逃逸技能目录
        ['alpha', '/etc/hosts'], // 绝对路径
        ['../alpha', 'SKILL.md'], // dirName 逃逸
        ['alpha', 'leak.txt'], // 符号链接不入清单（listSkillFiles 语义）
      ];
      for (const [dirName, path] of cases) {
        const res = await fileGet(s.app, token, stepId, dirName, path);
        expect(res.status, `${dirName}/${path}`).toBe(404);
      }
      // 清单内正路照常 200（对照面）。
      const ok = await fileGet(s.app, token, stepId, 'alpha', 'refs/inner.md');
      expect(ok.status).toBe(200);
      expect(Buffer.from(await ok.arrayBuffer()).toString('utf8')).toBe('inner\n');
    } finally {
      s.dispose();
    }
  });
});
