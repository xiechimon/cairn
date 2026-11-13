import { chiefIdFormat } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, test } from 'vitest';
import {
  chief as chiefTable,
  chiefThread as chiefThreadTable,
  computerCall as computerCallTable,
  computer as computerTable,
  machine as machineTable,
  step as stepTable,
  team as teamTable,
  user as userTable,
} from '../src/db/schema.js';
import { bootServer, type TestServer } from './helpers.js';

const FAKE_TOKEN = `ghp_${'a1B2c3D4e5'.repeat(3)}`;

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

async function commands(s: TestServer, id: string, query = '') {
  const res = await req(s.app, 'GET', `/api/computers/${id}/commands${query}`);
  return { status: res.status, body: (await res.json()) as { commands: { callId: string }[] } };
}

describe('computer feed routes', () => {
  test('history applies the stored owner rule to foreign-step and missing-owner calls', async () => {
    const s = boot();
    addMachine(s, s.team.id, 'm1');
    addComputer(s, s.team.id, 'c1', 'm1');
    addComputer(s, s.team.id, 'c2', 'm1', 'other-user');
    addCall(s, s.team.id, 'c1', 'm1', 1);
    addCall(s, s.team.id, 'c1', 'm1', 2, { stepId: 'step-c2', outputTail: 'foreign-output' });
    addCall(s, s.team.id, 'c1', 'm1', 3, { stepId: 'missing-step', outputTail: 'orphan-output' });
    expect(
      (await commands(s, 'c1')).body.commands.map((command) => Number.parseInt(command.callId, 16)),
    ).toEqual([1]);
    s.db
      .delete(chiefTable)
      .where(eq(chiefTable.id, chiefIdFormat(s.user.id, s.team.id)))
      .run();
    expect((await commands(s, 'c1')).body.commands).toEqual([]);
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
          browserEnabled: false,
          handoffReason: null,
          machine: { id: 'm1', name: 'name-m1', online: false },
        },
      ],
    });
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

  test('PATCH enables and disables browser tools on the owned computer', async () => {
    const s = boot();
    s.db
      .insert(machineTable)
      .values({
        id: 'm1',
        teamId: s.team.id,
        name: 'name-m1',
        online: true,
        lastSeenAt: 1,
        capabilities: { mcpServers: [], skills: [], browser: true },
      })
      .run();
    addComputer(s, s.team.id, 'c1', 'm1');
    const on = await req(s.app, 'PATCH', '/api/computers/c1', { browserEnabled: true });
    expect(on.status).toBe(200);
    expect(await on.json()).toMatchObject({
      computer: { id: 'c1', browserEnabled: true },
    });
    const listed = await req(s.app, 'GET', '/api/computers');
    expect(await listed.json()).toMatchObject({
      computers: [{ id: 'c1', browserEnabled: true }],
    });
    const off = await req(s.app, 'PATCH', '/api/computers/c1', { browserEnabled: false });
    expect(await off.json()).toMatchObject({
      computer: { id: 'c1', browserEnabled: false },
    });
    expect(
      (await req(s.app, 'PATCH', '/api/computers/missing', { browserEnabled: true })).status,
    ).toBe(404);
  });

  test('a saved browser preference stays visible after the capability disappears', async () => {
    const s = boot();
    s.db
      .insert(machineTable)
      .values({
        id: 'm1',
        teamId: s.team.id,
        name: 'name-m1',
        online: true,
        lastSeenAt: 1,
        capabilities: { mcpServers: [], skills: [], browser: true },
      })
      .run();
    addComputer(s, s.team.id, 'c1', 'm1');
    expect((await req(s.app, 'PATCH', '/api/computers/c1', { browserEnabled: true })).status).toBe(
      200,
    );
    s.db
      .update(machineTable)
      .set({ capabilities: { mcpServers: [], skills: [] } })
      .where(eq(machineTable.id, 'm1'))
      .run();
    const listed = await req(s.app, 'GET', '/api/computers');
    expect(await listed.json()).toMatchObject({
      computers: [{ id: 'c1', browserEnabled: true }],
    });
    expect(s.db.select().from(machineTable).where(eq(machineTable.id, 'm1')).get()).toMatchObject({
      browserOverride: true,
    });
  });

  test('POST ensures a stopped private computer and sets browserEnabled before any tool call', async () => {
    const s = boot();
    s.db
      .insert(machineTable)
      .values({
        id: 'm1',
        teamId: s.team.id,
        name: 'omarchy',
        online: false,
        lastSeenAt: 1,
        capabilities: { mcpServers: [], skills: [], computer: true, browser: true },
      })
      .run();
    s.db
      .insert(machineTable)
      .values({
        id: 'm2',
        teamId: s.team.id,
        name: 'other',
        online: true,
        lastSeenAt: 1,
        capabilities: { mcpServers: [], skills: [], computer: true, browser: true },
      })
      .run();
    const created = await req(s.app, 'POST', '/api/computers', {
      machineId: 'm1',
      browserEnabled: true,
    });
    expect(created.status).toBe(200);
    expect(await created.json()).toMatchObject({
      computer: {
        state: 'stopped',
        browserEnabled: true,
        machine: { id: 'm1', online: false },
      },
    });
    expect(
      (await req(s.app, 'POST', '/api/computers', { machineId: 'm2', browserEnabled: true }))
        .status,
    ).toBe(409);
    const again = await req(s.app, 'POST', '/api/computers', {
      machineId: 'm1',
      browserEnabled: false,
    });
    expect(await again.json()).toMatchObject({
      computer: { browserEnabled: false, state: 'stopped' },
    });
    expect(
      (await req(s.app, 'POST', '/api/computers', { machineId: 'missing', browserEnabled: true }))
        .status,
    ).toBe(404);
  });

  test('POST and PATCH refuse enabling without explicit browser capability', async () => {
    const s = boot();
    s.db
      .insert(machineTable)
      .values({
        id: 'm1',
        teamId: s.team.id,
        name: 'old-orb',
        online: true,
        lastSeenAt: 1,
        capabilities: { mcpServers: [], skills: [], computer: true },
      })
      .run();
    expect(
      (await req(s.app, 'POST', '/api/computers', { machineId: 'm1', browserEnabled: true }))
        .status,
    ).toBe(404);
    addComputer(s, s.team.id, 'c1', 'm1');
    expect((await req(s.app, 'PATCH', '/api/computers/c1', { browserEnabled: true })).status).toBe(
      404,
    );
  });

  test('another team computer and calls are never returned', async () => {
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
    expect((await commands(s, 'c-other')).status).toBe(404);
    expect((await commands(s, 'c1')).body.commands.map((c) => c.callId)).toEqual([
      (2).toString(16).padStart(64, '0'),
    ]);
  });

  test('commands come oldest first, newest last, and limit keeps the newest', async () => {
    const s = boot();
    addMachine(s, s.team.id, 'm1');
    addComputer(s, s.team.id, 'c1', 'm1');
    for (const n of [3, 1, 5, 2, 4]) addCall(s, s.team.id, 'c1', 'm1', n);
    const ids = (await commands(s, 'c1')).body.commands.map((c) => Number.parseInt(c.callId, 16));
    expect(ids).toEqual([1, 2, 3, 4, 5]);
    const limited = (await commands(s, 'c1', '?limit=2')).body.commands.map((c) =>
      Number.parseInt(c.callId, 16),
    );
    expect(limited).toEqual([4, 5]);
    expect((await commands(s, 'c1', '?limit=nope')).body.commands).toHaveLength(5);
  });

  test('stored output is redacted again and capped on the way out', async () => {
    const s = boot();
    addMachine(s, s.team.id, 'm1');
    addComputer(s, s.team.id, 'c1', 'm1');
    addCall(s, s.team.id, 'c1', 'm1', 1, {
      params: { command: `curl -H "Authorization: Bearer ${FAKE_TOKEN}" x` },
      outputTail: `${'x'.repeat(10_000)}token ${FAKE_TOKEN}\n`,
    });
    const res = await req(s.app, 'GET', '/api/computers/c1/commands');
    const text = await res.text();
    expect(text).not.toContain(FAKE_TOKEN);
    expect(text).toContain('[REDACTED]');
    const [only] = (JSON.parse(text) as { commands: { output: string }[] }).commands;
    expect(only?.output.length).toBeLessThanOrEqual(4 * 1024);
  });

  test('command timestamps keep dispatch order when earlier calls finish later', async () => {
    const s = boot();
    addMachine(s, s.team.id, 'm1');
    addComputer(s, s.team.id, 'c1', 'm1');
    addCall(s, s.team.id, 'c1', 'm1', 1, { startedAt: 2, finishedAt: 100 });
    addCall(s, s.team.id, 'c1', 'm1', 3, {
      state: 'running',
      startedAt: 4,
      finishedAt: null,
    });
    const res = await req(s.app, 'GET', '/api/computers/c1/commands');
    const body = (await res.json()) as { commands: { at: number }[] };
    expect(body.commands.map((command) => command.at)).toEqual([1, 3]);
  });

  test('history commands identify the computer that produced them', async () => {
    const s = boot();
    addMachine(s, s.team.id, 'm1');
    addComputer(s, s.team.id, 'c1', 'm1');
    addComputer(s, s.team.id, 'c2', 'm1', 'another-user');
    addCall(s, s.team.id, 'c1', 'm1', 1);
    addCall(s, s.team.id, 'c2', 'm1', 2);
    const { body } = await commands(s, 'c1');
    expect(body.commands).toEqual([expect.objectContaining({ computerId: 'c1' })]);
  });

  test('read tools are not in the feed and running calls report running', async () => {
    const s = boot();
    addMachine(s, s.team.id, 'm1');
    addComputer(s, s.team.id, 'c1', 'm1');
    addCall(s, s.team.id, 'c1', 'm1', 1, { tool: 'read_file', params: { path: 'a' } });
    addCall(s, s.team.id, 'c1', 'm1', 2, { state: 'running', exitCode: null, finishedAt: null });
    const { body } = await commands(s, 'c1');
    expect(body.commands).toHaveLength(1);
    expect(body.commands[0]).toMatchObject({ status: 'running', exitCode: null });
  });
});
