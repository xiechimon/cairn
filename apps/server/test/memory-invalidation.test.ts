import { and, eq } from 'drizzle-orm';
import { afterEach, describe, expect, test } from 'vitest';
import { agentMemory } from '../src/db/schema.js';
import { newRecordId, nowMs } from '../src/lib/ids.js';
import { composeChiefSystemPrompt } from '../src/services/chief.js';
import { executeWorkerMemoryTool } from '../src/services/chief-tools.js';
import { memoryDocumentVersion } from '../src/services/memory-documents.js';
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

function rowOf(id: string) {
  return H.s.db.select().from(agentMemory).where(eq(agentMemory.id, id)).get()!;
}

async function invokeDocument(
  mode: 'chief' | 'worker',
  name: string,
  params: Record<string, unknown> = {},
) {
  const stored = typeof params.memoryId === 'string' ? rowOf(params.memoryId) : undefined;
  const input =
    name === 'memories'
      ? { scope: 'team' }
      : stored
        ? {
            scope: 'team',
            file: stored.title,
            baseVersion: memoryDocumentVersion(stored),
            ...(name === 'update_memory' ? { content: params.content } : {}),
          }
        : { scope: 'team', file: params.title, content: params.content };
  const raw =
    mode === 'chief'
      ? await relay(name, input)
      : (JSON.parse(
          await executeWorkerMemoryTool(
            H.s.db,
            {
              teamId: H.teamId,
              agentId: AGENT_ID,
              sourceName: null,
              todoId: 'source',
              projectId: H.projectId,
              buildId: 'build',
              attachmentsDir: H.s.attachmentsDir,
            },
            name,
            input,
          ),
        ) as unknown);
  if (name === 'memories')
    return H.s.db
      .select()
      .from(agentMemory)
      .all()
      .filter(
        (r) => r.layer === 'searchable' && (params.includeInvalid === true || r.invalidAt === null),
      );
  return rowOf((raw as { id: string }).id);
}
for (const mode of ['chief', 'worker'] as const) {
  const invoke = (name: string, params: Record<string, unknown> = {}) =>
    invokeDocument(mode, name, params);

  describe(`${mode} memory invalidation`, () => {
    test('update_memory invalidates the old entry and points at the new one, memories defaults to only valid entries', async () => {
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

    test('an already-replaced entry cannot be updated again, the replacement chain does not return to itself', async () => {
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
      expect(
        rows
          .filter((row) => row.invalidAt === null && !row.id.startsWith('memory-index:'))
          .map((row) => row.id),
      ).toEqual([third.id]);
    });

    test('changing the body back to an already-invalidated old body is legal', async () => {
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

describe('memory read-surface semantics consistent', () => {
  const listUrl = () => `/api/teams/${H.teamId}/memories`;

  test('REST list defaults to only valid entries (the UI memory n/100 numerator), includeInvalid includes history', async () => {
    const old = (await invokeDocument('chief', 'save_memory', {
      title: '约定',
      content: '版本一',
    })) as Entry;
    const next = (await invokeDocument('chief', 'update_memory', {
      memoryId: old.id,
      content: '版本二',
    })) as Entry;

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

  test('chief system prompt only injects valid entries and records the injection time', () => {
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
    expect(rowOf(rowOf(live).supersededBy!).lastInjectedAt).toEqual(expect.any(Number));
    expect(rowOf(live).lastInjectedAt).toBeNull();
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

test('tombstone revisions include scope even when timestamps tie', async () => {
  const id = insertMemory({
    title: 'reused.md',
    layer: 'searchable',
    createdAt: 1,
    updatedAt: 2,
    invalidAt: 2,
  });
  const observed = (await relay('memories', { scope: 'team', file: 'reused.md' })) as {
    id: string;
    baseVersion: string;
  };
  expect(observed.id).toBe(id);
  H.s.db
    .update(agentMemory)
    .set({ projectId: H.projectId })
    .where(eq(agentMemory.title, 'reused.md'))
    .run();
  expect(await relay('memories', { scope: H.projectId, file: 'reused.md' })).not.toMatchObject({
    baseVersion: observed.baseVersion,
  });
});
