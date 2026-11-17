import { eq } from 'drizzle-orm';
import { expect, test } from 'vitest';
import { agentMemory, chiefThread, step } from '../src/db/schema.js';
import { enqueueChiefStep } from '../src/services/chief.js';
import { chiefTurnContext } from '../src/services/coordinator-steps.js';
import { foldMemoryIndexes } from '../src/services/memory.js';
import { AGENT_ID, H, registerChiefHarness, toolDeps } from './chief-harness.js';
import { postProject } from './helpers.js';
import { seedOwnerMessage } from './owner-message.js';

registerChiefHarness();

const HEADING = '## 相关记忆（';

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

function turnContext(prompt: string, trigger: 'user' | 'wake' = 'user') {
  const ownerMessageId = seedOwnerMessage(H.s.db, H.threadId, prompt);
  const id = enqueueChiefStep(H.s.svc, H.threadId, {
    prompt,
    ...(trigger === 'user'
      ? { trigger: 'user' as const }
      : { trigger: 'wake' as const, provenance: 'test' }),
    ownerMessageIds: [ownerMessageId],
  });
  const row = H.s.db.select().from(step).where(eq(step.id, id)).get()!;
  const thread = H.s.db.select().from(chiefThread).where(eq(chiefThread.id, H.threadId)).get()!;
  return chiefTurnContext(toolDeps(), row, thread, AGENT_ID);
}

const recallSection = (prompt: string, trigger: 'user' | 'wake' = 'user') =>
  turnContext(prompt, trigger).sections.find((section) => section.includes(HEADING)) ?? null;

test('recalls a fact that the index bound cut from injection', () => {
  for (let i = 0; i < 205; i++) put(`line-${i}`, `first-${i}`);
  put('deploy-machine', 'ssh omarchy 是 ian 的 Linux 桌面（别用 IP/裸主机名）');
  foldMemoryIndexes(H.s.db);
  const context = turnContext('把新镜像推到 Linux 桌面部署');
  expect(context.memories.map((m) => m.content).join('\n')).not.toContain('omarchy');
  const section = context.sections.find((s) => s.includes(HEADING));
  expect(section).not.toBeNull();
  expect(section).toContain('omarchy');
  expect(section).toContain('[team]');
});

test('recalls a fact from another project scope with the project tag', async () => {
  const blogId = await postProject(H.s.app, 'blog');
  put('publish', '博客是 Cloudflare Pages，push main 即发，没有服务器', blogId);
  foldMemoryIndexes(H.s.db);
  const section = recallSection('博客又 404 了，是不是服务器挂了');
  expect(section).not.toBeNull();
  expect(section).toContain('没有服务器');
  expect(section).toContain('blog');
});

test('recalls a searchable memory file pointer', () => {
  put('verify-gotchas.md', '本地别跑 pnpm e2e，受影响面会拉满全量 spec', H.projectId, {
    layer: 'searchable',
  });
  const section = recallSection('本地跑测试会拉满吗');
  expect(section).not.toBeNull();
  expect(section).toContain('verify-gotchas.md');
  expect(section).toContain('memories');
});

test('no recall section when nothing matches', () => {
  put('deploy-machine', 'ssh omarchy 是 ian 的 Linux 桌面');
  foldMemoryIndexes(H.s.db);
  expect(recallSection('今天天气怎么样')).toBeNull();
});

test('does not repeat facts already inside the injected index', () => {
  put('deploy-machine', 'ssh omarchy 是 ian 的 Linux 桌面');
  foldMemoryIndexes(H.s.db);
  const context = turnContext('把新镜像推到 Linux 桌面部署');
  expect(context.memories.map((m) => m.content).join('\n')).toContain('omarchy');
  const section = context.sections.find((s) => s.includes(HEADING));
  expect(section?.includes('omarchy') ?? false).toBe(false);
});

test('suppresses facts already recalled on the same thread', () => {
  for (let i = 0; i < 205; i++) put(`line-${i}`, `first-${i}`);
  put('deploy-machine', 'ssh omarchy 是 ian 的 Linux 桌面（别用 IP/裸主机名）');
  foldMemoryIndexes(H.s.db);
  expect(recallSection('把新镜像推到 Linux 桌面部署')).toContain('omarchy');
  expect(recallSection('再去 Linux 桌面跑一次部署')).toBeNull();
});

test('excludes non-injectable rows', () => {
  put('scratch', 'ssh omarchy 是 ian 的 Linux 桌面', null, {
    layer: 'scratchpad',
    threadId: 'other-thread',
  });
  put('dead', 'ssh omarchy 是 ian 的 Linux 桌面', null, { invalidAt: 1 });
  put('superseded', 'ssh omarchy 是 ian 的 Linux 桌面', null, {
    invalidAt: 1,
    supersededBy: 'newer',
  });
  put('adopted', 'ssh omarchy 是 ian 的 Linux 桌面', null, { adoptedFrom: 'x' });
  put('own', 'ssh omarchy 是 ian 的 Linux 桌面', null, { independent: true });
  put('other-team', 'ssh omarchy 是 ian 的 Linux 桌面', null, { teamId: 'other-team' });
  foldMemoryIndexes(H.s.db);
  expect(recallSection('把新镜像推到 Linux 桌面部署')).toBeNull();
});

test('does not run recall on event turns', () => {
  put('deploy-machine', 'ssh omarchy 是 ian 的 Linux 桌面');
  foldMemoryIndexes(H.s.db);
  const context = turnContext('把新镜像推到 Linux 桌面部署', 'wake');
  expect(context.trigger).not.toBe('user');
  expect(context.sections.find((s) => s.includes(HEADING)) ?? null).toBeNull();
});

test('bounds the recall section to four entries', () => {
  for (let i = 0; i < 205; i++) put(`line-${i}`, `first-${i}`);
  for (let i = 0; i < 6; i++) put(`deploy-${i}`, `ssh 机器${i} 走 Linux 桌面部署`);
  foldMemoryIndexes(H.s.db);
  const section = recallSection('把新镜像推到 Linux 桌面部署');
  expect(section).not.toBeNull();
  expect(section!.split('\n').filter((line) => line.startsWith('- ['))).toHaveLength(4);
});

test('misses paraphrases with no shared terms', () => {
  put('deploy-machine', 'ssh omarchy 是 ian 的 Linux 桌面（别用 IP/裸主机名）');
  foldMemoryIndexes(H.s.db);
  expect(recallSection('远程主机连不上')).toBeNull();
});
