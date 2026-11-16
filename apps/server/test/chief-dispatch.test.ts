import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { build as buildTable, step as stepTable, todo as todoTable } from '../src/db/schema.js';
import { AGENT_ID, H, ownerTodo, registerChiefHarness, relay } from './chief-harness.js';
import { postProject, req } from './helpers.js';

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

describe('merge_builds follows explicit user requests', () => {
  test('a completed hosted delivery stays done while its merge is queued exactly once', async () => {
    const projectId = await postProject(H.s.app, 'hosted-delivery', { repoKind: 'hosted' });
    const delivered = (await relay('create_todo', ownerTodo('交付代码', projectId))) as {
      id: string;
      buildId: string;
    };
    H.s.db.update(todoTable).set({ phase: 'done' }).where(eq(todoTable.id, delivered.id)).run();
    H.s.db
      .update(stepTable)
      .set({ status: 'done', checkpointCommit: 'a'.repeat(40) })
      .where(eq(stepTable.buildId, delivered.buildId))
      .run();
    const params = { buildIds: [delivered.buildId] };
    await expect(
      relay('merge_builds', params, {
        turnPrompt: '[wake:settle] provenance=watch:test\nTask completed',
      }),
    ).rejects.toThrow('events cannot merge');
    expect(await relay('merge_builds', params, { turnPrompt: 'Merge this delivery' })).toEqual({
      merged: [delivered.buildId],
    });
    expect(H.s.db.select().from(todoTable).where(eq(todoTable.id, delivered.id)).get()?.phase).toBe(
      'done',
    );
    await expect(
      relay('merge_builds', params, { turnPrompt: 'Merge this delivery' }),
    ).rejects.toThrow('合并步');
    expect(
      H.s.db
        .select()
        .from(stepTable)
        .where(eq(stepTable.buildId, delivered.buildId))
        .all()
        .filter((row) => row.kind === 'merge'),
    ).toHaveLength(1);
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
