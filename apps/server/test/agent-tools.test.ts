// Agent 权限开关写侧过滤与创建默认集（XMON-77 闸 + XMON-84 B4 默认值）。词表 =
// shared AGENT_TOOL_SWITCHES 六档（XMON-84 用户拍板 B 恢复；两执法档 = 合并
// 分支/推送分支，四无本体档照常持久化）；写侧 = filterAgentTools 静默丢弃词表
// 外值（filterKnownSkillIds 同律，非 machines enabledRuntimes 的 enum-400 律）。
//
// 为什么是过滤不是 400：UI 是读改写全量（agent-detail toggleTool 读 agent.tools
// → 翻转 → PATCH 全数组）。存量行若带着词表外值，enum 律会让每次保存 400、
// 用户被死值锁死；过滤律把残值随下一次写自然清退。
//
// 失败方式（先于实现固化）：
// 1. POST 不带 tools → 默认集未落（新建即推不了工作分支，B4 不破坏交付判据）。
// 2. POST 显式 tools:[]（全关）→ 被默认集覆写（显式关 ≠ 缺省）。
// 3. POST 带词表外值（自造档）→ 残值原样落库 → 永不消费的死存储 + UI 死开关。
// 4. 过滤误伤词表内值（把恢复的四档也丢掉）→ 授权面静默失能。
// 5. PATCH 不带 tools 字段 → 误清空已授权集（undefined = 不动该列）。

import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { agent as agentTable } from '../src/db/schema.js';
import { bootServer, insertMachine, req } from './helpers.js';

const AGENT_ID = 'agent-tools-1';

describe('Agent tools 写侧过滤（XMON-77）', () => {
  test('POST：词表外值（自造档）静默丢弃，词表内六档全保留 + 顺序不变', async () => {
    const s = bootServer();
    const create = await req(s.app, 'POST', `/api/teams/${s.team.id}/agents`, {
      displayName: '权限探针',
      machineId: insertMachine(s),
      tools: ['推送分支', '远程 shell', '创建标签', '自造档', '更新技能'],
    });
    expect(create.status).toBe(201);
    const id = ((await create.json()) as { id: string }).id;
    expect(s.db.select().from(agentTable).where(eq(agentTable.id, id)).get()!.tools).toEqual([
      '推送分支',
      '远程 shell',
      '创建标签',
      '更新技能',
    ]);
    s.dispose();
  });

  test('POST：缺省 → 默认集 [推送分支]（XMON-84 B4：不破坏交付）', async () => {
    const s = bootServer();
    const create = await req(s.app, 'POST', `/api/teams/${s.team.id}/agents`, {
      displayName: '默认探针',
      machineId: insertMachine(s),
    });
    expect(create.status).toBe(201);
    const id = ((await create.json()) as { id: string }).id;
    expect(s.db.select().from(agentTable).where(eq(agentTable.id, id)).get()!.tools).toEqual([
      '推送分支',
    ]);
    s.dispose();
  });

  test('POST：显式全关（tools:[]）不被默认集覆写（显式 ≠ 缺省）', async () => {
    const s = bootServer();
    const create = await req(s.app, 'POST', `/api/teams/${s.team.id}/agents`, {
      displayName: '全关探针',
      machineId: insertMachine(s),
      tools: [],
    });
    expect(create.status).toBe(201);
    const id = ((await create.json()) as { id: string }).id;
    expect(s.db.select().from(agentTable).where(eq(agentTable.id, id)).get()!.tools).toEqual([]);
    s.dispose();
  });

  test('PATCH：读改写全量带词表外值 → 残值随写清退（存量行自愈通道）', async () => {
    const s = bootServer();
    s.db
      .insert(agentTable)
      .values({ id: AGENT_ID, teamId: s.team.id, displayName: '存量行', modelId: 'm' })
      .run();
    // 直插词表外残值（自造/退役形态）。
    s.db
      .update(agentTable)
      .set({ tools: ['自造档', '创建技能'] })
      .where(eq(agentTable.id, AGENT_ID))
      .run();
    const patch = await req(s.app, 'PATCH', `/api/teams/${s.team.id}/agents/${AGENT_ID}`, {
      tools: ['自造档', '创建技能', '推送分支'],
    });
    expect(patch.status).toBe(200);
    expect(s.db.select().from(agentTable).where(eq(agentTable.id, AGENT_ID)).get()!.tools).toEqual([
      '创建技能',
      '推送分支',
    ]);
    s.dispose();
  });

  test('PATCH：tools 未携带 → 已授权集不动（undefined ≠ 清空）', async () => {
    const s = bootServer();
    s.db
      .insert(agentTable)
      .values({
        id: AGENT_ID,
        teamId: s.team.id,
        displayName: '授权行',
        modelId: 'm',
        tools: ['合并分支', '推送分支'],
      })
      .run();
    const patch = await req(s.app, 'PATCH', `/api/teams/${s.team.id}/agents/${AGENT_ID}`, {
      displayName: '改名不改权限',
    });
    expect(patch.status).toBe(200);
    expect(s.db.select().from(agentTable).where(eq(agentTable.id, AGENT_ID)).get()!.tools).toEqual([
      '合并分支',
      '推送分支',
    ]);
    s.dispose();
  });

  test('PATCH：清空（tools: []）显式全关', async () => {
    const s = bootServer();
    s.db
      .insert(agentTable)
      .values({
        id: AGENT_ID,
        teamId: s.team.id,
        displayName: '收回探针',
        modelId: 'm',
        tools: ['推送分支'],
      })
      .run();
    const patch = await req(s.app, 'PATCH', `/api/teams/${s.team.id}/agents/${AGENT_ID}`, {
      tools: [],
    });
    expect(patch.status).toBe(200);
    expect(s.db.select().from(agentTable).where(eq(agentTable.id, AGENT_ID)).get()!.tools).toEqual(
      [],
    );
    s.dispose();
  });
});
