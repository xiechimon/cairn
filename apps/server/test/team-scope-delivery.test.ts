import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  apiKey,
  build,
  chiefMessage,
  clientMessage,
  gateVerdict,
  message,
  notification,
  step,
  todo,
} from '../src/db/schema.js';
import { sendBuildSteer } from '../src/services/builds.js';
import { claimClientMessage, completeClientMessage } from '../src/services/client-message.js';
import { getTodo } from '../src/services/todos.js';
import { sweepWorkerWatchdog } from '../src/services/worker-watchdog.js';
import {
  fixtureRequest,
  type ScopeTeam,
  type ScopeWorld,
  snapshotTeam,
  twoTeamWorld,
} from './team-scope-world.js';

let world: ScopeWorld;

beforeEach(async () => {
  world = await twoTeamWorld();
}, 20_000);

const transcripts = [
  {
    kind: 'build',
    stepKey: 'stepId',
    rootKey: 'buildId',
    rows: 'messages',
    rootField: 'conversationId',
  },
  {
    kind: 'Chief',
    stepKey: 'chiefStepId',
    rootKey: 'threadId',
    rows: 'chiefMessages',
    rootField: 'threadId',
  },
] as const;
const transcriptOwners = transcripts.flatMap((transcript) =>
  (['a', 'b'] as const).map((owner) => ({ ...transcript, owner })),
);

function report(team: ScopeTeam, stepId: string, id: string, content: string) {
  return fixtureRequest(team.server, 'POST', `/api/machine/tool/${stepId}`, {
    bearer: team.runnerToken,
    body: { kind: 'transcript_row', row: { id, role: 'assistant', content, createdAt: 2 } },
  });
}

describe('transcript ownership and conflicts', () => {
  it.each(transcriptOwners)(
    '$kind updates an owned transcript row when the same client key is reported again ($owner)',
    async ({ stepKey, rows, owner }) => {
      const a = world[owner];
      const b = world[owner === 'a' ? 'b' : 'a'];
      const before = snapshotTeam(world, b);
      const clientKey = 'fixture-report';
      const first = await report(a, a[stepKey], clientKey, 'fixture own report');
      expect(first.status).toBe(200);
      expect(await first.json()).toEqual({ ok: true });
      const own = snapshotTeam(world, a)[rows];
      const row = own.find(({ content }) => content === 'fixture own report');
      expect(row).toBeDefined();

      const second = await report(a, a[stepKey], clientKey, 'fixture own revision');
      expect(second.status).toBe(200);
      const after = snapshotTeam(world, a)[rows];
      expect(after).toHaveLength(own.length);
      expect(after.find(({ id }) => id === row?.id)?.content).toBe('fixture own revision');
      expect(snapshotTeam(world, b)).toEqual(before);
    },
  );

  it.fails.each(transcriptOwners)(
    '$kind transcript conflict overwrites a foreign transcript with the same client key ($owner)',
    async ({ stepKey, rows, owner }) => {
      const a = world[owner];
      const b = world[owner === 'a' ? 'b' : 'a'];
      const clientKey = 'fixture-shared-row';
      const accepted = await report(b, b[stepKey], clientKey, 'fixture original report');
      expect(accepted.status).toBe(200);
      const before = snapshotTeam(world, b);
      expect(before[rows]).toContainEqual(
        expect.objectContaining({ content: 'fixture original report' }),
      );
      const second = await report(a, a[stepKey], clientKey, 'fixture independent report');
      expect(second.status).toBe(200);
      expect({ own: snapshotTeam(world, a)[rows], foreign: snapshotTeam(world, b) }).toEqual({
        own: expect.arrayContaining([
          expect.objectContaining({ content: 'fixture independent report' }),
        ]),
        foreign: before,
      });
    },
  );

  const assignedReport = ['fixture-assigned-report', 'fixture assigned parent report'] as const;

  it.each(transcriptOwners)(
    'accepts a runner report for its exact assigned $kind ($owner)',
    async ({ owner, stepKey, rootKey, rows, rootField }) => {
      const a = world[owner];
      const b = world[owner === 'a' ? 'b' : 'a'];
      const before = snapshotTeam(world, b);
      const response = await report(a, a[stepKey], ...assignedReport);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });
      expect(snapshotTeam(world, a)[rows]).toContainEqual(
        expect.objectContaining({ content: assignedReport[1], [rootField]: a[rootKey] }),
      );
      expect(snapshotTeam(world, b)).toEqual(before);
    },
  );

  it.fails.each(transcriptOwners)(
    'assignment-only report lookup can append to a foreign $kind ($owner)',
    async ({ owner, stepKey, rootKey }) => {
      const { db } = world;
      const a = world[owner];
      const b = world[owner === 'a' ? 'b' : 'a'];
      db.update(step).set({ buildId: b[rootKey] }).where(eq(step.id, a[stepKey])).run();
      const prior = [snapshotTeam(world, a), snapshotTeam(world, b)];
      const rejected = await report(a, a[stepKey], ...assignedReport);
      expect({
        status: rejected.status,
        teams: [snapshotTeam(world, a), snapshotTeam(world, b)],
      }).toEqual({
        status: 404,
        teams: prior,
      });
    },
  );
});

