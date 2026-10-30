import { chiefIdFormat, orchestrationSourceRef } from '@cairn/shared';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { eq } from 'drizzle-orm';
import { describe, expect, onTestFinished, test, vi } from 'vitest';
import {
  agent,
  build,
  chief,
  chiefMessage,
  chiefThread,
  message,
  project,
  queuedMessage,
  steerPending,
  step,
  team,
  todo,
} from '../src/db/schema.js';
import { createApiKey } from '../src/services/api-keys.js';
import { patchChief, sendChiefMessage } from '../src/services/chief.js';
import { createOrGetQuestion } from '../src/services/chief-questions.js';
import { bootServer, postProject, type TestServer } from './helpers.js';

const READ = ['Threads Waiting on Me', 'Read Thread', 'Thread Pull Requests'];
const WRITE = ['Start Thread', 'Reply Thread'];
const NAMES = [
  'start_thread',
  'threads_waiting_on_me',
  'read_thread',
  'reply_thread',
  'thread_pull_requests',
];

async function connect(s: TestServer, read = READ, write = WRITE, teamId = s.team.id) {
  const key = createApiKey(s, {
    teamId,
    name: 'Thread test',
    gitAccess: false,
    mcpAccess: true,
    toolGrants: { read, write },
  });
  const client = new Client({ name: 'Thread acceptance client', version: '1' });
  onTestFinished(() => client.close());
  await client.connect(
    new StreamableHTTPClientTransport(new URL('http://localhost/api/mcp'), {
      requestInit: { headers: { Authorization: `Bearer ${key.plaintext}` } },
      fetch: (input, init) => Promise.resolve(s.app.request(new Request(input, init))),
    }),
  );
  return client;
}

interface ThreadResponse {
  thread: { id: string; projectId: string | null; status: string; coordinatorId?: string };
  conversation: { messages: { content: string }[]; truncated: boolean; nextBefore: string | null };
  questions: { requestId: string; status: string }[];
  steered?: boolean;
}

async function call<T = ThreadResponse>(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const result = await client.callTool({ name, arguments: args });
  expect(result.isError, JSON.stringify(result)).not.toBe(true);
  const content = result.content as { type: string; text: string }[];
  return JSON.parse(content[0]!.text) as T;
}

function bindCoordinator(s: TestServer, teamId = s.team.id) {
  const agentId = `coordinator-${teamId}`;
  s.db
    .insert(agent)
    .values({ id: agentId, teamId, displayName: 'Coordinator', provider: 'test', modelId: 'test' })
    .run();
  patchChief(s.svc, teamId, { agent: { agentId } });
}

async function world() {
  const s = bootServer();
  bindCoordinator(s);
  const projectId = await postProject(s.app);
  const client = await connect(s);
  const started = await call(client, 'start_thread', { projectId, content: 'Improve the Project' });
  return { s, client, projectId, threadId: started.thread.id as string };
}

function insertWork(
  s: TestServer,
  projectId: string,
  id: string,
  phase: 'review' | 'building' = 'review',
) {
  s.db
    .insert(todo)
    .values({
      id,
      teamId: s.team.id,
      projectId,
      title: id,
      phase,
      phaseAt: 1,
      seqNum: s.db.select().from(todo).all().length + 1,
      latestBuildId: `run-${id}`,
      ownerId: s.user.id,
    })
    .run();
  s.db
    .insert(build)
    .values({ id: `run-${id}`, todoId: id, withPlan: false, triggerSource: 'user', createdAt: 1 })
    .run();
}

