import { chiefIdFormat } from '@cairn/shared';
import { afterEach, describe, expect, test } from 'vitest';
import {
  build as buildTable,
  chief as chiefTable,
  chiefThread as chiefThreadTable,
  computerCall as computerCallTable,
  computer as computerTable,
  machine as machineTable,
  project as projectTable,
  step as stepTable,
  team as teamTable,
  user as userTable,
} from '../src/db/schema.js';
import { createTodo } from '../src/services/todos.js';
import { bootServer, type TestServer } from './helpers.js';

let server: TestServer | null = null;
afterEach(() => {
  server?.dispose();
  server = null;
});

function req(app: TestServer['app'], method: string, path: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: { authorization: 'Bearer computer-feed-owner', 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function boot(): TestServer {
  server = bootServer({ authToken: 'computer-feed-owner' });
  return server;
}

function addMachine(s: TestServer, teamId: string, id: string, online = true) {
  s.db
    .insert(machineTable)
    .values({
      id,
      teamId,
      name: `name-${id}`,
      online,
      lastSeenAt: 1,
      capabilities: { mcpServers: [], skills: [] },
    })
    .run();
}

function addComputer(
  s: TestServer,
  teamId: string,
  id: string,
  machineId: string,
  userId = s.user.id,
) {
  const chiefId = chiefIdFormat(userId, teamId);
  s.db.insert(userTable).values({ id: userId, displayName: 'Owner' }).onConflictDoNothing().run();
  s.db
    .insert(chiefTable)
    .values({ id: chiefId, userId, teamId, createdAt: 1 })
    .onConflictDoNothing()
    .run();
  s.db
    .insert(chiefThreadTable)
    .values({
      id: `chief-thread-${id}`,
      chiefId,
      userId,
      teamId,
      title: id,
      sessionId: '',
      sessionOpenedAt: 1,
      createdAt: 1,
      updatedAt: 1,
    })
    .run();
  s.db
    .insert(stepTable)
    .values({ id: `step-${id}`, buildId: `chief-thread-${id}`, kind: 'chief', createdAt: 1 })
    .run();
  s.db
    .insert(computerTable)
    .values({
      id,
      teamId,
      scopeKey: `chief:${chiefId}`,
      machineId,
      providerRef: `ref-${id}`,
      state: 'running',
      createdAt: 1,
      updatedAt: 1,
    })
    .run();
}

function addCall(
  s: TestServer,
  teamId: string,
  computerId: string,
  machineId: string,
  n: number,
  patch: Partial<typeof computerCallTable.$inferInsert> = {},
) {
  s.db
    .insert(computerCallTable)
    .values({
      id: n.toString(16).padStart(64, '0'),
      teamId,
      stepId: `step-${computerId}`,
      toolCallId: `tc-${n}`,
      machineId,
      computerId,
      tool: 'shell',
      replaySafe: false,
      params: { command: `echo ${n}` },
      state: 'done',
      outputTail: `out ${n}`,
      exitCode: 0,
      deadlineAt: 100,
      createdAt: n,
      startedAt: n,
      finishedAt: n + 1,
      ...patch,
    })
    .run();
}

async function activityOf(s: TestServer) {
  const body = (await (await req(s.app, 'GET', '/api/computers')).json()) as {
    computers: { activity: unknown }[];
  };
  return body.computers[0]?.activity;
}

describe('computer feed routes', () => {
  test('activity comes only from calls on the computer: a code step on the host machine is neither using nor last using it', async () => {
    const s = boot();
    addMachine(s, s.team.id, 'm1');
    addComputer(s, s.team.id, 'c1', 'm1');
    expect(await activityOf(s)).toBeNull();
    const projectId = 'p1';
    s.db.insert(projectTable).values({ id: projectId, name: 'demo', teamId: s.team.id }).run();
    const task = (id: string, title: string) => {
      const row = createTodo(s.svc, {
        teamId: s.team.id,
        projectId,
        title,
        spec: '',
        createdBy: s.user.id,
        ownerId: s.user.id,
      });
      s.db
        .insert(buildTable)
        .values({
          id: `b-${id}`,
          todoId: row.id,
          triggerSource: 'user',
          withPlan: false,
          createdAt: 1,
        })
        .run();
      s.db
        .insert(stepTable)
        .values({
          id: `step-${id}`,
          buildId: `b-${id}`,
          kind: 'build',
          status: 'claimed',
          machineId: 'm1',
          claimedAt: 50,
          createdAt: 1,
        })
        .run();
      return row;
    };
    task('code', 'code task on the host');
    expect(await activityOf(s)).toBeNull();
    addCall(s, s.team.id, 'c1', 'm1', 5, { state: 'running', finishedAt: null });
    expect(await activityOf(s)).toEqual({
      inUse: true,
      title: null,
      todoId: null,
      threadId: 'chief-thread-c1',
      at: 5,
    });
    s.db.update(computerCallTable).set({ state: 'done', finishedAt: 9 }).run();
    expect(await activityOf(s)).toMatchObject({ inUse: false, threadId: 'chief-thread-c1', at: 9 });
    const card = task('card', 'info card');
    addCall(s, s.team.id, 'c1', 'm1', 7, { stepId: 'step-card', finishedAt: 20 });
    expect(await activityOf(s)).toEqual({
      inUse: false,
      title: 'info card',
      todoId: card.id,
      threadId: null,
      at: 20,
    });
  });

  test('lists the current user private computer with machine name, state and control holder', async () => {
    const s = boot();
    addMachine(s, s.team.id, 'm1', false);
    addComputer(s, s.team.id, 'c1', 'm1');
    const res = await req(s.app, 'GET', '/api/computers');
    expect(await res.json()).toEqual({
      computers: [
        {
          id: 'c1',
          scopeKey: `chief:${chiefIdFormat(s.user.id, s.team.id)}`,
          state: 'running',
          controlHolder: 'none',
          handoffReason: null,
          machine: { id: 'm1', name: 'name-m1', online: false },
          activity: null,
        },
      ],
    });
  });

  test('an online computer machine lists a stopped Coordinator computer before any computer call', async () => {
    const s = boot();
    addMachine(s, s.team.id, 'plain');
    s.db
      .insert(machineTable)
      .values({
        id: 'mac',
        teamId: s.team.id,
        name: 'name-mac',
        online: true,
        lastSeenAt: 2,
        capabilities: { mcpServers: [], skills: [], computer: true, computerKind: 'host' },
      })
      .run();
    const first = (await (await req(s.app, 'GET', '/api/computers')).json()) as {
      computers: { id: string; scopeKey: string; state: string; machine: { id: string } }[];
    };
    expect(first.computers).toHaveLength(1);
    expect(first.computers[0]).toMatchObject({
      scopeKey: `chief:${chiefIdFormat(s.user.id, s.team.id)}`,
      state: 'stopped',
      machine: { id: 'mac' },
    });
    const again = (await (await req(s.app, 'GET', '/api/computers')).json()) as {
      computers: { id: string }[];
    };
    expect(again.computers.map((row) => row.id)).toEqual([first.computers[0]?.id]);
  });

  test('no Coordinator computer appears without an online computer machine', async () => {
    const s = boot();
    s.db
      .insert(machineTable)
      .values({
        id: 'offline',
        teamId: s.team.id,
        name: 'offline',
        online: false,
        lastSeenAt: 3,
        capabilities: { mcpServers: [], skills: [], computer: true },
      })
      .run();
    expect(await (await req(s.app, 'GET', '/api/computers')).json()).toEqual({ computers: [] });
  });

  test('a pending login handoff is listed so the panel can ask the owner to log in', async () => {
    const s = boot();
    addMachine(s, s.team.id, 'm1', false);
    addComputer(s, s.team.id, 'c1', 'm1');
    s.db
      .update(computerTable)
      .set({ handoffReason: 'login', handoffStepId: 'step-a', handoffRequestedAt: 1 })
      .run();
    const res = await req(s.app, 'GET', '/api/computers');
    const body = (await res.json()) as { computers: { handoffReason: string | null }[] };
    expect(body.computers[0]?.handoffReason).toBe('login');
  });

  test('another team computer is never listed', async () => {
    const s = boot();
    s.db
      .insert(teamTable)
      .values({
        id: 'other-team',
        name: 'other',
        createdAt: 1,
        plan: 'free',
        avatarStyle: 'notionist',
      })
      .run();
    addMachine(s, 'other-team', 'm-other');
    addComputer(s, 'other-team', 'c-other', 'm-other');
    addCall(s, 'other-team', 'c-other', 'm-other', 1);
    addMachine(s, s.team.id, 'm1');
    addComputer(s, s.team.id, 'c1', 'm1');
    addCall(s, s.team.id, 'c1', 'm1', 2);
    addCall(s, 'other-team', 'c1', 'm-other', 3);

    const list = (await (await req(s.app, 'GET', '/api/computers')).json()) as {
      computers: { id: string }[];
    };
    expect(list.computers.map((c) => c.id)).toEqual(['c1']);
  });

  test('the step feed shows what an agent does on a machine with its latest screenshot, and only while it acts', async () => {
    const s = boot();
    addMachine(s, s.team.id, 'm1');
    addComputer(s, s.team.id, 'c1', 'm1');
    const png = (width: number, height: number) => {
      const head = Buffer.alloc(33);
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(head, 0);
      head.writeUInt32BE(13, 8);
      head.write('IHDR', 12, 'latin1');
      head.writeUInt32BE(width, 16);
      head.writeUInt32BE(height, 20);
      return { data: head.toString('base64'), mimeType: 'image/png' as const };
    };
    const now = Date.now();
    addCall(s, s.team.id, 'c1', 'm1', 1, {
      tool: 'browser_navigate',
      params: { url: 'https://github.example.test/pulls' },
      createdAt: now - 9_000,
      startedAt: now - 9_000,
      finishedAt: now - 8_000,
    });
    addCall(s, s.team.id, 'c1', 'm1', 2, {
      tool: 'computer_act',
      params: { actions: [{ kind: 'click', x: 320, y: 200 }] },
      resultImages: [png(1280, 800)],
      createdAt: now - 7_000,
      startedAt: now - 7_000,
      finishedAt: now - 6_000,
    });
    addCall(s, s.team.id, 'c1', 'm1', 3, {
      tool: 'browser_act',
      params: { actions: [{ kind: 'click', ref: '@e4' }] },
      state: 'running',
      createdAt: now - 1_000,
      startedAt: now - 1_000,
      finishedAt: null,
    });
    const steps = async () =>
      ((await (await req(s.app, 'GET', '/api/computers/steps')).json()) as { steps: unknown[] })
        .steps;
    expect(await steps()).toEqual([
      {
        machineId: 'm1',
        callId: (3).toString(16).padStart(64, '0'),
        surface: 'browser',
        inFlight: true,
        at: now - 1_000,
        shot: {
          callId: (2).toString(16).padStart(64, '0'),
          width: 1280,
          height: 800,
          point: { x: 320, y: 200 },
        },
        shotMissing: false,
      },
    ]);
    const shot = await req(
      s.app,
      'GET',
      `/api/computers/steps/${(2).toString(16).padStart(64, '0')}/shot`,
    );
    expect(shot.status).toBe(200);
    expect(shot.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await shot.arrayBuffer()).readUInt32BE(16)).toBe(1280);
    const notAShot = await req(
      s.app,
      'GET',
      `/api/computers/steps/${(1).toString(16).padStart(64, '0')}/shot`,
    );
    expect(notAShot.status).toBe(404);

    s.db
      .update(computerCallTable)
      .set({ state: 'done', finishedAt: now - 60_000 })
      .run();
    expect(await steps()).toEqual([]);
  });

  test('a screen call that captured no picture is reported so the card can say why', async () => {
    const s = boot();
    addMachine(s, s.team.id, 'm1');
    addComputer(s, s.team.id, 'c1', 'm1');
    const now = Date.now();
    addCall(s, s.team.id, 'c1', 'm1', 1, {
      tool: 'user_computer_observe',
      params: { app: 'Finder' },
      resultImages: null,
      createdAt: now - 2_000,
      startedAt: now - 2_000,
      finishedAt: now - 1_000,
    });
    const body = (await (await req(s.app, 'GET', '/api/computers/steps')).json()) as {
      steps: { surface: string; shot: unknown; shotMissing: boolean }[];
    };
    expect(body.steps).toMatchObject([{ surface: 'app', shot: null, shotMissing: true }]);
  });

  test('another user agent acting on a shared machine is not shown to this user', async () => {
    const s = boot();
    addMachine(s, s.team.id, 'm1');
    addComputer(s, s.team.id, 'c-other', 'm1', 'someone-else');
    addCall(s, s.team.id, 'c-other', 'm1', 1, {
      tool: 'browser_snapshot',
      params: {},
      state: 'running',
      createdAt: Date.now(),
      startedAt: Date.now(),
      finishedAt: null,
    });
    const body = (await (await req(s.app, 'GET', '/api/computers/steps')).json()) as {
      steps: unknown[];
    };
    expect(body.steps).toEqual([]);
  });
});
