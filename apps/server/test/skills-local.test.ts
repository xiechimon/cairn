// spec 13 资源面本地化（#367 T1）：skills = 本地目录现扫只读投影（不入库、
// 无缓存、无导入面）。身份模型（2026-09-29 合同修订，对齐 spec 14 daemon
// 注入契约）：id = SKILL.md frontmatter name，无 frontmatter / 无 name 字段
// 回落目录名；agentskills.io / pi v0.86.0 同律（frontmatter.name 主键 +
// realpath 去重）。
//
// 失败方式先行枚举（仓规：先列失败方式再写实现）——
// S 扫描面：S1 目录不存在 = 空集不炸 / S2 路径是文件 = 空集 / S3 空目录 = 空集 /
//   S4 无 SKILL.md 子目录不入列（小写 skill.md 不认，canon 名精确匹配）/
//   S5 嵌套技能不发现（只扫一级子目录）/ S6 frontmatter name+description 采用 /
//   S7 无 frontmatter = id/name 回落目录名、description null /
//   S8 折叠块标量标记（`name: >`、`description: >` 族）不受理 = 回落 /
//   S9 id = frontmatter.name ≠ 目录名时以 frontmatter 为准（合同修订）/
//   S10 双目录声明同 name = 目录名序先者胜（确定性去重 [设计]）/
//   S11 符号链接目录收录且 realpath 去重只算一条 /
//   S12 SKILL.md 不可读（EISDIR/中途消失）= 跳过不炸。
// R REST 面：R1 GET /api/skills = 现扫 record 数组（skillRecordSchema；
//   teamId = 请求 team 占位）/ R2 未知 team = 404 / R3 无缓存：两次请求之间
//   加目录立即可见 / R4 空目录 = [] / R5 POST /api/skills 写面已回（XMON-109
//   spec 13 回摆）：校验闸 400（写面正测 = skill-write.test.ts）/ R6 POST
//   /api/skills/scan 已删 = 404 / R7 detail = record + fileNames
//   （嵌套相对路径、posix 分隔、含 SKILL.md 自身）/ R8 file = 内容、缺省
//   fileName = SKILL.md / R9 未知 sid = 404 / R10 未知 fileName = 404 /
//   R11 sid/fileName 路径逃逸 = 404（不出技能目录）/ R12 超大文件 = 400。
// A agent 面：A1 POST agents 携未知 skill id = 静默滤除只存现扫已知 id /
//   A2 PATCH 同律 / A3 全未知 = []（不报错——removed skill 停止可选即可）。
// C chief 面：C1 relay skills = 现扫投影 / C2 relay delete_skills = 400
//   unknown tool（词表已除名）/ C3 systemPrompt 资源清单含现扫技能。
// M mcp-face：M1 skills 工具 = 现扫投影。

import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseSkillFrontmatter, skillRecordSchema } from '@pacman/shared';
import { afterAll, describe, expect, test } from 'vitest';
import { composeChiefSystemPrompt } from '../src/services/chief.js';
import { type ChiefToolCtx, executeChiefTool } from '../src/services/chief-tools.js';
import { executeMcpTool } from '../src/services/mcp-face.js';
import { scanLocalSkills } from '../src/services/skills.js';
import { bootServer, insertMachine, req, type TestServer } from './helpers.js';

// —— 隔离技能根脚手架（每个 describe 自建自清）——————————————————————————————

const roots: string[] = [];
function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'pacman-skills-'));
  roots.push(root);
  return root;
}
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** 在 root 下建技能目录；frontmatter 传字符串原文、对象（生成 --- 块）或
 * null（无 frontmatter 裸正文）。 */
