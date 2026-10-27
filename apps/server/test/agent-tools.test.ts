import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { agent as agentTable } from '../src/db/schema.js';
import { bootServer, insertMachine, req } from './helpers.js';

const AGENT_ID = 'agent-tools-1';

describe('Agent tools write-side filtering (XMON-77)', () => {
  test('POST: out-of-vocabulary values (self-made entry and retired remote shell) silently dropped, remaining switches kept in order', async () => {
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
      '创建标签',
      '更新技能',
    ]);
    s.dispose();
  });

  test('POST: default -> default set [push branch] (XMON-84 B4: delivery not broken)', async () => {
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

  test('POST: explicit all-off (tools:[]) not overwritten by the default set (explicit != default)', async () => {
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

  test('PATCH: read-modify-write carrying out-of-vocabulary values -> residual values cleared on write (legacy row self-healing path)', async () => {
    const s = bootServer();
    s.db
      .insert(agentTable)
      .values({ id: AGENT_ID, teamId: s.team.id, displayName: '存量行', modelId: 'm' })
      .run();
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

  test('PATCH: tools absent -> granted set unchanged (undefined != cleared)', async () => {
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

  test('PATCH: clearing (tools: []) is an explicit all-off', async () => {
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
