import { MERGE_HUMAN_ONLY_COPY } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { build as buildTable, step as stepTable, todo as todoTable } from '../src/db/schema.js';
import { AGENT_ID, H, ownerTodo, registerChiefHarness, relay } from './chief-harness.js';
import { req } from './helpers.js';

registerChiefHarness();

describe('create_todo provenance', () => {
  test('create_todo lands the owner words verbatim + provenance createdBy/sourceBuildId/ownerId', async () => {
    const created = (await relay(
      'create_todo',
      ownerTodo('帮 demo 写一份 CONTRIBUTING.md 贡献指南'),
    )) as {
      id: string;
      createdBy: string | null;
      ownerId: string | null;
      sourceBuildId: string | null;
      spec: string;
    };
    expect(created.spec).toBe('帮 demo 写一份 CONTRIBUTING.md 贡献指南');
    expect(created.createdBy).toBe(AGENT_ID);
    expect(created.ownerId).toBe(H.userId);
    expect(created.sourceBuildId).toBe(H.chiefId);
    const row = H.s.db.select().from(todoTable).where(eq(todoTable.id, created.id)).get()!;
    expect(row.sourceBuildId).toBe(H.chiefId);
    expect(row.createdBy).toBe(AGENT_ID);
  });
});

describe('open_thread dispatch', () => {
  test('create_todo starts one session step triggered by the chief and queues the todo (#903, task stall class 3)', async () => {
    const out = (await relay('create_todo', ownerTodo('写文档'))) as {
      id: string;
      buildId: string;
    };
    const todoRec = { id: out.id };
    const row = H.s.db.select().from(todoTable).where(eq(todoTable.id, todoRec.id)).get()!;
    expect(row.phase).toBe('queued');
    expect(row.latestBuildId).toBe(out.buildId);
    const build = H.s.db.select().from(buildTable).where(eq(buildTable.id, out.buildId)).get()!;
    expect(build).toMatchObject({ withPlan: false, triggerSource: 'chief' });
    const steps = H.s.db.select().from(stepTable).where(eq(stepTable.buildId, out.buildId)).all();
    expect(steps.map((r) => r.kind)).toEqual(['session']);
  });
});

describe('Coordinator platform need', () => {
  test('create_todo with a platform stores it on the task, and update_todo any clears it', async () => {
    const created = (await relay('create_todo', {
      ...ownerTodo('打包 iOS 版本'),
      platform: 'macos',
    })) as { id: string };
    const overrideOf = () =>
      H.s.db.select().from(todoTable).where(eq(todoTable.id, created.id)).get()?.routeOverride ??
      null;
    expect(overrideOf()).toEqual({ requiredCapabilities: { os: 'macos' } });
    await relay('update_todo', { todoId: created.id, platform: 'any' });
    expect(overrideOf()).toBeNull();
  });

  test('update_todo whose title is refused leaves the platform unchanged', async () => {
    const res = await req(H.s.app, 'POST', `/api/projects/${H.projectId}/todos`, {
      title: 'board task',
      spec: 's',
    });
    const { id } = (await res.json()) as { id: string };
    await expect(
      relay('update_todo', { todoId: id, title: '打包 iOS 版本', platform: 'macos' }),
    ).rejects.toThrow(/no cited request/);
    expect(
      H.s.db.select().from(todoTable).where(eq(todoTable.id, id)).get()?.routeOverride ?? null,
    ).toBeNull();
  });
});

describe('merge_builds machine entry hard-refused (#1256)', () => {
  test('chief calls merge_builds -> refusal JSON, text names the human exit, no merge step landed', async () => {
    const todoRec = (await relay('create_todo', ownerTodo('合并只由人触发'))) as { id: string };
    const now = Date.now();
    H.s.db
      .insert(buildTable)
      .values({
        id: 'build-merge-reject',
        todoId: todoRec.id,
        withPlan: false,
        triggerSource: 'user',
        createdAt: now,
      })
      .run();
    H.s.db
      .update(todoTable)
      .set({ phase: 'review', phaseAt: now })
      .where(eq(todoTable.id, todoRec.id))
      .run();

    const out = (await relay('merge_builds', { buildIds: ['build-merge-reject'] })) as {
      rejected: boolean;
      buildIds: string[];
      reason: string;
    };
    expect(out.rejected).toBe(true);
    expect(out.buildIds).toEqual(['build-merge-reject']);
    expect(out.reason).toBe(MERGE_HUMAN_ONLY_COPY);
    expect(out.reason).toContain('完成');
    const steps = H.s.db
      .select()
      .from(stepTable)
      .where(eq(stepTable.buildId, 'build-merge-reject'))
      .all();
    expect(steps).toHaveLength(0);
  });
});

test.each(['Please implement this', '[wake:gate] provenance=test\nReview task'])(
  'records the requesting actor from the coordinator turn: %s',
  async (turnPrompt) => {
    const created = (await relay('create_todo', ownerTodo('Requested task'), { turnPrompt })) as {
      createdBy: string | null;
    };
    expect(created.createdBy).toBe(turnPrompt.startsWith('[wake:') ? AGENT_ID : H.userId);
  },
);
