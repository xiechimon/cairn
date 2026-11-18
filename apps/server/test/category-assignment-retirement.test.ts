import { CHIEF_REMOTE_TOOLS, createTodoBodySchema } from '@cairn/shared';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { expect, test } from 'vitest';
import { buildMcpFaceServer } from '../src/services/mcp-face.js';
import { createAutonomousTodo } from '../src/services/todos.js';
import { H, registerChiefHarness, toolDeps } from './chief-harness.js';
import { req } from './helpers.js';

registerChiefHarness();

test('ordinary task creation and owner edits ignore retired and unrelated keys', async () => {
  const created = await req(H.s.app, 'POST', `/api/projects/${H.projectId}/todos`, {
    title: '',
    spec: 'Original body\nSecond line',
    machineId: 'legacy-hint',
    tagIds: ['retired'],
    unrelatedIgnoredField: true,
  });
  expect(created.status).toBe(201);
  const task = (await created.json()) as { id: string; title: string };
  expect(task.title).toBe('Original body');
  expect(task).not.toHaveProperty('tagIds');
  expect(
    (
      await req(H.s.app, 'PATCH', `/api/todos/${task.id}`, {
        title: 'Owner edit',
        machineId: 'legacy-hint',
        tagIds: ['retired'],
        unrelatedIgnoredField: true,
      })
    ).status,
  ).toBe(200);
  expect((await req(H.s.app, 'GET', `/api/todos/${task.id}`)).status).toBe(200);
});

test.each(['create_todo', 'update_todo'])(
  'MCP tools/call %s ignores the retired tagIds argument',
  async (name) => {
    const task = createAutonomousTodo(H.s, {
      teamId: H.teamId,
      projectId: H.projectId,
      title: 'Existing task',
      spec: 'Keep the owner words.',
      createdBy: H.userId,
      ownerId: H.userId,
    });
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
          ? { projectId: H.projectId, title: 'A title', spec: 'A spec' }
          : { todoId: task.id, title: 'A title' };
      const result = await client.callTool({ name, arguments: { ...args, tagIds: ['retired'] } });
      expect(result.isError ?? false).toBe(false);
    } finally {
      await client.close();
      await server.close();
    }
  },
);

test('published create/update contracts do not offer category assignment', () => {
  const parsed = createTodoBodySchema.safeParse({ title: 't', spec: 's', tagIds: [] });
  expect(parsed.success).toBe(true);
  if (parsed.success) expect(parsed.data).not.toHaveProperty('tagIds');
  const tool = CHIEF_REMOTE_TOOLS.find(({ name }) => name === 'update_todo')!;
  expect(tool.parameters).not.toHaveProperty('properties.tagIds');
  expect(tool.description).not.toMatch(/\btags?\b/);
});
