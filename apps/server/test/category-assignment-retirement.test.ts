import {
  CHIEF_REMOTE_TOOLS,
  createTodoBodySchema,
  MCP_TOOL_REGISTRY,
  type TaskRequest,
} from '@cairn/shared';
import { validateToolArguments } from '@earendil-works/pi-ai';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { inArray } from 'drizzle-orm';
import { expect, test } from 'vitest';
import {
  build,
  githubLabel,
  schedule,
  tag,
  todo,
  todoGithubLabel,
  todoTag,
} from '../src/db/schema.js';
import { createRequestTodo, updateRequestTodo } from '../src/services/coordinator-request.js';
import { buildMcpFaceServer, executeMcpTool } from '../src/services/mcp-face.js';
import {
  createAutonomousTodo,
  createTodo,
  updateAutonomousTodo,
  updateTodo,
} from '../src/services/todos.js';
import { ctx, H, registerChiefHarness, relay, toolDeps } from './chief-harness.js';
import { req } from './helpers.js';
import { insertLegacyCategory } from './legacy-category-fixtures.js';

registerChiefHarness();

function fixture() {
  const request: TaskRequest = {
    segments: [
      {
        source: { kind: 'edit', userId: H.userId, at: 1, span: 'whole' },
        author: 'owner',
        sourceRef: null,
        text: 'Keep the owner words.',
      },
    ],
    siblings: [],
    difficulty: null,
    titleSource: 'owner',
    titleSourceRef: null,
  };
  const tasks = [false, true].map((cited) =>
    createAutonomousTodo(H.s, {
      teamId: H.teamId,
      projectId: H.projectId,
      title: 'Existing task',
      spec: 'Keep the owner words.',
      createdBy: H.userId,
      ownerId: H.userId,
      ...(cited ? { request } : {}),
    }),
  );
  const category = insertLegacyCategory(H.s.db, H.projectId, 'CoRrEcTiOn');
  H.s.db
    .insert(todoTag)
    .values(tasks.map(({ id }) => ({ todoId: id, tagId: category.id })))
    .run();
  H.s.db
    .update(todo)
    .set({ correctionRequired: true })
    .where(
      inArray(
        todo.id,
        tasks.map(({ id }) => id),
      ),
    )
    .run();
  H.s.db
    .insert(githubLabel)
    .values({ id: 'retained-label', projectId: H.projectId, name: 'enhancement' })
    .run();
  H.s.db
    .insert(todoGithubLabel)
    .values(tasks.map(({ id }) => ({ todoId: id, labelId: 'retained-label' })))
    .run();
  H.s.db
    .insert(schedule)
    .values({
      id: 'retained-schedule',
      teamId: H.teamId,
      projectId: H.projectId,
      todoId: tasks[0]!.id,
      kind: 'daily',
      tz: 'UTC',
      createdBy: H.userId,
      at: 1,
      nextRunAt: 2,
    })
    .run();
  return tasks;
}

function snapshot() {
  return {
    tasks: H.s.db.select().from(todo).all(),
    categories: H.s.db.select().from(tag).all(),
    links: H.s.db.select().from(todoTag).all(),
    labels: H.s.db.select().from(githubLabel).all(),
    labelLinks: H.s.db.select().from(todoGithubLabel).all(),
    schedules: H.s.db.select().from(schedule).all(),
    builds: H.s.db.select().from(build).all(),
  };
}

const ENTRY_NAMES = [
  'REST create',
  'REST update',
  'Coordinator create',
  'Coordinator update',
  'request create',
  'request update',
  'service create',
  'service update',
  'owner service create',
  'owner service update',
  'MCP create',
  'MCP update',
] as const;