function addSkill(
  root: string,
  dirName: string,
  frontmatter: string | { name?: string; description?: string } | null = null,
): string {
  const dir = join(root, dirName);
  mkdirSync(dir, { recursive: true });
  const fm =
    frontmatter === null
      ? ''
      : typeof frontmatter === 'string'
        ? frontmatter
        : `---\n${Object.entries(frontmatter)
            .map(([k, v]) => `${k}: ${v}`)
            .join('\n')}\n---\n`;
  writeFileSync(join(dir, 'SKILL.md'), `${fm}# ${dirName}\n步骤…\n`);
  return dir;
}

// —— S 扫描面（服务缝：scanLocalSkills 纯 fs，无 DB/网络依赖）—————————————————

describe('scanLocalSkills 目录扫描', () => {
  test('S1/S2/S3：目录不存在、路径是文件、空目录 = 空集不炸', () => {
    const root = makeRoot();
    expect(scanLocalSkills(join(root, 'nope'))).toEqual([]); // S1 不存在
    const filePath = join(root, 'a-file');
    writeFileSync(filePath, 'x');
    expect(scanLocalSkills(filePath)).toEqual([]); // S2 非目录
    const empty = join(root, 'empty');
    mkdirSync(empty);
    expect(scanLocalSkills(empty)).toEqual([]); // S3 空目录
  });

  test('S4：无 SKILL.md 的子目录不入列；小写 skill.md 不认（canon 名精确）', () => {
    const root = makeRoot();
    mkdirSync(join(root, 'bare'));
    writeFileSync(join(root, 'bare', 'README.md'), '# x');
    mkdirSync(join(root, 'lower'));
    writeFileSync(join(root, 'lower', 'skill.md'), '---\nname: lower\n---\n');
    writeFileSync(join(root, 'SKILL.md'), '---\nname: root-level\n---\n'); // 根 SKILL.md 不算
    expect(scanLocalSkills(root)).toEqual([]);
  });

  test('S5：嵌套技能不发现——只扫一级子目录', () => {
    const root = makeRoot();
    mkdirSync(join(root, 'outer', 'inner'), { recursive: true });
    writeFileSync(join(root, 'outer', 'inner', 'SKILL.md'), '---\nname: inner\n---\n');
    expect(scanLocalSkills(root)).toEqual([]);
    // outer 自带 SKILL.md 时只出 outer 一条（inner 不另立门户）
    writeFileSync(join(root, 'outer', 'SKILL.md'), '---\nname: outer\n---\n');
    expect(scanLocalSkills(root).map((s) => s.id)).toEqual(['outer']);
  });

  test('S6/S7/S9：frontmatter 采用；无 frontmatter 回落目录名；id = frontmatter.name（合同修订）', () => {
    const root = makeRoot();
    addSkill(root, 'deploy', { name: 'deployer', description: '部署流程手册' });
    addSkill(root, 'plain', null);
    const scanned = scanLocalSkills(root);
    expect(scanned).toEqual([
      // S9：目录名 deploy，frontmatter name=deployer → id/name 均为 deployer
      { id: 'deployer', name: 'deployer', description: '部署流程手册', dirName: 'deploy' },
      // S7：无 frontmatter → 回落目录名
      { id: 'plain', name: 'plain', description: null, dirName: 'plain' },
    ]);
  });

  test('S8：折叠块标量标记不受理——name/description 回落（真打 anthropics/skills 实测形）', () => {
    const root = makeRoot();
    addSkill(
      root,
      'folded',
      '---\nname: academy-guide\ndescription: >\n  A folded multi-line\n  description here.\n---\n',
    );
    addSkill(root, 'folded-name', '---\nname: |-\n  block\n---\n');
    const scanned = scanLocalSkills(root);
    expect(scanned).toEqual([
      { id: 'academy-guide', name: 'academy-guide', description: null, dirName: 'folded' },
      // name 折叠标记 → 回落目录名
      { id: 'folded-name', name: 'folded-name', description: null, dirName: 'folded-name' },
    ]);
    // 解析器单测口径（与旧 GitHub 面同语义，保留回归钉）
    expect(parseSkillFrontmatter('---\nname: a\ndescription: b\n---\n')).toEqual({
      name: 'a',
      description: 'b',
    });
    expect(parseSkillFrontmatter('no frontmatter')).toEqual({});
    expect(parseSkillFrontmatter('---\nname: "quoted"\n---\n')).toEqual({ name: 'quoted' });
  });

  test('S10：双目录同 frontmatter name = 目录名序先者胜（确定性）', () => {
    const root = makeRoot();
    addSkill(root, 'zzz', { name: 'dup' });
    addSkill(root, 'aaa', { name: 'dup', description: 'aaa 的' });
    const scanned = scanLocalSkills(root);
    expect(scanned).toHaveLength(1);
    expect(scanned[0]).toMatchObject({ id: 'dup', dirName: 'aaa' });
  });

  test('S11：符号链接目录收录；realpath 去重只算一条', () => {
    const root = makeRoot();
    const real = addSkill(root, 'real', { name: 'linked-skill' });
    symlinkSync(real, join(root, 'alias')); // alias → real：realpath 同 = 一条
    // 留存条目 = 目录名字典序先者（alias < real，确定性去重律）
    expect(scanLocalSkills(root)).toEqual([
      { id: 'linked-skill', name: 'linked-skill', description: null, dirName: 'alias' },
    ]);
    // 链接指向根外目录也算技能（自托管单用户，信任本地目录树 [设计]）
    const outside = makeRoot();
    const outsideDir = addSkill(outside, 'outside-skill', { name: 'outside' });
    symlinkSync(outsideDir, join(root, 'external'));
    expect(
      scanLocalSkills(root)
        .map((s) => s.id)
        .sort(),
    ).toEqual(['linked-skill', 'outside']);
  });

  test('S12：SKILL.md 不可读（是目录/中途消失）= 跳过不炸', () => {
    const root = makeRoot();
    mkdirSync(join(root, 'weird', 'SKILL.md'), { recursive: true }); // EISDIR
    addSkill(root, 'ok', { name: 'ok' });
    expect(scanLocalSkills(root).map((s) => s.id)).toEqual(['ok']);
  });
});