function sendTaskMessage(
  team: ScopeTeam,
  taskId: string,
  clientMessageId: string,
  content = 'fixture retry',
) {
  return fixtureRequest(team.server, 'POST', `/api/todos/${taskId}/messages`, {
    bearer: team.ownerToken,
    body: { content, clientMessageId },
  });
}

describe('durable receipt replay', () => {
  it('denies a foreign task receipt before replay', async () => {
    const { a, b, db } = world;
    const key = 'fixture-foreign-key';
    claimClientMessage(db, b.todoId, key, {
      todoId: b.todoId,
      conversationId: b.buildId,
      delivered: 'steer',
    });
    const prior = snapshotTeam(world, b);
    const denied = await sendTaskMessage(a, b.todoId, key);
    const missing = await sendTaskMessage(a, 'fixture-missing', key);
    expect(denied.status).toBe(404);
    expect(denied.status).toBe(missing.status);
    expect(JSON.stringify(await denied.json())).toBe(
      JSON.stringify(await missing.json()).replaceAll('fixture-missing', b.todoId),
    );
    expect(snapshotTeam(world, b)).toEqual(prior);
  });

  it('recovers nested-only receipts on both own listeners without delivering again', async () => {
    const { a, b, db } = world;
    const teams = [a, b];
    const key = 'fixture-client-key';
    const receipts = () => db.select().from(clientMessage).all();
    const contentFor = (team: ScopeTeam) => `Send from ${team.teamId}`;
    const nestedKeyFor = (team: ScopeTeam) => `nested:${team.todoId}:${key}`;
    const resultFor = (team: ScopeTeam) => ({
      todoId: team.todoId,
      conversationId: team.buildId,
      delivered: 'steer',
    });
    for (const team of teams) {
      await sendBuildSteer(
        team.server.svc,
        team.buildId,
        { content: contentFor(team), clientMessageId: nestedKeyFor(team) },
        { human: true },
      );
      expect(
        snapshotTeam(world, team).messages.filter((row) => row.content === contentFor(team)),
      ).toHaveLength(1);
      db.update(todo).set({ archivedAt: 9 }).where(eq(todo.id, team.todoId)).run();
    }
    const nested = receipts();
    expect(nested).toHaveLength(teams.length);
    expect(nested).toEqual(
      expect.arrayContaining(
        teams.map((team) =>
          expect.objectContaining({
            scopeId: team.buildId,
            clientMessageId: nestedKeyFor(team),
            response: expect.objectContaining({
              conversationId: team.buildId,
              delivered: 'steer',
              message: expect.objectContaining({ content: contentFor(team) }),
            }),
          }),
        ),
      ),
    );
    for (const [team, other] of [
      [a, b],
      [b, a],
    ] as const) {
      const before = snapshotTeam(world, team);
      const foreign = snapshotTeam(world, other);
      const chiefBefore = db.select().from(chiefMessage).all();
      const replay = await sendTaskMessage(team, team.todoId, key, contentFor(team));
      expect(replay.status).toBe(201);
      expect(await replay.json()).toEqual(resultFor(team));
      const chiefAfter = db.select().from(chiefMessage).all();
      const addedMarkers = chiefAfter.filter(({ id }) => !chiefBefore.some((row) => row.id === id));
      expect(addedMarkers).toEqual([
        expect.objectContaining({
          projectId: team.projectId,
          role: 'system',
          content: expect.any(String),
        }),
      ]);
      expect(JSON.parse(String(addedMarkers[0]?.content))).toMatchObject({
        kind: 'thread-message',
        ...resultFor(team),
      });
      expect(chiefAfter.filter((row) => !addedMarkers.includes(row))).toEqual(chiefBefore);
      expect(snapshotTeam(world, team)).toEqual(before);
      expect(snapshotTeam(world, other)).toEqual(foreign);
    }
    const settled = receipts();
    expect(settled).toHaveLength(teams.length * 2);
    expect(settled).toEqual(
      expect.arrayContaining([
        ...nested,
        ...teams.map((team) =>
          expect.objectContaining({
            scopeId: team.todoId,
            clientMessageId: key,
            response: resultFor(team),
          }),
        ),
      ]),
    );
  });

  const destinations = ['another team', 'another task in the same team'] as const;
  type ReceiptDestination = (typeof destinations)[number];

  function wrongBuildFor(destination: ReceiptDestination) {
    const { a, b, db } = world;
    if (destination === 'another team') return b.buildId;
    const otherTask = 'fixture-second-task';
    const otherBuild = 'fixture-second-build';
    db.insert(todo)
      .values({
        id: otherTask,
        teamId: a.teamId,
        projectId: a.projectId,
        title: otherTask,
        phase: 'building',
        phaseAt: 1,
        seqNum: 2,
        latestBuildId: otherBuild,
      })
      .run();
    db.insert(build)
      .values({
        id: otherBuild,
        todoId: otherTask,
        withPlan: false,
        triggerSource: 'user',
        createdAt: 1,
      })
      .run();
    return otherBuild;
  }

  const outerKey = 'fixture-outer-replay-key';

  async function prepareOuterReplay(destination: ReceiptDestination, archivedAt: number | null) {
    const { a, db } = world;
    const wrongBuild = wrongBuildFor(destination);
    if (archivedAt !== null) {
      db.update(todo).set({ archivedAt }).where(eq(todo.id, a.todoId)).run();
      const rejected = await sendTaskMessage(a, a.todoId, outerKey);
      expect(rejected.status).toBe(409);
      expect(await rejected.json()).toEqual({ error: 'Unarchive to continue' });
    }
    return wrongBuild;
  }

  function snapshotOuterReplay(otherBuildId: string) {
    const { a, b, db } = world;
    return {
      teams: [snapshotTeam(world, a), snapshotTeam(world, b)],
      build: db.select().from(build).where(eq(build.id, otherBuildId)).get(),
      messages: db.select().from(message).where(eq(message.conversationId, otherBuildId)).all(),
      chiefMessages: db.select().from(chiefMessage).all(),
      receipts: db.select().from(clientMessage).all(),
    };
  }

  it.each([
    { state: 'active', archivedAt: null, destination: destinations[0] },
    ...destinations.map((destination) => ({ state: 'archived', archivedAt: 9, destination })),
  ])(
    'replays a committed outer receipt without delivering again ($state, build from $destination also exists)',
    async ({ archivedAt, destination }) => {
      const { a, db } = world;
      const otherBuild = await prepareOuterReplay(destination, archivedAt);
      const result = { todoId: a.todoId, conversationId: a.buildId, delivered: 'steer' };
      claimClientMessage(db, a.todoId, outerKey, result);
      const before = snapshotOuterReplay(otherBuild);
      expect(before.receipts).toEqual([
        expect.objectContaining({ scopeId: a.todoId, clientMessageId: outerKey, response: result }),
      ]);

      const replay = await sendTaskMessage(a, a.todoId, outerKey);
      expect(replay.status).toBe(201);
      expect(await replay.json()).toEqual(result);
      expect(snapshotOuterReplay(otherBuild)).toEqual(before);
    },
  );

  async function prepareNestedReplay(destination: ReceiptDestination, misbound: boolean) {
    const { a, db } = world;
    const wrongBuild = wrongBuildFor(destination);
    const key = 'fixture-nested-misbound-key';
    const nestedKey = `nested:${a.todoId}:${key}`;
    const content = `Send from ${a.teamId}`;
    const sent = await sendBuildSteer(
      a.server.svc,
      a.buildId,
      { content, clientMessageId: nestedKey },
      { human: true },
    );
    const response = { ...sent, conversationId: misbound ? wrongBuild : a.buildId };
    completeClientMessage(db, a.buildId, nestedKey, response);
    db.update(todo).set({ archivedAt: 9 }).where(eq(todo.id, a.todoId)).run();
    return { wrongBuild, key, nestedKey, content, response };
  }

  it.each(destinations)(
    'recovers an owned nested receipt with the same archived state and a build from %s',
    async (destination) => {
      const { a, b, db } = world;
      const { key, content } = await prepareNestedReplay(destination, false);
      const before = [snapshotTeam(world, a), snapshotTeam(world, b)];
      const receipts = db.select().from(clientMessage).all();
      const markers = db.select().from(chiefMessage).all();
      const replay = await sendTaskMessage(a, a.todoId, key, content);
      expect(replay.status).toBe(201);
      const result = { todoId: a.todoId, conversationId: a.buildId, delivered: 'steer' };
      expect(await replay.json()).toEqual(result);
      expect([snapshotTeam(world, a), snapshotTeam(world, b)]).toEqual(before);
      const after = db.select().from(clientMessage).all();
      expect(after).toHaveLength(receipts.length + 1);
      expect(after).toEqual(
        expect.arrayContaining([
          ...receipts,
          expect.objectContaining({ scopeId: a.todoId, clientMessageId: key, response: result }),
        ]),
      );
      const added = db
        .select()
        .from(chiefMessage)
        .all()
        .filter(({ id }) => !markers.some((row) => row.id === id));
      expect(added).toHaveLength(1);
      expect(JSON.parse(String(added[0]?.content))).toMatchObject({
        kind: 'thread-message',
        ...result,
      });
    },
  );

  it.fails.each(destinations)(
    'nested-only receipt replay returns and commits the response build of %s',
    async (destination) => {
      const { a, b, db } = world;
      const { wrongBuild, key, nestedKey, content, response } = await prepareNestedReplay(
        destination,
        true,
      );
      const snapshot = () => ({
        own: snapshotTeam(world, a),
        foreign: snapshotTeam(world, b),
        wrongMessages: db
          .select()
          .from(message)
          .where(eq(message.conversationId, wrongBuild))
          .all(),
        chiefMessages: db.select().from(chiefMessage).all(),
        receipts: db.select().from(clientMessage).all(),
      });
      const before = snapshot();
      expect(before.receipts).toEqual([
        expect.objectContaining({ scopeId: a.buildId, clientMessageId: nestedKey, response }),
      ]);
      const replay = await sendTaskMessage(a, a.todoId, key, content);
      const after = snapshot();
      expect({
        status: replay.status,
        body: await replay.json(),
        outerReceipts: after.receipts.filter(({ scopeId }) => scopeId === a.todoId).length,
        chiefMarkersAdded: after.chiefMessages.length - before.chiefMessages.length,
      }).toEqual({
        status: 409,
        body: { error: 'Unarchive to continue' },
        outerReceipts: 0,
        chiefMarkersAdded: 0,
      });
      expect(after).toEqual(before);
    },
  );

  it.fails.each(destinations)(
    'outer receipt replay returns the response build of %s',
    async (destination) => {
      const { a, db } = world;
      const wrongBuild = await prepareOuterReplay(destination, 9);
      claimClientMessage(db, a.todoId, outerKey, {
        todoId: a.todoId,
        conversationId: wrongBuild,
        delivered: 'steer',
      });
      const before = snapshotOuterReplay(wrongBuild);
      const replay = await sendTaskMessage(a, a.todoId, outerKey);
      expect({
        status: replay.status,
        body: await replay.json(),
        state: snapshotOuterReplay(wrongBuild),
      }).toEqual({
        status: 409,
        body: { error: 'Unarchive to continue' },
        state: before,
      });
    },
  );
});

