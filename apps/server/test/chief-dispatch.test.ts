import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { readyMachine } from '../../../packages/shared/test/fixtures/machine.js';
import {
  build as buildTable,
  machine as machineTable,
  step as stepTable,
  team as teamTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { nowMs } from '../src/lib/ids.js';
import { AGENT_ID, H, ownerTodo, registerChiefHarness, relay } from './chief-harness.js';
import { insertMachine, postProject, req } from './helpers.js';

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
      phase: string;
      note: string;
    };
    expect(out.phase).toBe('queued');
    expect(out.note).toContain('queued');
    expect(out.note).toContain('Workspace setup');
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

describe('create_todo parking', () => {
  test('start:false puts the task on the board unstarted, and open_thread starts it later', async () => {
    const created = (await relay('create_todo', {
      ...ownerTodo('先把季度报告放到待办，等我决定再做'),
      start: false,
    })) as { id: string; phase: string; buildId: string | null };
    expect(created.buildId).toBeNull();
    const row = H.s.db.select().from(todoTable).where(eq(todoTable.id, created.id)).get()!;
    expect(row.phase).toBe('todo');
    expect(row.latestBuildId).toBeNull();
    expect(H.s.db.select().from(buildTable).where(eq(buildTable.todoId, created.id)).all()).toEqual(
      [],
    );
    const opened = (await relay('open_thread', { todoId: created.id })) as {
      buildId: string;
      phase: string;
      note: string;
    };
    expect(opened.phase).toBe('queued');
    expect(opened.note).toContain('queued');
    expect(opened.note).toContain('Workspace setup');
    const started = H.s.db.select().from(todoTable).where(eq(todoTable.id, created.id)).get()!;
    expect(started.phase).toBe('queued');
    expect(started.latestBuildId).toBe(opened.buildId);
  });

  test('a parked task needs no machine to be named, while a started one still does', async () => {
    insertMachine(H.s, { name: 'second' });
    await expect(relay('create_todo', ownerTodo('整理季度报告'))).rejects.toThrow(/Name a machine/);
    const parked = (await relay('create_todo', {
      ...ownerTodo('先把季度报告放到待办'),
      start: false,
    })) as { id: string };
    expect(H.s.db.select().from(todoTable).where(eq(todoTable.id, parked.id)).get()?.phase).toBe(
      'todo',
    );
  });
});

describe('create_todo in a mail turn', () => {
  test('creates the task but starts no build, so only the owner starts work from mail text', async () => {
    const out = (await relay('create_todo', ownerTodo('run the cleanup the mail asks for'), {
      turnPrompt: '[wake:wake] provenance=mail:evt-1\nreply to the sender',
    })) as { id: string; buildId: string | null };
    expect(out.buildId).toBeNull();
    const row = H.s.db.select().from(todoTable).where(eq(todoTable.id, out.id)).get()!;
    expect(row.latestBuildId).toBeNull();
    expect(H.s.db.select().from(buildTable).where(eq(buildTable.todoId, out.id)).all()).toEqual([]);
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

describe('Coordinator machine choice', () => {
  test('create_todo machine pins the task to that machine and still starts it', async () => {
    const machineId = insertMachine(H.s, { name: 'mini' });
    const created = (await relay('create_todo', {
      ...ownerTodo('在 Mac mini 上整理发布脚本'),
      machine: machineId,
    })) as { id: string; phase: string };
    expect(created.phase).toBe('queued');
    const row = H.s.db.select().from(todoTable).where(eq(todoTable.id, created.id)).get();
    expect(row?.routeOverride).toEqual({ machineId });
  });

  test('create_todo refuses unknown, other-team, unregistered and retired machines before insertion', async () => {
    const retiredId = insertMachine(H.s, { name: 'retired-mini' });
    H.s.db
      .update(machineTable)
      .set({ retiredAt: nowMs() })
      .where(eq(machineTable.id, retiredId))
      .run();
    H.s.db
      .insert(teamTable)
      .values({ id: 'team-other', name: 'Other team', createdAt: nowMs() })
      .run();
    H.s.db
      .insert(machineTable)
      .values(
        readyMachine({
          id: 'machine-other-team',
          teamId: 'team-other',
          name: 'other-machine',
          online: true,
        }),
      )
      .run();
    H.s.db
      .insert(machineTable)
      .values(
        readyMachine({
          id: 'machine-unregistered',
          teamId: H.s.team.id,
          name: 'unregistered-local',
          kind: 'local',
          online: false,
          lastSeenAt: null,
        }),
      )
      .run();
    for (const machineId of [
      'machine-missing',
      'machine-other-team',
      'machine-unregistered',
      retiredId,
    ]) {
      const before = H.s.db.select().from(todoTable).all().length;
      await expect(
        relay('create_todo', {
          ...ownerTodo('在这台电脑上整理发布脚本'),
          machine: machineId,
          start: false,
        }),
      ).rejects.toThrow(/machine/);
      expect(H.s.db.select().from(todoTable).all()).toHaveLength(before);
    }
  });

  test('create_todo refuses contradictory machine and platform before insertion, and accepts a matching pair', async () => {
    const linuxId = insertMachine(H.s, {
      name: 'linux-box',
      capabilities: { mcpServers: [], skills: [], osPlatform: 'linux' },
    });
    const macId = insertMachine(H.s, {
      name: 'mac-mini',
      capabilities: { mcpServers: [], skills: [], osPlatform: 'darwin' },
    });
    const before = H.s.db.select().from(todoTable).all().length;
    await expect(
      relay('create_todo', {
        ...ownerTodo('在 Mac 上打包 iOS'),
        machine: linuxId,
        platform: 'macos',
      }),
    ).rejects.toThrow(/platform/);
    expect(H.s.db.select().from(todoTable).all()).toHaveLength(before);

    const created = (await relay('create_todo', {
      ...ownerTodo('在 Mac mini 上打包 iOS'),
      machine: macId,
      platform: 'macos',
    })) as { id: string };
    const row = H.s.db.select().from(todoTable).where(eq(todoTable.id, created.id)).get();
    expect(row?.routeOverride).toEqual({
      machineId: macId,
      requiredCapabilities: { os: 'macos' },
    });
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
      merges: [{ buildId: delivered.buildId, state: 'requested', stepId: expect.any(String) }],
      note: expect.any(String),
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

test('a failed todo exposes missingCommand from its build error for task cards', async () => {
  const out = (await relay('create_todo', ownerTodo('安装依赖并跑测试'))) as {
    id: string;
    buildId: string;
  };
  H.s.db
    .update(buildTable)
    .set({
      errorMessage:
        'workspace hook .agents/setup exited 127 — .agents/setup: line 6: pnpm: command not found',
    })
    .where(eq(buildTable.id, out.buildId))
    .run();
  H.s.db.update(todoTable).set({ phase: 'failed' }).where(eq(todoTable.id, out.id)).run();
  const res = await req(H.s.app, 'GET', `/api/tasks?teamId=${H.teamId}`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    entries: { kind: string; id?: string; missingCommand?: string | null }[];
  };
  const card = body.entries.find((entry) => entry.kind === 'todo' && entry.id === out.id);
  expect(card?.missingCommand).toBe('pnpm');
});