// —— R REST 面（GET 换源 + 写面删除 + detail/file 读盘）———————————————————————

describe('skills REST 面（现扫换源）', () => {
  function setup() {
    const skillsDir = makeRoot();
    const s = bootServer({ skillsDir });
    return { s, skillsDir };
  }

  test('R1/R3/R4：GET /api/skills = 现扫 record 数组；无缓存加目录立即可见；空目录 = []', async () => {
    const { s, skillsDir } = setup();
    try {
      // R4 空目录
      const empty = await req(s.app, 'GET', `/api/skills?teamId=${s.team.id}`);
      expect(empty.status).toBe(200);
      expect(await empty.json()).toEqual([]);
      // R1 record 形
      addSkill(skillsDir, 'deploy', { name: 'deploy', description: '部署流程' });
      const res = await req(s.app, 'GET', `/api/skills?teamId=${s.team.id}`);
      const rows = (await res.json()) as unknown[];
      expect(rows).toHaveLength(1);
      const record = skillRecordSchema.parse(rows[0]);
      expect(record).toEqual({
        id: 'deploy',
        teamId: s.team.id, // teamId = 当前 team 占位（wire 形状保留）
        name: 'deploy',
        description: '部署流程',
      });
      // R3 无缓存：请求间加目录，下一次请求即可见
      addSkill(skillsDir, 'review', { name: 'review' });
      const again = (await (await req(s.app, 'GET', `/api/skills?teamId=${s.team.id}`)).json()) as {
        id: string;
      }[];
      expect(again.map((r) => r.id)).toEqual(['deploy', 'review']);
    } finally {
      s.dispose();
    }
  });

  test('R2：未知 team = 404 {error}', async () => {
    const { s } = setup();
    try {
      const res = await req(s.app, 'GET', '/api/skills?teamId=nope');
      expect(res.status).toBe(404);
      expect(Object.keys((await res.json()) as object)).toEqual(['error']);
    } finally {
      s.dispose();
    }
  });

  test('R5/R6：POST /api/skills 写面已回（旧形状 = 400 校验闸）；scan 仍删 = 404', async () => {
    const { s } = setup();
    try {
      // 旧上传形状（files 为 Record）不过 createSkillBodySchema = 400——写面
      // 正路径/校验细节由 skill-write.test.ts 钉（XMON-109）。
      const upload = await req(s.app, 'POST', '/api/skills', {
        name: 'x',
        files: { 'SKILL.md': '# x' },
      });
      expect(upload.status).toBe(400);
      const scan = await req(s.app, 'POST', '/api/skills/scan', { repo: 'owner/repo' });
      expect(scan.status).toBe(404);
    } finally {
      s.dispose();
    }
  });

  test('R7/R8：detail = record + fileNames（嵌套相对路径）；file = 内容、缺省 SKILL.md', async () => {
    const { s, skillsDir } = setup();
    try {
      const dir = addSkill(skillsDir, 'deploy', { name: 'deployer', description: '部署' });
      mkdirSync(join(dir, 'scripts'));
      writeFileSync(join(dir, 'scripts', 'run.sh'), 'echo hi');
      writeFileSync(join(dir, 'helper.sh'), 'echo helper');

      const one = await req(s.app, 'GET', `/api/teams/${s.team.id}/skills/deployer`);
      expect(one.status).toBe(200);
      const detail = (await one.json()) as Record<string, unknown>;
      expect(skillRecordSchema.safeParse(detail).success).toBe(true);
      expect((detail.fileNames as string[]).sort()).toEqual([
        'SKILL.md',
        'helper.sh',
        'scripts/run.sh',
      ]);

      const file = await req(
        s.app,
        'GET',
        `/api/teams/${s.team.id}/skills/deployer/file?fileName=scripts/run.sh`,
      );
      expect(await file.json()).toEqual({ fileName: 'scripts/run.sh', content: 'echo hi' });
      // 缺省 fileName = SKILL.md
      const entry = await req(s.app, 'GET', `/api/teams/${s.team.id}/skills/deployer/file`);
      const entryBody = (await entry.json()) as { fileName: string; content: string };
      expect(entryBody.fileName).toBe('SKILL.md');
      expect(entryBody.content).toContain('# deploy');
    } finally {
      s.dispose();
    }
  });

  test('R9/R10/R11：未知 sid、未知 file、路径逃逸一律 404（不泄露存在性、不出目录）', async () => {
    const { s, skillsDir } = setup();
    try {
      addSkill(skillsDir, 'deploy', { name: 'deploy' });
      const base = `/api/teams/${s.team.id}/skills`;
      expect((await req(s.app, 'GET', `${base}/nope`)).status).toBe(404); // R9
      expect((await req(s.app, 'GET', `${base}/deploy/file?fileName=nope.md`)).status).toBe(404); // R10
      // R11 sid 逃逸（编码斜杠/上跳）与 fileName 逃逸
      expect((await req(s.app, 'GET', `${base}/..%2F..%2Fetc`)).status).toBe(404);
      expect((await req(s.app, 'GET', `${base}/....`)).status).toBe(404);
      const escaped = await req(
        s.app,
        'GET',
        `${base}/deploy/file?fileName=..%2F..%2F..%2Fetc%2Fpasswd`,
      );
      expect(escaped.status).toBe(404);
      const absolute = await req(s.app, 'GET', `${base}/deploy/file?fileName=%2Fetc%2Fpasswd`);
      expect(absolute.status).toBe(404);
    } finally {
      s.dispose();
    }
  });

  test('R12：超大文件（>512KB）= 400 点名上限', async () => {
    const { s, skillsDir } = setup();
    try {
      const dir = addSkill(skillsDir, 'big', { name: 'big' });
      writeFileSync(join(dir, 'blob.bin'), Buffer.alloc(600_000, 1));
      const res = await req(
        s.app,
        'GET',
        `/api/teams/${s.team.id}/skills/big/file?fileName=blob.bin`,
      );
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toContain('512000');
    } finally {
      s.dispose();
    }
  });

  test('R13：文件级符号链接指向技能目录外 = 404（链接逃逸，与清单面同律）', async () => {
    const { s, skillsDir } = setup();
    const outside = makeRoot();
    try {
      const dir = addSkill(skillsDir, 'linked', { name: 'linked' });
      const secret = join(outside, 'secret.txt');
      writeFileSync(secret, '目录外内容');
      symlinkSync(secret, join(dir, 'leak.txt')); // 链接逃逸
      symlinkSync(join(dir, 'SKILL.md'), join(dir, 'inner-link.md')); // 目录内链接 = 受理
      const base = `/api/teams/${s.team.id}/skills/linked/file`;
      const leak = await req(s.app, 'GET', `${base}?fileName=leak.txt`);
      expect(leak.status).toBe(404);
      // 清单面同律：逃逸链接不入 fileNames
      const detail = (await (
        await req(s.app, 'GET', `/api/teams/${s.team.id}/skills/linked`)
      ).json()) as { fileNames: string[] };
      expect(detail.fileNames).not.toContain('leak.txt');
      // 目录内符号链接仍可读（解析后未出边界）
      const inner = await req(s.app, 'GET', `${base}?fileName=inner-link.md`);
      expect(inner.status).toBe(200);
    } finally {
      s.dispose();
    }
  });
});