async function teamStream(team: ScopeTeam) {
  const response = await fixtureRequest(team.server, 'GET', `/api/teams/${team.teamId}/stream`, {
    bearer: team.deviceToken,
  });
  expect(response.status).toBe(200);
  const reader = response.body?.getReader();
  if (reader === undefined) throw new Error('Fixture stream must have a body');
  const decoder = new TextDecoder();
  let buffer = '';
  return {
    async next() {
      while (!buffer.includes('\n\n')) {
        const read = await reader.read();
        if (read.done) throw new Error('Fixture stream closed before a frame');
        buffer += decoder.decode(read.value, { stream: true });
      }
      const end = buffer.indexOf('\n\n');
      const line = buffer
        .slice(0, end)
        .split('\n')
        .find((value) => value.startsWith('data:'));
      buffer = buffer.slice(end + 2);
      if (line === undefined) throw new Error('Fixture stream frame has no data');
      return JSON.parse(line.slice(5)) as {
        type: string;
        connectionId?: string;
        conversationId?: string;
      };
    },
    close: () => reader.cancel(),
  };
}

async function subscribe(team: ScopeTeam, connectionId: string, conversationIds: string[]) {
  return fixtureRequest(team.server, 'PUT', `/api/streams/${connectionId}/conversations`, {
    bearer: team.deviceToken,
    body: { conversationIds },
  });
}

