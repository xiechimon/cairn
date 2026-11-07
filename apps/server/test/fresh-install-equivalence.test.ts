import { AGENT_TOOL_DEFAULTS } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterEach, expect, test } from 'vitest';
import { build, todo } from '../src/db/schema.js';
import { seedDefaultRouting } from '../src/services/routing-migration.js';
import { profileForStep } from '../src/services/routing-rules.js';
import { bootServer, postProject, type TestServer } from './helpers.js';

const servers: TestServer[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.dispose();
});

test('a fresh install matches origin/main: the session merges without setup and gets only the default tools', async () => {
  const s = bootServer();
  servers.push(s);
  seedDefaultRouting(s.db);
  const projectId = await postProject(s.app);
  const todoRes = await s.app.request(`/api/projects/${projectId}/todos`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'fresh', spec: 'S' }),
  });
  const { id: todoId } = (await todoRes.json()) as { id: string };
  s.db
    .insert(build)
    .values({ id: 'build-fresh', todoId, withPlan: false, triggerSource: 'user', createdAt: 1 })
    .run();
  const permission = await s.app.request('/api/builds/build-fresh/merge-permission');
  expect(await permission.json()).toEqual({ permitted: true, missingTools: [], prUrl: null });
  const row = s.db.select().from(todo).where(eq(todo.id, todoId)).get();
  if (row === undefined) throw new Error('fixture todo missing');
  for (const kind of ['build', 'plan', 'verify'] as const) {
    expect(profileForStep(s.db, row, kind)).toMatchObject({
      provider: 'claude-code',
      modelId: 'claude-sonnet-5-5',
      tools: [...AGENT_TOOL_DEFAULTS],
      secrets: [],
      mcpServers: [],
      skillsAllowlist: null,
    });
  }
  expect(profileForStep(s.db, row, 'review')).toBeNull();
});
