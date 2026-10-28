import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { afterEach, expect, test } from 'vitest';
import {
  agent,
  build,
  machine,
  message,
  project,
  team,
  todo,
} from '../../apps/server/src/db/schema.js';
import { sha256Hex } from '../../apps/server/src/lib/crypto.js';
import { bootServer } from '../../apps/server/test/helpers.js';
import { HarborSubmission } from '../eval/harbor/submission.mts';

const servers: ReturnType<typeof bootServer>[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) {
    server.dispose();
  }
});

function world() {
  const serverToken = randomUUID();
  const machineToken = randomUUID();
  const s = bootServer({ authToken: serverToken });
  servers.push(s);
  s.db.insert(team).values({ id: 'other-team', name: 'Other', createdAt: Date.now() }).run();
  s.db
    .insert(project)
    .values([
      { id: 'first', name: 'First', teamId: s.team.id },
      { id: 'second', name: 'Second', teamId: s.team.id },
      { id: 'foreign', name: 'Foreign', teamId: 'other-team' },
    ])
    .run();
  s.db
    .insert(machine)
    .values({
      id: 'harbor-machine',
      teamId: s.team.id,
      name: 'Harbor',
      tokenHash: sha256Hex(machineToken),
      online: true,
    })
    .run();
  s.db
    .insert(agent)
    .values({
      id: 'harbor-agent',
      teamId: s.team.id,
      displayName: 'Harbor',
      machineId: 'harbor-machine',
    })
    .run();
  const env: Record<string, string> = {
    CAIRN_SERVER_URL: 'http://harbor.test',
    CAIRN_SERVER_TOKEN: serverToken,
    CAIRN_MACHINE_TOKEN: machineToken,
    CAIRN_MACHINE_ID: 'harbor-machine',
    CAIRN_TEAM_ID: s.team.id,
    CAIRN_PROJECT_ID: 'second',
    CAIRN_AGENT_ID: 'harbor-agent',
  };
  const fetcher: typeof fetch = async (input, init) => s.app.request(String(input), init);
  return { s, env, fetcher, serverToken, machineToken };
}

test('authenticated submission selects the second project and polls all three real routes', async () => {
  const { s, env, fetcher, serverToken, machineToken } = world();
  const client = new HarborSubmission(env, fetcher);
  const task = await client.submit('Create the requested file.');
  expect(
    s.db
      .select()
      .from(todo)
      .all()
      .map((row) => row.projectId),
  ).toEqual(['second']);
  expect(
    s.db
      .select()
      .from(build)
      .all()
      .map((row) => row.todoId),
  ).toEqual([task.todoId]);
  s.db.update(todo).set({ phase: 'review' }).where(eq(todo.id, task.todoId)).run();
  s.db
    .insert(message)
    .values({
      id: 'result-message',
      conversationId: task.buildId,
      role: 'assistant',
      content: `Completed ${serverToken} ${machineToken}`,
      createdAt: Date.now(),
    })
    .run();
  const result = await client.poll(task, { timeoutMs: 1000, intervalMs: 1 });
  expect(result.todo.id).toBe(task.todoId);
  expect(result.build.id).toBe(task.buildId);
  expect(result.messages.messages).toHaveLength(1);
  expect(result.timedOut).toBe(false);
  const artifact = JSON.stringify({ task, result, outcomes: client.outcomes });
  expect(artifact).not.toContain(serverToken);
  expect(artifact).not.toContain(machineToken);
  expect(client.outcomes.map((row) => row.status)).toEqual([200, 200, 201, 201, 200, 200, 200]);
  if (process.env.HARBOR_EVIDENCE_PATH) {
    writeFileSync(
      process.env.HARBOR_EVIDENCE_PATH,
      JSON.stringify({ task, outcomes: client.outcomes }, null, 2),
    );
  }
});