describe('publication and subscriptions', () => {
  it('delivers and unsubscribes an owned multiplex conversation', async () => {
    const { a, b } = world;
    const stream = await teamStream(a);
    try {
      const hello = await stream.next();
      if (hello.type !== 'hello' || hello.connectionId === undefined)
        throw new Error('Fixture stream did not open');
      expect((await stream.next()).type).toBe('ping');
      expect((await subscribe(a, hello.connectionId, [a.buildId])).status).toBe(204);
      expect((await report(a, a.stepId, 'fixture-sse-own', 'fixture live frame')).status).toBe(200);
      expect(await stream.next()).toMatchObject({
        type: 'conversation',
        conversationId: a.buildId,
      });
      expect((await subscribe(a, hello.connectionId, [])).status).toBe(204);
      expect(a.server.convHub.subscriberCount(a.buildId)).toBe(0);
      expect(a.server.convHub.subscriberCount(b.buildId)).toBe(0);
    } finally {
      await stream.close();
    }
  });

  it.fails('multiplex subscription opens foreign and missing conversation buffers', async () => {
    const { a, b } = world;
    const stream = await teamStream(a);
    try {
      const hello = await stream.next();
      if (hello.type !== 'hello' || hello.connectionId === undefined)
        throw new Error('Fixture stream did not open');
      expect(
        (await subscribe(a, hello.connectionId, [a.buildId, b.buildId, 'fixture-missing'])).status,
      ).toBe(204);
      expect(
        [a.buildId, b.buildId, 'fixture-missing'].map((id) => a.server.convHub.subscriberCount(id)),
      ).toEqual([1, 0, 0]);
    } finally {
      await stream.close();
    }
  });

  it('publishes an owned task update only to its own team', () => {
    const { a, b } = world;
    const ownFrames: object[] = [];
    const foreignFrames: object[] = [];
    const hub = a.server.hub;
    const leaveA = hub.subscribe(a.teamId, {
      nextSeq: () => 1,
      send: async (frame) => {
        ownFrames.push(frame);
      },
    });
    const leaveB = hub.subscribe(b.teamId, {
      nextSeq: () => 1,
      send: async (frame) => {
        foreignFrames.push(frame);
      },
    });
    try {
      const owned = getTodo(a.server.svc, a.todoId);
      if (owned === null) throw new Error('Fixture task missing');
      hub.publishTodoDoc(a.teamId, owned);
      expect(ownFrames).toEqual([
        expect.objectContaining({ doc: expect.objectContaining({ id: a.todoId }) }),
      ]);
      expect(foreignFrames).toEqual([]);
    } finally {
      leaveA();
      leaveB();
    }
  });

  function publishTeamBTodo(destination: ScopeTeam) {
    const { a, b } = world;
    const frames: object[] = [];
    const hub = a.server.hub;
    const unsubscribe = hub.subscribe(destination.teamId, {
      nextSeq: () => 1,
      send: async (frame) => {
        frames.push(frame);
      },
    });
    try {
      const doc = getTodo(b.server.svc, b.todoId);
      if (doc === null) throw new Error('Fixture task missing');
      hub.publishTodoDoc(destination.teamId, doc);
      return frames;
    } finally {
      unsubscribe();
    }
  }

  it('raw publication delivers a task document to its own team destination', () => {
    const { b } = world;
    expect(publishTeamBTodo(b)).toEqual([
      expect.objectContaining({ doc: expect.objectContaining({ id: b.todoId }) }),
    ]);
  });

  it.fails('raw publication delivers foreign task content to a different team destination', () => {
    expect(publishTeamBTodo(world.a)).toEqual([]);
  });
});