describe('Coordinator terminal entry through an MCP client', () => {
  test('starts a Project Thread, reads status, and queues a reply with the original Project', async () => {
    const { s, client, projectId, threadId } = await world();
    const listed = await client.listTools();
    expect(listed.tools.map((t) => t.name).sort()).toEqual([...NAMES].sort());
    expect(listed.tools.find((t) => t.name === 'start_thread')?.description).toContain(
      'Coordinator',
    );
    expect(listed.tools.find((t) => t.name === 'start_thread')?.description).toContain('Project');
    for (const tool of listed.tools) expect(tool.description).toContain('Thread');
    const read = await call(client, 'read_thread', { threadId });
    expect(read.thread).toMatchObject({ id: threadId, projectId, status: 'working' });
    expect(read.conversation.messages[0]?.content).toBe('Improve the Project');
    expect(JSON.stringify(read)).not.toContain('sessionId');
    await call(client, 'reply_thread', { threadId, content: 'Keep the public API' });
    const stored = s.db
      .select()
      .from(chiefMessage)
      .where(eq(chiefMessage.threadId, threadId))
      .all();
    expect(stored.map((m) => m.projectId)).toEqual([projectId, projectId]);
    const turns = s.db.select().from(step).where(eq(step.buildId, threadId)).all();
    expect(turns).toHaveLength(2);
    expect(turns[1]!.prompt).toContain(projectId);
    expect(turns[1]!.prompt).toContain('Keep the public API');
  });

  test('steers the running Coordinator only when explicitly requested', async () => {
    const { s, client, threadId } = await world();
    s.db.update(step).set({ status: 'claimed' }).where(eq(step.buildId, threadId)).run();
    await call(client, 'reply_thread', { threadId, content: 'Later' });
    expect(s.db.select().from(steerPending).all()).toHaveLength(0);
    const reply = await call(client, 'reply_thread', {
      threadId,
      content: 'Change direction',
      mode: 'steer',
    });
    expect(reply.steered).toBe(true);
    expect(s.db.select().from(steerPending).get()?.content).toContain('Change direction');
  });

  test('lists pending questions and work gates, answers a question, and omits settled work', async () => {
    const { s, client, projectId, threadId } = await world();
    createOrGetQuestion(s.svc, {
      threadId,
      requestId: 'question-one',
      questions: [{ header: 'Scope', question: 'Which API?', options: [] }],
    });
    insertWork(s, projectId, 'needs-review');
    insertWork(s, projectId, 'working', 'building');
    insertWork(s, projectId, 'archived');
    s.db.update(todo).set({ archivedAt: 10 }).where(eq(todo.id, 'archived')).run();
    insertWork(s, projectId, 'resolved');
    s.db.update(todo).set({ phase: 'done' }).where(eq(todo.id, 'resolved')).run();
    const waiting = await call<{ id: string }[]>(client, 'threads_waiting_on_me', { projectId });
    expect(waiting.map((t: { id: string }) => t.id).sort()).toEqual(
      [threadId, 'needs-review'].sort(),
    );
    const read = await call(client, 'read_thread', { threadId });
    expect(read.thread.status).toBe('waiting_on_you');
    expect(read.questions[0]).toMatchObject({ requestId: 'question-one', status: 'pending' });
    await call(client, 'reply_thread', {
      threadId,
      requestId: 'question-one',
      answers: [{ header: 'Scope', text: 'The public API' }],
    });
    const after = await call<{ id: string }[]>(client, 'threads_waiting_on_me', {});
    expect(after.map((t: { id: string }) => t.id)).toEqual(['needs-review']);
    const duplicate = await client.callTool({
      name: 'reply_thread',
      arguments: {
        threadId,
        requestId: 'question-one',
        answers: [{ header: 'Scope', text: 'Again' }],
      },
    });
    expect(duplicate.isError).toBe(true);
  });

  test('reads and steers a work Thread and returns only its persisted PR links', async () => {
    const { s, client, projectId, threadId } = await world();
    insertWork(s, projectId, 'work');
    insertWork(s, projectId, 'unrelated');
    s.db
      .update(todo)
      .set({ sourceKind: 'orchestration', sourceRef: orchestrationSourceRef(threadId) })
      .where(eq(todo.id, 'work'))
      .run();
    expect(await call(client, 'thread_pull_requests', { threadId })).toEqual([]);
    s.db
      .update(build)
      .set({ prUrl: 'https://github.com/example/project/pull/1', prNumber: 1 })
      .where(eq(build.id, 'run-work'))
      .run();
    s.db
      .update(build)
      .set({ prUrl: 'https://github.com/example/project/pull/2', prNumber: 2 })
      .where(eq(build.id, 'run-unrelated'))
      .run();
    s.db
      .insert(message)
      .values({
        id: 'worker-message',
        conversationId: 'run-work',
        role: 'assistant',
        content: 'Ready',
        createdAt: 1,
      })
      .run();
    const read = await call(client, 'read_thread', { threadId: 'work' });
    expect(read.thread).toMatchObject({ id: 'work', projectId, status: 'review' });
    expect(read.conversation.messages[0]?.content).toBe('Ready');
    const links = await call(client, 'thread_pull_requests', { threadId });
    expect(links).toEqual([
      {
        threadId: 'work',
        buildId: 'run-work',
        prUrl: 'https://github.com/example/project/pull/1',
        prNumber: 1,
      },
    ]);
    expect(await call(client, 'thread_pull_requests', { threadId: 'work' })).toEqual(links);
    s.db
      .insert(step)
      .values({
        id: 'running-work',
        buildId: 'run-work',
        kind: 'build',
        status: 'claimed',
        createdAt: 1,
      })
      .run();
    await call(client, 'reply_thread', { threadId: 'work', content: 'Fix the API', mode: 'steer' });
    expect(
      s.db.select().from(steerPending).where(eq(steerPending.conversationId, 'run-work')).get()
        ?.content,
    ).toBe('Fix the API');
  });

  test('rejects blank input and an unconfigured Coordinator without creating a Thread', async () => {
    const s = bootServer();
    const projectId = await postProject(s.app);
    const client = await connect(s);
    for (const content of ['', '   ', 'Valid request']) {
      const result = await client.callTool({
        name: 'start_thread',
        arguments: { projectId, content },
      });
      expect(result.isError).toBe(true);
      expect(s.db.select().from(chiefThread).all()).toHaveLength(0);
      expect(s.db.select().from(chiefMessage).all()).toHaveLength(0);
    }
  });

  test('keeps replies in their selected Project even when message timestamps tie', async () => {
    const { s, client, threadId } = await world();
    const otherProject = await postProject(s.app, 'Other Project');
    await call(client, 'reply_thread', {
      threadId,
      projectId: otherProject,
      content: 'Use this Project',
    });
    s.db
      .update(chiefMessage)
      .set({ createdAt: 1 })
      .where(eq(chiefMessage.threadId, threadId))
      .run();
    await call(client, 'reply_thread', { threadId, content: 'Continue here' });
    const latest = s.db.select().from(chiefMessage).all().at(-1);
    expect(latest).toMatchObject({ projectId: otherProject, content: 'Continue here' });
    expect((await call(client, 'read_thread', { threadId })).thread.projectId).toBe(otherProject);
  });

  test('queues work replies and rejects messages without a run or with ambiguous answer arguments', async () => {
    const { s, client, projectId, threadId } = await world();
    insertWork(s, projectId, 'queued-work', 'building');
    s.db
      .insert(step)
      .values({
        id: 'queued-work-step',
        buildId: 'run-queued-work',
        kind: 'build',
        status: 'claimed',
        createdAt: 1,
      })
      .run();
    await call(client, 'reply_thread', { threadId: 'queued-work', content: 'After this turn' });
    expect(s.db.select().from(queuedMessage).get()?.content).toBe('After this turn');
    expect(s.db.select().from(steerPending).all()).toEqual([]);
    insertWork(s, projectId, 'no-run');
    s.db.update(todo).set({ latestBuildId: null }).where(eq(todo.id, 'no-run')).run();
    const noRun = await call(client, 'read_thread', { threadId: 'no-run' });
    expect(noRun.conversation.messages).toEqual([]);
    const before = s.db.select().from(chiefMessage).all();
    for (const args of [
      { threadId, content: '   ' },
      { threadId },
      { threadId, requestId: 'missing' },
      {
        threadId,
        requestId: 'missing',
        answers: [{ header: 'Scope', text: 'Yes' }],
        content: 'Both',
      },
      { threadId: 'no-run', content: 'Run' },
    ]) {
      const result = await client.callTool({ name: 'reply_thread', arguments: args });
      expect(result.isError).toBe(true);
    }
    expect(s.db.select().from(chiefMessage).all()).toEqual(before);
  });

  test('each new grant exposes exactly one matching tool', async () => {
    const s = bootServer();
    for (const [grant, name] of [
      ['Start Thread', 'start_thread'],
      ['Reply Thread', 'reply_thread'],
      ['Read Thread', 'read_thread'],
      ['Threads Waiting on Me', 'threads_waiting_on_me'],
      ['Thread Pull Requests', 'thread_pull_requests'],
    ]) {
      const read = READ.includes(grant!) ? [grant!] : [];
      const write = WRITE.includes(grant!) ? [grant!] : [];
      const client = await connect(s, read, write);
      expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual([name]);
    }
  });

  test('write Thread grants in the read column neither register nor authorize write tools', async () => {
    const s = bootServer();
    const client = await connect(s, ['Projects', ...WRITE], []);
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(['projects']);
    for (const name of ['start_thread', 'reply_thread']) {
      const result = await client.callTool({
        name,
        arguments: { projectId: 'missing', threadId: 'missing', content: 'Denied' },
      });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result)).toContain('not found');
    }
    expect(s.db.select().from(chiefThread).all()).toEqual([]);
  });

  test.each(['start', 'coordinator reply', 'work queue', 'work steer'] as const)(
    '%s bounds content before creating messages or turns',
    async (entry) => {
      const { s, client, projectId, threadId } = await world();
      insertWork(s, projectId, 'bounded-work', 'building');
      s.db
        .insert(step)
        .values({
          id: 'bounded-step',
          buildId: 'run-bounded-work',
          kind: 'build',
          status: 'claimed',
          createdAt: 1,
        })
        .run();
      const name = entry === 'start' ? 'start_thread' : 'reply_thread';
      const args =
        entry === 'start'
          ? { projectId }
          : {
              threadId: entry === 'coordinator reply' ? threadId : 'bounded-work',
              mode: entry === 'work steer' ? 'steer' : 'queue',
            };
      const before = {
        threads: s.db.select().from(chiefThread).all(),
        chiefMessages: s.db.select().from(chiefMessage).all(),
        messages: s.db.select().from(message).all(),
        steps: s.db.select().from(step).all(),
      };
      const rejected = await client.callTool({
        name,
        arguments: { ...args, content: 'x'.repeat(32 * 1024 + 1) },
      });
      expect(rejected.isError).toBe(true);
      expect(s.db.select().from(chiefThread).all()).toEqual(before.threads);
      expect(s.db.select().from(chiefMessage).all()).toEqual(before.chiefMessages);
      expect(s.db.select().from(message).all()).toEqual(before.messages);
      expect(s.db.select().from(step).all()).toEqual(before.steps);
      expect(s.db.select().from(queuedMessage).all()).toEqual([]);
      expect(s.db.select().from(steerPending).all()).toEqual([]);
      await call(client, name, { ...args, content: 'x'.repeat(32 * 1024) });
    },
  );

  test.each(['archived', 'closed', 'mismatched run'] as const)(
    'rejects MCP steering of a work Thread with %s state without side effects',
    async (state) => {
      const { s, client, projectId } = await world();
      insertWork(s, projectId, 'guarded-work', 'building');
      insertWork(s, projectId, 'other-work', 'building');
      s.db
        .insert(step)
        .values({
          id: 'guarded-step',
          buildId: 'run-guarded-work',
          kind: 'build',
          status: 'claimed',
          createdAt: 1,
        })
        .run();
      s.db
        .update(todo)
        .set(
          state === 'archived'
            ? { archivedAt: 1 }
            : state === 'closed'
              ? { phase: 'closed' }
              : { latestBuildId: 'run-other-work' },
        )
        .where(eq(todo.id, 'guarded-work'))
        .run();
      const before = s.db.select().from(step).all();
      const signal = vi.spyOn(s.machineHub, 'steerSignal');
      const result = await client.callTool({
        name: 'reply_thread',
        arguments: { threadId: 'guarded-work', mode: 'steer', content: 'Rejected' },
      });
      expect(result.isError).toBe(true);
      expect(s.db.select().from(message).all()).toEqual([]);
      expect(s.db.select().from(steerPending).all()).toEqual([]);
      expect(s.db.select().from(queuedMessage).all()).toEqual([]);
      expect(s.db.select().from(step).all()).toEqual(before);
      expect(signal).not.toHaveBeenCalled();
    },
  );

  test('rejects an obsolete run ID and steers only the current work Thread run', async () => {
    const { s, client, projectId } = await world();
    insertWork(s, projectId, 'newer-work', 'building');
    s.db
      .insert(build)
      .values({
        id: 'old-run',
        todoId: 'newer-work',
        withPlan: false,
        triggerSource: 'user',
        createdAt: 0,
      })
      .run();
    for (const id of ['old-run', 'run-newer-work'])
      s.db
        .insert(step)
        .values({ id: `step-${id}`, buildId: id, kind: 'build', status: 'claimed', createdAt: 1 })
        .run();
    const rejected = await client.callTool({
      name: 'reply_thread',
      arguments: { threadId: 'old-run', mode: 'steer', content: 'Rejected' },
    });
    expect(rejected.isError).toBe(true);
    expect(s.db.select().from(steerPending).all()).toEqual([]);
    await call(client, 'reply_thread', {
      threadId: 'newer-work',
      mode: 'steer',
      content: 'Current',
    });
    expect(s.db.select().from(steerPending).all()).toMatchObject([
      { conversationId: 'run-newer-work', content: 'Current' },
    ]);
  });

  test.each([
    ['done', 'idle'],
    ['failed', 'failed'],
  ] as const)(
    'returns the current start status after a turn becomes %s',
    async (turnStatus, expected) => {
      const s = bootServer();
      bindCoordinator(s);
      const projectId = await postProject(s.app);
      const client = await connect(s);
      const wake = vi.spyOn(s.machineHub, 'wake').mockImplementation(() => {
        s.db.update(step).set({ status: turnStatus }).where(eq(step.kind, 'chief')).run();
      });
      const started = await call(client, 'start_thread', {
        projectId,
        content: 'Immediate completion',
      });
      wake.mockRestore();
      expect(started.thread.status).toBe(expected);
      expect(
        (await call(client, 'read_thread', { threadId: started.thread.id })).thread.status,
      ).toBe(expected);
    },
  );

  test('every new tool is hidden and refused without its grant', async () => {
    const s = bootServer();
    const client = await connect(s, ['Projects'], []);
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(['projects']);
    for (const name of NAMES) {
      const result = await client.callTool({
        name,
        arguments: { threadId: 'missing', projectId: 'missing', content: 'No' },
      });
      expect(result.isError, name).toBe(true);
    }
  });

  test('each tool refuses foreign IDs and cannot expose or mutate another team', async () => {
    const { s, client, projectId, threadId } = await world();
    s.db.insert(team).values({ id: 'foreign-team', name: 'Private', createdAt: 1 }).run();
    s.db
      .insert(project)
      .values({
        id: 'foreign-project',
        teamId: 'foreign-team',
        name: 'Private Project',
        repoKind: 'hosted',
      })
      .run();
    bindCoordinator(s, 'foreign-team');
    const foreign = sendChiefMessage(s.svc, 'foreign-team', {
      threadId: null,
      content: 'Private request',
      projectId: 'foreign-project',
    }).thread.id;
    createOrGetQuestion(s.svc, {
      threadId: foreign,
      requestId: 'foreign-question',
      questions: [{ header: 'Private', question: 'Private decision', options: [] }],
    });
    s.db
      .insert(todo)
      .values({
        id: 'foreign-work',
        teamId: 'foreign-team',
        projectId: 'foreign-project',
        title: 'Private work',
        phase: 'review',
        phaseAt: 1,
        seqNum: 1,
        sourceKind: 'orchestration',
        sourceRef: orchestrationSourceRef(threadId),
      })
      .run();
    s.db
      .insert(build)
      .values({
        id: 'foreign-run',
        todoId: 'foreign-work',
        withPlan: false,
        triggerSource: 'user',
        createdAt: 1,
        prUrl: 'https://github.com/private/repo/pull/9',
      })
      .run();
    const before = {
      threads: s.db.select().from(chiefThread).all(),
      messages: s.db.select().from(chiefMessage).all(),
      steps: s.db.select().from(step).all(),
    };
    const denied = [
      ['start_thread', { projectId: 'foreign-project', content: 'No' }],
      ['threads_waiting_on_me', { projectId: 'foreign-project' }],
      ...['read_thread', 'reply_thread', 'thread_pull_requests'].flatMap((name) =>
        [foreign, 'foreign-work', 'missing'].map((id) => [
          name,
          { threadId: id, content: 'No', mode: 'steer' },
        ]),
      ),
      ['reply_thread', { threadId, projectId: 'foreign-project', content: 'No' }],
      [
        'reply_thread',
        { threadId, requestId: 'foreign-question', answers: [{ header: 'Private', text: 'No' }] },
      ],
      ['read_thread', { threadId, before: 'foreign-question' }],
    ] as const;
    for (const [name, args] of denied) {
      const result = await client.callTool({
        name: name as string,
        arguments: args as Record<string, unknown>,
      });
      expect(result.isError, String(name)).toBe(true);
      expect(JSON.stringify(result)).not.toContain('Private request');
      expect(JSON.stringify(result)).not.toContain('private/repo');
    }
    expect(await call(client, 'threads_waiting_on_me', {})).toEqual([]);
    expect(await call(client, 'thread_pull_requests', { threadId })).toEqual([]);
    expect(s.db.select().from(chiefThread).all()).toEqual(before.threads);
    expect(s.db.select().from(chiefMessage).all()).toEqual(before.messages);
    expect(s.db.select().from(step).all()).toEqual(before.steps);
    const foreignClient = await connect(s, READ, WRITE, 'foreign-team');
    const read = await call(foreignClient, 'read_thread', { threadId: foreign });
    expect(read.thread.id).toBe(foreign);
    expect(chiefIdFormat(s.user.id, s.team.id)).not.toBe(read.thread.coordinatorId);
    expect(projectId).not.toBe(read.thread.projectId);
    expect(s.db.select().from(chief).all()).toHaveLength(2);
    insertWork(s, projectId, 'corrupt-run');
    s.db.update(todo).set({ latestBuildId: 'foreign-run' }).where(eq(todo.id, 'corrupt-run')).run();
    for (const name of ['read_thread', 'reply_thread']) {
      const result = await client.callTool({
        name,
        arguments: { threadId: 'corrupt-run', content: 'No' },
      });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result)).not.toContain('private/repo');
    }
  });
});
