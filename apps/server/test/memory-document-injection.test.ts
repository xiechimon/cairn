import { type ClaimedStep, chiefDigestThreadId } from '@cairn/shared';
import { eq, sql } from 'drizzle-orm';
import { expect, test } from 'vitest';
import { readyMachine } from '../../../packages/shared/test/fixtures/machine.js';
import { agentMemory, chiefThread, routingRule, step, todo } from '../src/db/schema.js';
import { buildChiefSystemPrompt, enqueueChiefStep } from '../src/services/chief.js';
import { chiefTurnContext } from '../src/services/coordinator-steps.js';
import {
  foldMemoryIndexes,
  injectMemories,
  injectMemoryDocuments,
  listStoredMemoryEntries,
} from '../src/services/memory.js';
import { projectTurnContextTraced } from '../src/services/project-instructions.js';
import { AGENT_ID, H, registerChiefHarness, toolDeps } from './chief-harness.js';
import { issueApiKey, req } from './helpers.js';
import { seedOwnerMessage } from './owner-message.js';

registerChiefHarness();

const teamScope = () => ({ agentId: AGENT_ID, teamId: H.teamId, projectId: null });
function put(
  id: string,
  content: string,
  projectId: string | null = null,
  over: Partial<typeof agentMemory.$inferInsert> = {},
) {
  H.s.db
    .insert(agentMemory)
    .values({
      id: `${projectId ?? 'team'}:${id}`,
      content,
      title: id,
      agentId: AGENT_ID,
      teamId: H.teamId,
      projectId,
      createdAt: 1,
      updatedAt: 1,
      ...over,
    })
    .run();
}
function seed(projectId: string | null = null) {
  for (let i = 0; i < 205; i++) put(`line-${i}`, `first-${i}\nFILE-BODY-${i}`, projectId);
  foldMemoryIndexes(H.s.db);
}
function check(text: string) {
  expect(text).toContain('MEMORY.md');
  expect(text).toContain('first-0');
  expect(text).toContain('first-199');
  expect(text).not.toContain('first-200');
  expect(text).not.toContain('FILE-BODY');
  expect(text).toContain('后面还有 5 行没有加载');
}
function chiefContext() {
  const ownerMessageId = seedOwnerMessage(H.s.db, H.threadId, 'hello');
  const id = enqueueChiefStep(H.s.svc, H.threadId, {
    prompt: 'hello',
    trigger: 'user',
    ownerMessageIds: [ownerMessageId],
  });
  const row = H.s.db.select().from(step).where(eq(step.id, id)).get()!;
  expect(row.ownerMessageIds).toEqual([ownerMessageId]);
  return chiefTurnContext(
    toolDeps(),
    row,
    H.s.db.select().from(chiefThread).where(eq(chiefThread.id, H.threadId)).get()!,
    AGENT_ID,
  );
}
const paths = ['system', 'step', 'project', 'worker'] as const;
function injectedTexts(path: (typeof paths)[number]) {
  if (path === 'system') return [buildChiefSystemPrompt(H.s.svc, H.teamId, H.threadId).text];
  if (path === 'project')
    return [projectTurnContextTraced(H.s.db, { ...teamScope(), projectId: H.projectId })!.text];
  const memories =
    path === 'step'
      ? chiefContext().memories
      : injectMemories(H.s.db, { ...teamScope(), projectId: H.projectId });
  return memories.filter((m) => m.title === 'MEMORY.md').map((m) => `${m.title}\n${m.content}`);
}
test.each(paths)(
  'section 4: %s loads bounded indexes without file bodies or other scopes',
  (path) => {
    seed(path === 'project' ? H.projectId : null);
    if (path === 'worker') seed(H.projectId);
    if (path === 'project') put('team-only', 'TEAM-ONLY');
    const texts = injectedTexts(path);
    expect(texts).toHaveLength(path === 'worker' ? 2 : 1);
    for (const text of texts) {
      check(text);
      expect(text).not.toContain('TEAM-ONLY');
    }
  },
);

test('empty injection ensures one persisted index', () => {
  const scope = { ...teamScope(), threadId: H.threadId };
  injectMemories(H.s.db, scope);
  injectMemories(H.s.db, scope);
  const indexes = listStoredMemoryEntries(H.s.db, scope).filter((m) => m.layer === 'core');
  expect(indexes.map((m) => [m.title, m.content, m.threadId])).toEqual([['MEMORY.md', '', null]]);
});
test.each(paths)(
  '%s injection stops at the byte bound without splitting UTF-8 or rejecting stored text',
  (path) => {
    const projectId = path === 'project' ? H.projectId : null;
    put('bytes', '汉'.repeat(10_000), projectId);
    foldMemoryIndexes(H.s.db);
    const text = injectedTexts(path)[0]!;
    expect(text).toContain('后面还有 1 行没有加载');
    expect(text).not.toContain('\ufffd');
    const loaded = text.slice(text.indexOf('- bytes：'), text.indexOf('\n（MEMORY.md 后面'));
    expect(Buffer.byteLength(loaded)).toBeLessThanOrEqual(25 * 1024);
    expect(Buffer.byteLength(loaded)).toBeGreaterThan(25 * 1024 - 3);
    expect(
      listStoredMemoryEntries(H.s.db, { agentId: AGENT_ID, teamId: H.teamId })[0]!.content,
    ).toContain('汉'.repeat(10_000));
  },
);