describe('step retirement and legacy triggers', () => {
  const transitions = [
    {
      name: 'release',
      run: ({ a, db }: ScopeWorld) =>
        db.update(step).set({ status: 'done' }).where(eq(step.id, a.stepId)).run(),
    },
    {
      name: 'parent deletion',
      run: ({ a }: ScopeWorld) =>
        fixtureRequest(a.server, 'DELETE', `/api/todos/${a.todoId}`, { bearer: a.ownerToken }),
    },
  ];

  function stepKey(team: ScopeTeam, ownerStepId: string) {
    const id = `fixture-step-key-${team.teamId}`;
    world.db
      .insert(apiKey)
      .values({
        id,
        teamId: team.teamId,
        name: `git-step-${ownerStepId}`,
        keyHash: id,
        masked: 'fixture',
        gitAccess: true,
        mcpAccess: false,
        machineAccess: false,
        toolGrants: { read: [], write: [] },
        createdAt: 1,
      })
      .run();
    return () => world.db.select().from(apiKey).where(eq(apiKey.id, id)).get();
  }

  it.each(transitions)(
    '$name revokes the owned step key and preserves a key for another step',
    async ({ run }) => {
      const { a, b } = world;
      const owned = stepKey(a, a.stepId);
      const foreign = stepKey(b, b.stepId);
      const before = foreign();
      expect(owned()).toBeDefined();
      expect(before).toBeDefined();
      await run(world);
      expect(owned()).toBeUndefined();
      expect(foreign()).toEqual(before);
    },
  );

  it.fails.each(transitions)(
    '$name revokes a foreign key based on its name alone',
    async ({ run }) => {
      const { a, b } = world;
      const owned = stepKey(a, a.stepId);
      const foreign = stepKey(b, a.stepId);
      const before = foreign();
      expect(before).toBeDefined();
      await run(world);
      expect(owned()).toBeUndefined();
      expect(foreign()).toEqual(before);
    },
  );

  function backgroundTask(
    team: ScopeTeam,
    stepId: string,
    name: string,
    status: 'running' | 'done',
  ) {
    const { db } = world;
    const id = `bg-${stepId}-${name}`;
    db.insert(message)
      .values({
        id,
        conversationId: team.buildId,
        role: 'assistant',
        content: { kind: 'bg_task', task: { status } },
        createdAt: 1,
      })
      .run();
    return () => db.select().from(message).where(eq(message.id, id)).get();
  }

  it('step release orphans its own running background task and preserves settled tasks', () => {
    const { a, db } = world;
    const running = backgroundTask(a, a.stepId, 'owned', 'running');
    const settled = backgroundTask(a, a.stepId, 'settled', 'done');
    expect(running()?.content).toMatchObject({ task: { status: 'running' } });
    const settledBefore = settled();
    expect(settledBefore?.content).toMatchObject({ task: { status: 'done' } });
    db.update(step).set({ status: 'done' }).where(eq(step.id, a.stepId)).run();
    expect(running()?.content).toMatchObject({
      task: { status: 'orphaned', endedAt: expect.any(Number) },
    });
    expect(settled()).toEqual(settledBefore);
  });

  it.fails('step release orphans a foreign background task by client-row prefix alone', () => {
    const { a, b, db } = world;
    const foreign = backgroundTask(b, a.stepId, 'foreign', 'running');
    const before = foreign();
    expect(before?.content).toMatchObject({ task: { status: 'running' } });
    db.update(step).set({ status: 'done' }).where(eq(step.id, a.stepId)).run();
    expect(foreign()).toEqual(before);
  });
});

