import { MEMORY_QUOTA_PER_AGENT } from '@cairn/shared';
import { and, eq } from 'drizzle-orm';
import { afterEach, describe, expect, test } from 'vitest';
import { agentMemory } from '../src/db/schema.js';
import { newRecordId, nowMs } from '../src/lib/ids.js';
import { composeChiefSystemPrompt } from '../src/services/chief.js';
import { executeWorkerMemoryTool } from '../src/services/chief-tools.js';
import { AGENT_ID, H, registerChiefHarness, relay } from './chief-harness.js';
import { req } from './helpers.js';

registerChiefHarness();
afterEach(() => H.s.dispose());

type Entry = {
  id: string;
  content: string;
  invalidAt: number | null;
  supersededBy: string | null;
  lastInjectedAt: number | null;
  history: { content: string }[];
};

function insertMemory(over: Partial<typeof agentMemory.$inferInsert> = {}): string {
  const id = newRecordId();
  const now = nowMs();
  H.s.db
    .insert(agentMemory)
    .values({
      id,
      agentId: AGENT_ID,
      teamId: H.teamId,
      title: `t-${id}`,
      content: `c-${id}`,
      projectId: null,
      sourceTodoId: null,
      sourceBuildId: null,
      createdAt: now,
      updatedAt: now,
      ...over,
    })
    .run();
  return id;
}

function rowOf(id: string): Entry {
  return H.s.db.select().from(agentMemory).where(eq(agentMemory.id, id)).get() as Entry;
}

for (const mode of ['chief', 'worker'] as const) {
  const invoke = async (name: string, params: Record<string, unknown> = {}) => {
    if (mode === 'chief') return relay(name, params);
    return JSON.parse(
      await executeWorkerMemoryTool(
        H.s.db,
        {
          teamId: H.teamId,
          agentId: AGENT_ID,
          todoId: 'source',
          projectId: H.projectId,
          buildId: 'build',
          attachmentsDir: H.s.attachmentsDir,
        },
        name,
        params,
      ),
    ) as unknown;
  };

  describe(`${mode} memory invalidation`, () => {
    test('update_memory 把旧条目置失效并指向新条目，memories 默认只返回有效条目', async () => {
      const old = (await invoke('save_memory', {
        title: '包管理器',
        content: '使用 npm',
      })) as Entry;
      const next = (await invoke('update_memory', {
        memoryId: old.id,
        content: '使用 pnpm',
      })) as Entry;

      expect(next.id).not.toBe(old.id);
      expect(next).toMatchObject({
        content: '使用 pnpm',
        invalidAt: null,
        supersededBy: null,
        history: [{ content: '使用 npm' }],
      });
      expect(rowOf(old.id)).toMatchObject({
        content: '使用 npm',
        supersededBy: next.id,
        invalidAt: expect.any(Number),
      });

      const current = (await invoke('memories')) as Entry[];
      expect(current.map((row) => row.id)).toEqual([next.id]);
      const everything = (await invoke('memories', { includeInvalid: true })) as Entry[];
      expect(everything.map((row) => row.id).sort()).toEqual([old.id, next.id].sort());
    });

    test('已被取代的条目不能再更新，取代链不会回到自身', async () => {
      const first = (await invoke('save_memory', { title: '约定', content: '版本一' })) as Entry;
      const second = (await invoke('update_memory', {
        memoryId: first.id,
        content: '版本二',
      })) as Entry;
      const rejected = invoke('update_memory', { memoryId: first.id, content: '版本三' });
      await expect(rejected).rejects.toMatchObject({ status: 409 });
      await expect(rejected).rejects.toThrow(second.id);

      const third = (await invoke('update_memory', {
        memoryId: second.id,
        content: '版本三',
      })) as Entry;
      const rows = H.s.db.select().from(agentMemory).all() as Entry[];
      const successor = new Map(rows.map((row) => [row.id, row.supersededBy]));
      expect(successor.get(first.id)).toBe(second.id);
      expect(successor.get(second.id)).toBe(third.id);
      expect(successor.get(third.id)).toBeNull();
      expect(rows.filter((row) => row.invalidAt === null).map((row) => row.id)).toEqual([third.id]);
    });

    test('失效条目不占配额，也不挡住与它相同正文的新写入', async () => {
      const retired = Array.from({ length: 3 }, () => insertMemory({ invalidAt: nowMs() }));
      for (let i = 0; i < MEMORY_QUOTA_PER_AGENT - 1; i++) insertMemory();
      expect(
        await invoke('save_memory', { title: '第一百条', content: '最后一个有效名额' }),
      ).toMatchObject({ content: '最后一个有效名额' });
      await expect(
        invoke('save_memory', { title: '第一百零一条', content: '超出' }),
      ).rejects.toMatchObject({ status: 409 });

      const reused = rowOf(retired[0] as string).content;
      const all = H.s.db.select().from(agentMemory).all();
      expect(all.length).toBeGreaterThan(MEMORY_QUOTA_PER_AGENT);
      const valid = (await invoke('memories')) as Entry[];
      expect(valid).toHaveLength(MEMORY_QUOTA_PER_AGENT);

      const victim = valid.find((row) => row.content !== reused) as Entry;
      await invoke('delete_memory', { memoryId: victim.id });
      expect(await invoke('save_memory', { title: '复用', content: reused })).toMatchObject({
        content: reused,
        invalidAt: null,
      });
    });

    test('配额写满时 update_memory 仍可用：旧条目失效、新条目补位', async () => {
      const first = (await invoke('save_memory', { title: '约定', content: '版本一' })) as Entry;
      for (let i = 0; i < MEMORY_QUOTA_PER_AGENT - 1; i++) insertMemory();
      const next = (await invoke('update_memory', {
        memoryId: first.id,
        content: '版本二',
      })) as Entry;
      expect(next.invalidAt).toBeNull();
      expect(await invoke('memories')).toHaveLength(MEMORY_QUOTA_PER_AGENT);
    });

    test('把正文改回已失效条目的旧正文是合法的', async () => {
      const first = (await invoke('save_memory', { title: '约定', content: '版本一' })) as Entry;
      const second = (await invoke('update_memory', {
        memoryId: first.id,
        content: '版本二',
      })) as Entry;
      expect(
        await invoke('update_memory', { memoryId: second.id, content: '版本一' }),
      ).toMatchObject({ content: '版本一', invalidAt: null });
    });
  });
}

