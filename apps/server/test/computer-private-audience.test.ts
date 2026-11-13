import { type ComputerCall, chiefIdFormat, type UserRecord } from '@cairn/shared';
import { type ServerType, serve } from '@hono/node-server';
import type { Hono } from 'hono';
import { afterEach, describe, expect, test } from 'vitest';
import { createApp } from '../src/app.js';
import {
  chief,
  chiefThread,
  computer,
  computerCall,
  machine,
  step,
  user,
} from '../src/db/schema.js';
import { TeamStreamHub } from '../src/services/events.js';
import {
  dropComputerWaiters,
  forwardComputerCall,
  receiveComputerFrames,
} from '../src/services/machine-computer.js';
import { bootServer, type TestServer } from './helpers.js';

const AUTH = 'private-audience-test-token';
const TOKEN = `ghp_${'a1B2c3D4e5'.repeat(3)}`;
let server: TestServer | undefined;
const closeStreams: (() => void)[] = [];
const liveServers: ServerType[] = [];

afterEach(async () => {
  for (const close of closeStreams.splice(0)) close();
  dropComputerWaiters();
  await Promise.all(
    liveServers.splice(0).map(
      (listener) =>
        new Promise<void>((resolve, reject) => {
          listener.close((error) => (error ? reject(error) : resolve()));
          if ('closeAllConnections' in listener) listener.closeAllConnections();
        }),
    ),
  );
  server?.dispose();
  server = undefined;
});

function principalApp(s: TestServer, principal: UserRecord) {
  return createApp({
    ...s.svc,
    user: principal,
    team: s.team,
    secretBox: s.secretBox,
    reposDir: s.reposDir,
    attachmentsDir: s.attachmentsDir,
    skillsDir: s.skillsDir,
    skillSourcesPath: s.skillSourcesPath,
    pingIntervalMs: 3_600_000,
    claimHoldMs: 250,
    uploads: new Map(),
    enrollments: new Map(),
    oauthStates: new Map(),
    xaiDeviceStates: new Map(),
    oauthClient: null,
    authToken: AUTH,
    mcpConfigPath: '/tmp/private-audience-absent.json',
  });
}

async function listen(app: Hono): Promise<string> {
  return new Promise((resolve) => {
    const listener = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 }, (address) =>
      resolve(`http://127.0.0.1:${address.port}`),
    );
    liveServers.push(listener);
  });
}

async function world() {
  const s = bootServer({ authToken: AUTH });
  server = s;
  const bob: UserRecord = { type: 'user', id: 'bob', displayName: 'Bob', avatarUrl: null };
  s.db.insert(user).values({ id: bob.id, displayName: bob.displayName }).run();
  s.db
    .insert(machine)
    .values([
      { id: 'sidecar', teamId: s.team.id, name: 'Sidecar' },
      {
        id: 'worker',
        teamId: s.team.id,
        name: 'Worker',
        capabilities: { mcpServers: [], skills: [], computer: true, ownComputer: true },
      },
    ])
    .run();
  for (const owner of [s.user, bob]) {
    const chiefId = chiefIdFormat(owner.id, s.team.id);
    s.db
      .insert(chief)
      .values({ id: chiefId, userId: owner.id, teamId: s.team.id, createdAt: 1 })
      .run();
    s.db
      .insert(chiefThread)
      .values({
        id: `chief-thread-${owner.id}`,
        chiefId,
        userId: owner.id,
        teamId: s.team.id,
        title: 'Private',
        sessionId: '',
        sessionOpenedAt: 1,
        createdAt: 1,
        updatedAt: 1,
      })
      .run();
    s.db
      .insert(step)
      .values({
        id: `step-${owner.id}`,
        buildId: `chief-thread-${owner.id}`,
        kind: 'chief',
        machineId: 'sidecar',
        status: 'claimed',
        createdAt: 1,
      })
      .run();
    s.db
      .insert(computer)
      .values({
        id: `computer-${owner.id}`,
        teamId: s.team.id,
        machineId: 'worker',
        scopeKey: `chief:${chiefId}`,
        providerRef: owner.id,
        createdAt: 1,
        updatedAt: 1,
      })
      .run();
  }
  const calls: ComputerCall[] = [];
  s.machineHub.subscribeMachine(s.team.id, 'worker', (event) => {
    if (event.type === 'computer') calls.push(event.call);
  });
  const [aliceApp, bobApp] = await Promise.all([
    listen(principalApp(s, s.user)),
    listen(principalApp(s, bob)),
  ]);
  return {
    s,
    bob,
    aliceApp,
    bobApp,
    calls,
    deps: { ...s.svc, box: s.secretBox, reposDir: s.reposDir, attachmentsDir: s.attachmentsDir },
  };
}