test('empty project and independent scopes get distinct persisted revisions without leaking author memory', () => {
  put('author', 'AUTHOR');
  const scope = { agentId: AGENT_ID, teamId: H.teamId, projectId: H.projectId, teamScoped: false };
  const first = injectMemoryDocuments(H.s.db, scope);
  const second = injectMemoryDocuments(H.s.db, scope);
  expect(first.memories).toHaveLength(2);
  expect(first.memories).toEqual(second.memories);
  expect(new Set(first.memories.map((m) => m.baseVersion)).size).toBe(2);
  expect(first.memories.every((m) => m.content === '' && m.baseVersion)).toBe(true);
});
test('initialization failure propagates and rolls back instead of returning synthetic memory', () => {
  H.s.db.run(sql`CREATE TRIGGER reject_index BEFORE INSERT ON agent_memory
    WHEN NEW.title = 'MEMORY.md' BEGIN SELECT RAISE(ABORT, 'index initialization failed'); END`);
  expect(() => injectMemories(H.s.db, teamScope())).toThrow('index initialization failed');
  expect(H.s.db.select().from(agentMemory).all()).toEqual([]);
});
test('digest loads index and file count without stamping use or including another thread scratchpad', () => {
  put('fact', 'first\nDETAIL');
  put('pad', 'OTHER-THREAD', null, { layer: 'scratchpad', threadId: H.threadId });
  foldMemoryIndexes(H.s.db);
  const before = H.s.db.select().from(agentMemory).all();
  const thread = H.s.db.select().from(chiefThread).where(eq(chiefThread.id, H.threadId)).get()!;
  const digestId = chiefDigestThreadId(H.chiefId);
  const digest = { ...thread, id: digestId };
  const ownerMessageId = seedOwnerMessage(H.s.db, H.threadId, 'hello');
  const id = enqueueChiefStep(H.s.svc, H.threadId, {
    prompt: 'hello',
    trigger: 'user',
    ownerMessageIds: [ownerMessageId],
  });
  const row = H.s.db.select().from(step).where(eq(step.id, id)).get()!;
  expect(row.ownerMessageIds).toEqual([ownerMessageId]);
  const result = chiefTurnContext(toolDeps(), { ...row, buildId: digestId }, digest, AGENT_ID);
  expect(result.digest).toBe(true);
  expect(result.memories).toContainEqual({
    title: '记忆文件',
    content: '1 个；用 memories 按需读取。',
  });
  expect(JSON.stringify(result.memories)).not.toContain('DETAIL');
  expect(JSON.stringify(result.memories)).not.toContain('OTHER-THREAD');
  expect(H.s.db.select().from(agentMemory).all()).toEqual(before);
});
async function machineToken() {
  const key = await issueApiKey(H.s);
  const enrolled = await H.s.app.request('/api/machine/enroll', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify(
      readyMachine({ teamId: H.teamId, name: 'injection', cliVersion: '9.9.9' }),
    ),
  });
  expect(enrolled.status).toBe(200);
  const body = (await enrolled.json()) as { token: string; machineId: string };
  H.s.db
    .update(routingRule)
    .set({ machineId: body.machineId })
    .where(eq(routingRule.teamId, H.teamId))
    .run();
  H.s.db
    .update(todo)
    .set({ routeOverride: { machineId: body.machineId } })
    .where(eq(todo.teamId, H.teamId))
    .run();
  return body;
}
async function machineClaim(token: string) {
  const response = await H.s.app.request('/api/machine/tasks/claim', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: '{}',
  });
  expect(response.status).toBe(200);
  const { step: claimed } = (await response.json()) as { step: ClaimedStep };
  return claimed;
}
test('machine HTTP claim delivers bounded Coordinator system and step prompts', async () => {
  seed();
  const { token } = await machineToken();
  const ownerMessageId = seedOwnerMessage(H.s.db, H.threadId, 'hello');
  const id = enqueueChiefStep(H.s.svc, H.threadId, {
    prompt: 'hello',
    trigger: 'user',
    ownerMessageIds: [ownerMessageId],
  });
  expect(H.s.db.select().from(step).where(eq(step.id, id)).get()?.ownerMessageIds).toEqual([
    ownerMessageId,
  ]);
  const claimed = await machineClaim(token);
  check(claimed.chief!.systemPrompt);
  check(claimed.agent!.memories!.map((m) => `${m.title}\n${m.content}`).join('\n'));
});
test('machine HTTP worker claim delivers separate bounded indexes and matching todo scratchpad', async () => {
  seed();
  seed(H.projectId);
  const { token, machineId } = await machineToken();
  const todoResponse = await req(H.s.app, 'POST', `/api/projects/${H.projectId}/todos`, {
    title: 'memory',
    spec: 'read index',
  });
  const todoId = ((await todoResponse.json()) as { id: string }).id;
  put('todo-pad', 'THREAD-PAD', H.projectId, {
    title: 'scratch',
    layer: 'scratchpad',
    threadId: todoId,
  });
  const build = await req(H.s.app, 'POST', `/api/projects/${H.projectId}/builds`, {
    todoIds: [todoId],
    routeOverride: { machineId },
  });
  expect(build.status).toBe(201);
  const claimed = await machineClaim(token);
  const memories = claimed.agent!.memories!;
  expect(memories.filter((m) => m.title === 'MEMORY.md')).toHaveLength(2);
  for (const index of memories.filter((m) => m.title === 'MEMORY.md'))
    check(`${index.title}\n${index.content}`);
  expect(memories).toContainEqual({ title: 'scratch', content: 'THREAD-PAD' });
});