describe('记忆读面口径一致', () => {
  const listUrl = () => `/api/teams/${H.teamId}/agents/${AGENT_ID}/memories`;

  test('REST 列表默认只含有效条目（UI 记忆 · n / 100 的分子），includeInvalid 才含历史', async () => {
    const old = (await relay('save_memory', { title: '约定', content: '版本一' })) as Entry;
    const next = (await relay('update_memory', { memoryId: old.id, content: '版本二' })) as Entry;

    const current = (await (await req(H.s.app, 'GET', listUrl())).json()) as Entry[];
    expect(current.map((row) => row.id)).toEqual([next.id]);

    const all = (await (
      await req(H.s.app, 'GET', `${listUrl()}?includeInvalid=true`)
    ).json()) as Entry[];
    expect(all.map((row) => row.id).sort()).toEqual([old.id, next.id].sort());
    expect(all.find((row) => row.id === old.id)).toMatchObject({
      supersededBy: next.id,
      invalidAt: expect.any(Number),
    });
  });

  test('chief 系统提示只注入有效条目，并记下注入时刻', () => {
    const live = insertMemory({ title: '有效', content: '这条在用' });
    const retired = insertMemory({ title: '作废', content: '这条已被推翻', invalidAt: nowMs() });

    const prompt = composeChiefSystemPrompt(
      {
        db: H.s.db,
        hub: H.s.hub,
        machineHub: H.s.machineHub,
        user: H.s.user,
        skillsDir: H.s.skillsDir,
      },
      H.teamId,
    );

    expect(prompt).toContain('这条在用');
    expect(prompt).not.toContain('这条已被推翻');
    expect(rowOf(live).lastInjectedAt).toEqual(expect.any(Number));
    expect(rowOf(retired).lastInjectedAt).toBeNull();
    expect(
      H.s.db
        .select()
        .from(agentMemory)
        .where(and(eq(agentMemory.id, live), eq(agentMemory.agentId, AGENT_ID)))
        .all(),
    ).toHaveLength(1);
  });
});