async function get(app: string, path: string, cookie?: string) {
  return fetch(new URL(path, app), {
    headers: { authorization: `Bearer ${AUTH}`, ...(cookie ? { cookie } : {}) },
  });
}

async function rawStream(app: string, teamId: string) {
  const controller = new AbortController();
  const response = await fetch(`${app}/api/teams/${teamId}/stream`, {
    signal: controller.signal,
    headers: { authorization: `Bearer ${AUTH}` },
  });
  expect(response.status).toBe(200);
  const reader = response.body?.getReader();
  if (!reader) throw new Error('missing SSE body');
  closeStreams.push(() => {
    controller.abort();
    void reader.cancel().catch(() => {});
  });
  const decoder = new TextDecoder();
  let buffer = '';
  const events: Record<string, unknown>[] = [];
  return {
    async through(type: string) {
      while (!events.some((event) => event.type === type)) {
        const chunk = await reader.read();
        if (chunk.done) throw new Error('SSE ended before barrier');
        buffer += decoder.decode(chunk.value, { stream: true });
        let index = buffer.indexOf('\n\n');
        while (index >= 0) {
          const frame = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          for (const line of frame.split('\n'))
            if (line.startsWith('data:')) events.push(JSON.parse(line.slice(5)));
          index = buffer.indexOf('\n\n');
        }
      }
      return events;
    },
  };
}