test.each(['', 'incorrect', 'machine'])(
  'server credential %j fails before creating records',
  async (credential) => {
    const { s, env, fetcher, machineToken } = world();
    env.CAIRN_SERVER_TOKEN = credential === 'machine' ? machineToken : credential;
    await expect(async () => new HarborSubmission(env, fetcher).submit('Task')).rejects.toThrow(
      /CAIRN_SERVER_TOKEN|HTTP 401/,
    );
    expect(s.db.select().from(todo).all()).toEqual([]);
    expect(s.db.select().from(build).all()).toEqual([]);
  },
);

test.each(['', 'incorrect', 'server'])(
  'machine credential %j fails independently',
  async (credential) => {
    const { s, env, fetcher, serverToken } = world();
    env.CAIRN_MACHINE_TOKEN = credential === 'server' ? serverToken : credential;
    await expect(async () => new HarborSubmission(env, fetcher).submit('Task')).rejects.toThrow(
      /CAIRN_MACHINE_TOKEN|HTTP 401/,
    );
    expect(s.db.select().from(todo).all()).toEqual([]);
    expect(s.db.select().from(build).all()).toEqual([]);
  },
);

test.each(['', 'nonexistent', 'foreign'])(
  'project configuration %j never falls back',
  async (projectId) => {
    const { s, env, fetcher } = world();
    env.CAIRN_PROJECT_ID = projectId;
    await expect(async () => new HarborSubmission(env, fetcher).submit('Task')).rejects.toThrow(
      /CAIRN_PROJECT_ID/,
    );
    expect(s.db.select().from(todo).all()).toEqual([]);
    expect(s.db.select().from(build).all()).toEqual([]);
  },
);

test('configured team and machine identity must match the authenticated machine', async () => {
  const { s, env, fetcher } = world();
  for (const key of ['CAIRN_TEAM_ID', 'CAIRN_MACHINE_ID'] as const) {
    await expect(
      new HarborSubmission({ ...env, [key]: 'other' }, fetcher).submit('Task'),
    ).rejects.toThrow(/machine identity/);
  }
  expect(s.db.select().from(todo).all()).toEqual([]);
});

test('polling does not promote a machine credential to server authentication', async () => {
  const { env, fetcher, machineToken } = world();
  const task = await new HarborSubmission(env, fetcher).submit('Task');
  await expect(
    new HarborSubmission({ ...env, CAIRN_SERVER_TOKEN: machineToken }, fetcher).poll(task),
  ).rejects.toThrow('HTTP 401');
});

test('serializing the submission boundary cannot collect credentials', () => {
  const { env, fetcher, serverToken, machineToken } = world();
  const artifact = JSON.stringify(new HarborSubmission(env, fetcher));
  expect(artifact).not.toContain(serverToken);
  expect(artifact).not.toContain(machineToken);
});

test.each([undefined, 'incorrect'])('real server routes reject credential %j', async (token) => {
  const { s } = world();
  for (const path of [
    '/api/projects',
    '/api/todos/absent',
    '/api/builds/absent',
    '/api/conversations/absent/messages',
  ]) {
    const response = await s.app.request(path, {
      headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(401);
  }
  expect(s.db.select().from(todo).all()).toEqual([]);
  expect(s.db.select().from(build).all()).toEqual([]);
});

test('a rejected build retains the already created todo ID without secrets', async () => {
  const { s, env, fetcher, serverToken, machineToken } = world();
  const client = new HarborSubmission(env, async (input, init) => {
    if (String(input).endsWith('/builds')) return new Response(null, { status: 503 });
    return fetcher(input, init);
  });
  await expect(client.submit('Task')).rejects.toThrow('HTTP 503');
  expect(client.created).toEqual({ todoId: s.db.select().from(todo).get()?.id });
  expect(s.db.select().from(build).all()).toEqual([]);
  const artifact = JSON.stringify(client);
  expect(artifact).not.toContain(serverToken);
  expect(artifact).not.toContain(machineToken);
  expect(client.outcomes.at(-1)?.status).toBe(503);
});