// —— A agent 面（skills[] 校验 = 现扫存在性，未知 id 静默跳过）———————————————————

describe('agent.skillsAllowlist / defaultSkill 现扫校验（#1169 拆字段）', () => {
  // 失败方式（先于实现固化）：
  // A1 POST 携未知 id 未滤除 → 死引用入库（现扫存在性同 filterKnownSkillIds 律）。
  // A2 显式 null（不限制）被读成全拒 / 或被「缺省不动」吞掉 → UI 的「不限制」
  //    开关写不回库（undefined = 不动 与 null = 清空 的序列化坑，两键必须
  //    各自成槽——PATCH 不带 = 不动，带 null = 清成不限制）。
  // A3 defaultSkill 单值进了数组位 / 或数组进了单值位 → 携带与授权两概念
  //    又焊回一个槽（本票拆的就是这个）。
  // A4 非空白名单零回归：勾选子集原样（过滤只作用于未知 id，不重排不丢项）。

  function setup() {
    const skillsDir = makeRoot();
    addSkill(skillsDir, 'deploy', { name: 'deploy' });
    addSkill(skillsDir, 'review', { name: 'review' });
    const s = bootServer({ skillsDir });
    return { s, skillsDir };
  }

  async function createAgent(
    s: TestServer,
    body: Record<string, unknown>,
  ): Promise<{ id: string; row: Record<string, unknown> }> {
    const res = await req(s.app, 'POST', `/api/teams/${s.team.id}/agents`, {
      displayName: 'a1',
      machineId: insertMachine(s),
      ...body,
    });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    const got = await req(s.app, `GET`, `/api/teams/${s.team.id}/agents/${id}`);
    const row = (await got.json()) as Record<string, unknown>;
    return { id, row };
  }

  test('A1：POST skillsAllowlist 携未知 id = 静默滤除；缺省 = null（不限制，不再是 []）', async () => {
    const { s } = setup();
    try {
      expect((await createAgent(s, { skillsAllowlist: ['deploy', 'ghost'] })).row).toMatchObject({
        skillsAllowlist: ['deploy'],
        defaultSkill: null,
      });
      // 创建缺省（两字段都不带）= null/null：出生即不限制（#1169 主修位）。
      expect((await createAgent(s, {})).row).toMatchObject({
        skillsAllowlist: null,
        defaultSkill: null,
      });
    } finally {
      s.dispose();
    }
  });

  test('A2：PATCH 带 null = 显式清成不限制；不带字段 = 列不动（undefined 与 null 两态不得塌缩）', async () => {
    const { s } = setup();
    try {
      const { id, row } = await createAgent(s, { skillsAllowlist: ['deploy'] });
      expect(row).toMatchObject({ skillsAllowlist: ['deploy'] });
      // 显式 null → 清成不限制（UI「不限制」开关的写回路径）。
      const cleared = await req(s.app, 'PATCH', `/api/teams/${s.team.id}/agents/${id}`, {
        skillsAllowlist: null,
      });
      expect(cleared.status).toBe(200);
      expect(((await cleared.json()) as Record<string, unknown>).skillsAllowlist).toBeNull();
      // 不带字段 = 不动（undefined ≠ null：序列化只发显式 null）。
      const untouched = await req(s.app, 'PATCH', `/api/teams/${s.team.id}/agents/${id}`, {
        displayName: 'renamed',
      });
      expect(((await untouched.json()) as Record<string, unknown>).skillsAllowlist).toBeNull();
      // 从 null 再勾回子集（两态互转）。
      const restricted = await req(s.app, 'PATCH', `/api/teams/${s.team.id}/agents/${id}`, {
        skillsAllowlist: ['review'],
      });
      expect(((await restricted.json()) as Record<string, unknown>).skillsAllowlist).toEqual([
        'review',
      ]);
    } finally {
      s.dispose();
    }
  });

  test('A3：defaultSkill 单值槽——string/null 过，数组（含单元素）拒；未知 id 滤成 null', async () => {
    const { s } = setup();
    try {
      const set = await createAgent(s, { defaultSkill: 'deploy' });
      expect(set.row).toMatchObject({ defaultSkill: 'deploy', skillsAllowlist: null });
      const unknown = await createAgent(s, { defaultSkill: 'ghost' });
      expect(unknown.row).toMatchObject({ defaultSkill: null });
      const cleared = await req(s.app, 'PATCH', `/api/teams/${s.team.id}/agents/${unknown.id}`, {
        defaultSkill: 'review',
      });
      expect(((await cleared.json()) as Record<string, unknown>).defaultSkill).toBe('review');
      const nullBack = await req(s.app, 'PATCH', `/api/teams/${s.team.id}/agents/${unknown.id}`, {
        defaultSkill: null,
      });
      expect(((await nullBack.json()) as Record<string, unknown>).defaultSkill).toBeNull();
      // 数组（含单元素）进单值槽 = 400（不是静默取 [0]）。
      const arr = await req(s.app, 'POST', `/api/teams/${s.team.id}/agents`, {
        displayName: 'arr',
        machineId: insertMachine(s),
        defaultSkill: ['deploy'],
      });
      expect(arr.status).toBe(400);
    } finally {
      s.dispose();
    }
  });

  test('A4：非空白名单零回归——勾选子集原样（过滤只吃未知 id，不重排不丢项）', async () => {
    const { s, skillsDir } = setup();
    try {
      const { id } = await createAgent(s, { skillsAllowlist: ['review', 'deploy'] });
      // 目录删除 → PATCH 携带死引用 = 静默滤除（既有 A3 容忍律）。
      rmSync(join(skillsDir, 'deploy'), { recursive: true, force: true });
      const patched = await req(s.app, 'PATCH', `/api/teams/${s.team.id}/agents/${id}`, {
        skillsAllowlist: ['deploy', 'review', 'ghost'],
      });
      expect(((await patched.json()) as Record<string, unknown>).skillsAllowlist).toEqual([
        'review',
      ]);
    } finally {
      s.dispose();
    }
  });
});