test.each(ENTRY_NAMES)('%s rejects category assignment before any writes', async (entry) => {
  const tasks = fixture();
  const mcpCtx = {
    teamId: H.teamId,
    user: H.s.user,
    grants: new Set(MCP_TOOL_REGISTRY.map(({ grant }) => grant)),
  };
  for (const task of tasks) {
    const create = {
      teamId: H.teamId,
      projectId: H.projectId,
      title: 'Should not stick',
      spec: 'Should not create',
      createdBy: H.userId,
      ownerId: H.userId,
    };
    const update = { title: 'Should not stick', projectId: H.projectId };
    const requestCreate = { projectId: H.projectId, sourceTodoId: task.id };
    const requestUpdate = {
      todoId: task.id,
      ...(task.request ? { title: 'Should not stick' } : { blockedBy: [] }),
    };
    const calls = {
      'REST create': async (extra: Record<string, unknown>) =>
        (await req(H.s.app, 'POST', `/api/projects/${H.projectId}/todos`, { ...create, ...extra }))
          .status,
      'REST update': async (extra: Record<string, unknown>) =>
        (await req(H.s.app, 'PATCH', `/api/todos/${task.id}`, { ...update, ...extra })).status,
      'Coordinator create': async (extra: Record<string, unknown>) =>
        relay('create_todo', { ...requestCreate, ...extra }),
      'Coordinator update': async (extra: Record<string, unknown>) =>
        relay('update_todo', { ...requestUpdate, ...extra }),
      'request create': async (extra: Record<string, unknown>) =>
        createRequestTodo(
          H.s,
          ctx(),
          { ...requestCreate, ...extra },
          { createdBy: H.userId, ownerId: H.userId },
        ),
      'request update': async (extra: Record<string, unknown>) =>
        updateRequestTodo(H.s, ctx(), { ...requestUpdate, ...extra }),
      'service create': async (extra: Record<string, unknown>) =>
        createAutonomousTodo(H.s, { ...create, ...extra }),
      'service update': async (extra: Record<string, unknown>) =>
        updateAutonomousTodo(H.s, task.id, { ...update, ...extra }),
      'owner service create': async (extra: Record<string, unknown>) =>
        createTodo(H.s, { ...create, ...extra }),
      'owner service update': async (extra: Record<string, unknown>) =>
        updateTodo(H.s, task.id, { ...update, ...extra }),
      'MCP create': async (extra: Record<string, unknown>) =>
        executeMcpTool(toolDeps(), mcpCtx, 'create_todo', { ...create, ...extra }),
      'MCP update': async (extra: Record<string, unknown>) =>
        executeMcpTool(toolDeps(), mcpCtx, 'update_todo', { todoId: task.id, ...update, ...extra }),
    };
    for (const tagIds of [[], null, 'bug', ['retired']]) {
      const before = snapshot();
      const call = calls[entry]({ tagIds });
      if (entry.startsWith('REST')) expect(await call).toBe(400);
      else await expect(call).rejects.toMatchObject({ status: 400 });
      expect(snapshot()).toEqual(before);
    }
  }
});

test.each(['create_todo', 'update_todo'])(
  'MCP tools/call %s preserves retired arguments for canonical rejection',
  async (name) => {
    const [task] = fixture();
    const server = buildMcpFaceServer(toolDeps(), {
      teamId: H.teamId,
      user: H.s.user,
      grants: new Set(['Create Todo', 'Update Todo']),
    });
    const client = new Client({ name: 'category-retirement', version: '1' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const tool = (await client.listTools()).tools.find((tool) => tool.name === name);
      expect(tool?.inputSchema.properties).not.toHaveProperty('tagIds');
      const args =
        name === 'create_todo'
          ? { projectId: H.projectId, title: 'Should not stick', spec: 'Should not create' }
          : { todoId: task!.id, title: 'Should not stick' };
      for (const tagIds of [[], null, 'bug', ['retired']]) {
        const before = snapshot();
        const result = await client.callTool({ name, arguments: { ...args, tagIds } });
        expect(result.isError).toBe(true);
        expect(JSON.stringify(result.content)).toContain('tagIds');
        expect(snapshot()).toEqual(before);
      }
      const valid = await client.callTool({
        name,
        arguments: { ...args, title: 'Valid title', unrelatedIgnoredField: true },
      });
      expect(valid.isError ?? false).toBe(false);
    } finally {
      await client.close();
      await server.close();
    }
  },
);

test('ordinary task creation and owner edits still ignore unrelated REST keys', async () => {
  const created = await req(H.s.app, 'POST', `/api/projects/${H.projectId}/todos`, {
    title: '',
    spec: 'Original body\nSecond line',
    machineId: 'legacy-hint',
    unrelatedIgnoredField: true,
  });
  expect(created.status).toBe(201);
  const task = (await created.json()) as { id: string; title: string };
  expect(task.title).toBe('Original body');
  expect(
    (
      await req(H.s.app, 'PATCH', `/api/todos/${task.id}`, {
        title: 'Owner edit',
        machineId: 'legacy-hint',
        unrelatedIgnoredField: true,
      })
    ).status,
  ).toBe(200);
  expect((await req(H.s.app, 'GET', `/api/todos/${task.id}`)).status).toBe(200);
});

test.each(['create_todo', 'update_todo'])(
  'in-server Pi validation preserves stale %s category arguments for canonical rejection',
  async (name) => {
    const tasks = fixture();
    const definition = CHIEF_REMOTE_TOOLS.find((tool) => tool.name === name)!;
    const base: Record<string, string> =
      name === 'create_todo'
        ? { projectId: H.projectId, sourceTodoId: tasks[0]!.id }
        : { todoId: tasks[1]!.id, title: 'Should not stick' };
    for (const tagIds of [[], null, 'bug', ['retired']]) {
      const args = { ...base, tagIds };
      const before = snapshot();
      const validated: unknown = validateToolArguments(
        { name, description: definition.description, parameters: definition.parameters as object },
        { type: 'toolCall', id: 'fixture-call', name, arguments: args },
      );
      expect(validated).toEqual(args);
      await expect(relay(name, validated as Record<string, unknown>)).rejects.toMatchObject({
        status: 400,
      });
      expect(snapshot()).toEqual(before);
    }
  },
);

test('published create/update contracts no longer offer category assignment', () => {
  expect(createTodoBodySchema.safeParse({ title: 't', spec: 's', tagIds: [] }).success).toBe(false);
  const tool = CHIEF_REMOTE_TOOLS.find(({ name }) => name === 'update_todo')!;
  expect(tool.parameters).not.toHaveProperty('properties.tagIds');
  expect(tool.description).not.toMatch(/\btags?\b/);
});