function seedGateVerdict(buildId: string, stepId: string) {
  world.db
    .insert(gateVerdict)
    .values({
      stepId,
      buildId,
      kind: 'review',
      outcome: 'tampered',
      expectedHeadSha: 'fixture-head',
      createdAt: 3,
    })
    .run();
}

function seedWatchdogGateReviews() {
  const { a, b, db } = world;
  for (const team of [a, b]) seedGateVerdict(team.buildId, team.stepId);
  db.update(todo).set({ phase: 'done' }).where(eq(todo.id, b.todoId)).run();
}

describe('watchdog inputs and notification ownership', () => {
  it('uses an owned gate result without notifying the unrelated team', () => {
    const { a, b, db } = world;
    seedWatchdogGateReviews();
    expect(sweepWorkerWatchdog(a.server.svc, 4)).toBe(1);
    expect(db.select().from(notification).all()).toEqual([
      expect.objectContaining({
        teamId: a.teamId,
        entityId: a.todoId,
        userId: a.userId,
        type: 'watchdog_flag',
      }),
    ]);
    expect(snapshotTeam(world, b).todo?.latestBuildId).toBe(b.buildId);
  });

  it.fails('watchdog reads a foreign gate verdict through a contradictory latest-build link', () => {
    const { a, b, db } = world;
    seedWatchdogGateReviews();
    db.update(todo).set({ latestBuildId: b.buildId }).where(eq(todo.id, a.todoId)).run();
    const flags = sweepWorkerWatchdog(a.server.svc, 4);
    expect({ flags, notices: db.select().from(notification).all() }).toEqual({
      flags: 0,
      notices: [],
    });
  });

  it.fails.each(['foreign-team build', 'same-team earlier build'] as const)(
    'watchdog uses a verdict for the right build when its step belongs to a %s',
    (producer) => {
      const { a, b, db } = world;
      db.update(todo).set({ phase: 'done' }).where(eq(todo.id, b.todoId)).run();
      if (producer === 'same-team earlier build') {
        db.insert(build)
          .values({
            id: 'fixture-earlier-build',
            todoId: a.todoId,
            withPlan: false,
            triggerSource: 'user',
            createdAt: 1,
          })
          .run();
        db.update(step)
          .set({ buildId: 'fixture-earlier-build' })
          .where(eq(step.id, a.stepId))
          .run();
      }
      seedGateVerdict(a.buildId, producer === 'foreign-team build' ? b.stepId : a.stepId);
      const flags = sweepWorkerWatchdog(a.server.svc, 4);
      expect({ flags, notices: db.select().from(notification).all() }).toEqual({
        flags: 0,
        notices: [],
      });
    },
  );

  it('does not count or copy another task’s repeated failures into a local notification', () => {
    const { a, b, db } = world;
    const addFailures = (team: ScopeTeam, snippet: string, count: number) => {
      for (let index = 0; index < count; index += 1) {
        db.insert(build)
          .values({
            id: `fixture-failure-${team.teamId}-${index}`,
            todoId: team.todoId,
            errorMessage: snippet,
            withPlan: false,
            triggerSource: 'user',
            createdAt: 2,
          })
          .run();
      }
    };
    db.update(todo).set({ phase: 'done' }).where(eq(todo.id, b.todoId)).run();
    addFailures(b, 'fixture foreign failure', 3);
    addFailures(a, 'fixture own failure', 2);
    expect(sweepWorkerWatchdog(a.server.svc, 4)).toBe(0);
    expect(db.select().from(notification).all()).toEqual([]);
    db.update(build)
      .set({ errorMessage: 'fixture own failure' })
      .where(eq(build.id, a.buildId))
      .run();
    expect(sweepWorkerWatchdog(a.server.svc, 5)).toBe(1);
    const notices = db.select().from(notification).all();
    expect(notices).toEqual([
      expect.objectContaining({
        teamId: a.teamId,
        snippet: expect.stringContaining('fixture own failure'),
      }),
    ]);
    expect(JSON.stringify(notices)).not.toContain('fixture foreign failure');
  });
});