describe('private computer principal boundary with two server-bound AppContexts', () => {
  test('each current user lists and reads only its private computer; a client cookie cannot choose the principal', async () => {
    const { s, bob, aliceApp, bobApp } = await world();
    expect((await fetch(`${aliceApp}/api/computers`)).status).toBe(401);
    expect((await fetch(`${bobApp}/api/teams/${s.team.id}/stream`)).status).toBe(401);
    for (const [app, owner, foreign] of [
      [aliceApp, s.user, bob],
      [bobApp, bob, s.user],
    ] as const) {
      const response = await get(app, '/api/computers');
      expect(await response.json()).toMatchObject({ computers: [{ id: `computer-${owner.id}` }] });
      expect((await get(app, `/api/computers/computer-${owner.id}/commands`)).status).toBe(200);
      expect((await get(app, `/api/computers/computer-${foreign.id}/commands`)).status).toBe(404);
    }
    expect(
      await (await get(aliceApp, '/api/auth/session', 'cairn_session=bob')).json(),
    ).toMatchObject({ id: s.user.id });
  });

  test('actual dispatch, redacted incremental output and completion cross raw SSE only to their stored owner', async () => {
    const { s, bob, aliceApp, bobApp, calls, deps } = await world();
    const aliceStream = await rawStream(aliceApp, s.team.id);
    const bobStream = await rawStream(bobApp, s.team.id);
    await Promise.all([aliceStream.through('ping'), bobStream.through('ping')]);
    for (const owner of [s.user, bob]) {
      const result = forwardComputerCall(deps, 'sidecar', `step-${owner.id}`, {
        computer: true,
        name: 'shell',
        toolCallId: 'private-shell',
        params: { command: `echo private-${owner.id}`, cwd: `/private/${owner.id}` },
      });
      const call = calls.at(-1);
      if (!call) throw new Error('machine did not receive call');
      receiveComputerFrames(s.db, s.hub, 'worker', call.callId, [
        {
          kind: 'output',
          seq: 1,
          stream: 'stdout',
          text: `private-output-${owner.id} ${TOKEN.slice(0, 15)}`,
        },
      ]);
      receiveComputerFrames(s.db, s.hub, 'worker', call.callId, [
        { kind: 'output', seq: 2, stream: 'stdout', text: `${TOKEN.slice(15)}\n` },
      ]);
      receiveComputerFrames(s.db, s.hub, 'worker', call.callId, [
        { kind: 'done', seq: 3, text: 'done', exitCode: 0 },
      ]);
      await result;
    }
    s.hub.publish(s.team.id, (conn) => ({
      type: 'machine_presence',
      seq: conn.nextSeq(),
      machineId: 'presence-barrier',
      online: true,
    }));
    const [aliceEvents, bobEvents] = await Promise.all([
      aliceStream.through('machine_presence'),
      bobStream.through('machine_presence'),
    ]);
    for (const [events, owner, foreign] of [
      [aliceEvents, s.user, bob],
      [bobEvents, bob, s.user],
    ] as const) {
      const commands = events
        .filter((event) => event.type === 'computer.command')
        .map((event) => event.command);
      expect(commands).toHaveLength(4);
      expect(commands).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            computerId: `computer-${owner.id}`,
            status: 'running',
            output: expect.stringContaining('[REDACTED]'),
          }),
          expect.objectContaining({ computerId: `computer-${owner.id}`, status: 'done' }),
        ]),
      );
      const raw = JSON.stringify(events);
      expect(raw).not.toContain(`private-${foreign.id}`);
      expect(raw).not.toContain(`private-output-${foreign.id}`);
      expect(raw).not.toContain(`/private/${foreign.id}`);
      expect(raw).not.toContain(TOKEN);
      const history = await (
        await get(
          owner.id === bob.id ? bobApp : aliceApp,
          `/api/computers/computer-${owner.id}/commands`,
        )
      ).text();
      expect(history).toContain('[REDACTED]');
      expect(history).not.toContain(TOKEN);
    }
  });

  test('host-null feed resolves Bob through the step, even when MachineDeps.user is Alice', async () => {
    const { s, bob, aliceApp, bobApp, calls, deps } = await world();
    const a = await rawStream(aliceApp, s.team.id);
    const b = await rawStream(bobApp, s.team.id);
    const result = forwardComputerCall(
      deps,
      'sidecar',
      `step-${bob.id}`,
      {
        computer: true,
        name: 'user_computer_shell',
        toolCallId: 'host-shell',
        params: { command: 'echo private-host-bob' },
      },
      { ownComputerGate: () => {} },
    );
    const call = calls.at(-1);
    if (!call) throw new Error('machine did not receive host call');
    receiveComputerFrames(s.db, s.hub, 'worker', call.callId, [
      { kind: 'done', seq: 1, text: 'host-bob', exitCode: 0 },
    ]);
    await result;
    s.hub.publish(s.team.id, (conn) => ({
      type: 'machine_presence',
      seq: conn.nextSeq(),
      machineId: 'presence-barrier',
      online: true,
    }));
    const [aEvents, bEvents] = await Promise.all([
      a.through('machine_presence'),
      b.through('machine_presence'),
    ]);
    expect(aEvents.filter((event) => event.type === 'computer.command')).toEqual([]);
    expect(
      bEvents.filter((event) => event.type === 'computer.command').map((event) => event.command),
    ).toEqual([
      expect.objectContaining({ computerId: null, status: 'running' }),
      expect.objectContaining({ computerId: null, status: 'done' }),
    ]);
    expect(s.db.select().from(computerCall).all()).toHaveLength(1);
  });
});

test('private publication never falls back to an unscoped subscriber or another team', () => {
  const hub = new TeamStreamHub();
  const received = new Map<string, object[]>();
  for (const [teamId, userId, name] of [
    ['team', 'alice', 'alice'],
    ['team', 'bob', 'bob'],
    ['team', undefined, 'unscoped'],
    ['other', 'alice', 'other'],
  ] as const) {
    const events: object[] = [];
    received.set(name, events);
    hub.subscribe(
      teamId,
      {
        nextSeq: () => 1,
        send: async (event) => {
          events.push(event);
        },
      },
      userId,
    );
  }
  hub.publishPrivate('team', 'alice', () => ({ type: 'private' }));
  hub.publishPrivate('team', '', () => ({ type: 'invalid' }));
  hub.publish('team', () => ({ type: 'public' }));
  expect(received.get('alice')).toEqual([{ type: 'private' }, { type: 'public' }]);
  expect(received.get('bob')).toEqual([{ type: 'public' }]);
  expect(received.get('unscoped')).toEqual([{ type: 'public' }]);
  expect(received.get('other')).toEqual([]);
});