// —— C chief 面（skills 读面换源；delete_skills 除名）—————————————————————————

describe('chief 工具面（现扫换源 + delete_skills 除名）', () => {
  function setup() {
    const skillsDir = makeRoot();
    addSkill(skillsDir, 'deploy', { name: 'deploy', description: '部署流程' });
    const s = bootServer({ skillsDir });
    const ctx: ChiefToolCtx = {
      teamId: s.team.id,
      userId: s.user.id,
      chiefId: 'chief-x',
      threadId: 'chief-thread-x',
      chiefAgentId: null,
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

  test('C1：relay skills = 现扫投影（id/name/description）', async () => {
    const { s, deps, ctx } = setup();
    try {
      const text = await executeChiefTool(deps, ctx, 'skills', {});
      expect(JSON.parse(text)).toEqual([{ id: 'deploy', name: 'deploy', description: '部署流程' }]);
    } finally {
      s.dispose();
    }
  });

  test('C2：relay delete_skills = 400 unknown chief tool（词表已除名）', async () => {
    const { s, deps, ctx } = setup();
    try {
      await expect(
        executeChiefTool(deps, ctx, 'delete_skills', { skillIds: ['deploy'] }),
      ).rejects.toThrowError(/unknown chief tool/);
    } finally {
      s.dispose();
    }
  });

  test('C3：composeChiefSystemPrompt 资源清单含现扫技能', () => {
    const { s, skillsDir } = setup();
    try {
      const prompt = composeChiefSystemPrompt(
        { db: s.db, hub: s.hub, machineHub: s.machineHub, user: s.user, skillsDir },
        s.team.id,
      );
      expect(prompt).toContain('skills:');
      expect(prompt).toContain('"id":"deploy"');
    } finally {
      s.dispose();
    }
  });
});

// —— M mcp-face（skills 工具换源）———————————————————————————————————————————————

describe('mcp-face skills 工具（现扫换源）', () => {
  test('M1：executeMcpTool skills = 现扫投影', async () => {
    const skillsDir = makeRoot();
    addSkill(skillsDir, 'deploy', { name: 'deploy', description: '部署流程' });
    const s = bootServer({ skillsDir });
    try {
      const text = await executeMcpTool(
        {
          db: s.db,
          hub: s.hub,
          machineHub: s.machineHub,
          box: s.secretBox,
          user: s.user,
          reposDir: s.reposDir,
          attachmentsDir: s.attachmentsDir,
          skillsDir,
        },
        { teamId: s.team.id, user: s.user, grants: new Set(['Skills']) },
        'skills',
        {},
      );
      expect(JSON.parse(text)).toEqual([{ id: 'deploy', name: 'deploy', description: '部署流程' }]);
    } finally {
      s.dispose();
    }
  });
});

// —— 附：读面回归钉（detail 端点旧 m5-face 语义在新源下保持）————————————————————

describe('skills 读面 wire 形状回归', () => {
  test('GET /api/skills 响应逐条过 skillRecordSchema；文件内容原样往返', async () => {
    const skillsDir = makeRoot();
    const dir = addSkill(skillsDir, 'roundtrip', { name: 'roundtrip' });
    writeFileSync(join(dir, 'note.txt'), '往返内容');
    const s = bootServer({ skillsDir });
    try {
      const list = (await (
        await req(s.app, 'GET', `/api/skills?teamId=${s.team.id}`)
      ).json()) as unknown[];
      for (const row of list) expect(skillRecordSchema.safeParse(row).success).toBe(true);
      const file = await req(
        s.app,
        'GET',
        `/api/teams/${s.team.id}/skills/roundtrip/file?fileName=note.txt`,
      );
      expect((await file.json()) as { content: string }).toEqual({
        fileName: 'note.txt',
        content: readFileSync(join(dir, 'note.txt'), 'utf8'),
      });
    } finally {
      s.dispose();
    }
  });
});
