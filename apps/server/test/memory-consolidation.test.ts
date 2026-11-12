import { chiefDigestThreadId } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import {
  agentMemory,
  chiefMessage,
  chief as chiefTable,
  chiefThread,
  step,
} from '../src/db/schema.js';
import { finishChiefDigest, queueDigestStep } from '../src/services/chief-digest.js';
import { chiefTurnContext } from '../src/services/coordinator-steps.js';
import { listMemoryEntries } from '../src/services/memory.js';
import {
  applyMemoryPass,
  MEMORY_PASS_INTERVAL_MS,
  MEMORY_PASS_MARK,
  memoryPassDue,
  memoryPassSection,
  withMemoryPass,
} from '../src/services/memory-consolidation.js';
import { coordinatorProfile } from '../src/services/routing-rules.js';
import { AGENT_ID, H, registerChiefHarness, relay } from './chief-harness.js';

registerChiefHarness();
const NOW = 2_000_000_000_000;
const OLD = NOW - 30 * 24 * 60 * 60_000 - 1_000;
const agent = () => coordinatorProfile(H.s.db, H.teamId)?.id ?? '';

function put(
  id: string,
  content: string,
  over: { projectId?: string | null; updatedAt?: number; lastInjectedAt?: number | null } = {},
) {
  H.s.db
    .insert(agentMemory)
    .values({
      id,
      agentId: agent(),
      teamId: H.teamId,
      title: `title ${id}`,
      content,
      projectId: over.projectId ?? null,
      sourceTodoId: null,
      sourceBuildId: null,
      createdAt: OLD,
      updatedAt: over.updatedAt ?? OLD,
      lastInjectedAt: over.lastInjectedAt ?? null,
    })
    .run();
}

const valid = () => listMemoryEntries(H.s.db, { agentId: agent(), teamId: H.teamId });

type Doc = { id: string; baseVersion: string; content: string };
const scope = () => ({ agentId: AGENT_ID, teamId: H.teamId });
const read = async () => (await relay('memories', { scope: 'team', file: 'MEMORY.md' })) as Doc;
const edit = async (content: string) => {
  const index = await read();
  return (await relay('update_memory', {
    scope: 'team',
    file: 'MEMORY.md',
    baseVersion: index.baseVersion,
    content,
  })) as Doc;
};

const update = (base: Doc, params: Record<string, unknown>) => ({
  tool: 'update_memory',
  params: { scope: 'team', file: 'MEMORY.md', baseVersion: base.baseVersion, ...params },
});
const pass = (operations: unknown[]) => applyMemoryPass(H.s.db, scope(), { operations }, NOW);

test('tidy digest schedules over-bound indexes, includes fresh revisions and preserves the meta line', async () => {
  const index = await edit('line\n'.repeat(205));
  const chief = H.s.db.select().from(chiefTable).where(eq(chiefTable.id, H.chiefId)).get()!;
  const id = queueDigestStep(
    H.s.svc,
    chief,
    `base\nDigest thread=${H.threadId} until=1 last=x reason=daily`,
    Date.now(),
  );
  const row = H.s.db.select().from(step).where(eq(step.id, id)).get()!;
  expect(row.buildId).toBe(chiefDigestThreadId(H.chiefId));
  expect(row.prompt).toContain(MEMORY_PASS_MARK);
  expect(row.prompt).toContain(index.baseVersion);
  H.s.db.update(step).set({ status: 'done', finishedAt: Date.now() }).where(eq(step.id, id)).run();
  expect(memoryPassDue(H.s.db, H.chiefId, H.teamId, AGENT_ID, Date.now())).toBe(false);
  expect(row.prompt).toContain('operations');
  expect(row.prompt?.endsWith('reason=daily')).toBe(true);
});

test('tidy re-reads a stale unique replacement and preserves the concurrent appended line', async () => {
  const first = await edit('detail\nkeep');
  await edit('detail\nkeep\nconcurrent');
  expect(pass([update(first, { old_str: 'detail', new_str: '[detail](detail.md)' })])).toEqual({
    applied: 1,
    skipped: 0,
  });
  expect((await read()).content).toBe('[detail](detail.md)\nkeep\nconcurrent');
});

test('tidy retains committed file moves and versions when a later stale full replacement fails', async () => {
  const file = (await relay('save_memory', {
    scope: 'team',
    file: 'detail.md',
    content: 'detail',
  })) as Doc;
  const first = await edit('detail');
  await edit('detail\nconcurrent');
  expect(
    pass([
      update(file, { file: 'detail.md', moveTo: H.projectId }),
      update(first, { content: 'blind overwrite' }),
    ]),
  ).toEqual({ applied: 1, skipped: 1 });
  expect((await read()).content).toContain('concurrent');
  expect(await relay('memories', { scope: H.projectId, file: 'detail.md' })).toMatchObject({
    content: 'detail',
  });
  expect(
    await relay('memories', { scope: H.projectId, file: 'detail.md', versions: 'list' }),
  ).toMatchObject({ versions: [{ id: file.id }] });
});

test('under-bound indexes and the retired merge/expiry payload cannot trigger or mutate memory', async () => {
  const index = await edit('short');
  expect(memoryPassDue(H.s.db, H.chiefId, H.teamId, AGENT_ID, Date.now())).toBe(false);
  expect(applyMemoryPass(H.s.db, scope(), { merge: [], expire: [index.id] }, Date.now())).toEqual({
    applied: 0,
    skipped: 1,
  });
  expect((await read()).content).toBe('short');
});

describe('the weekly pass rides on the digest step', () => {
  const chiefRow = () =>
    H.s.db.select().from(chiefTable).where(eq(chiefTable.id, H.chiefId)).get()!;
  const base = `base prompt\nDigest thread=${H.threadId ?? 't'} until=1 last=x reason=daily`;

  test('a finished pass silences the next one for a week and no longer', async () => {
    await edit('line\n'.repeat(205));
    const stepId = queueDigestStep(H.s.svc, chiefRow(), base, NOW);
    H.s.db.update(step).set({ status: 'done', finishedAt: NOW }).where(eq(step.id, stepId)).run();
    expect(memoryPassDue(H.s.db, H.chiefId, H.teamId, agent(), NOW + 1_000)).toBe(false);
    expect(
      memoryPassDue(H.s.db, H.chiefId, H.teamId, agent(), NOW + MEMORY_PASS_INTERVAL_MS + 1),
    ).toBe(true);
    const later = queueDigestStep(H.s.svc, chiefRow(), base, NOW + 1_000);
    expect(H.s.db.select().from(step).where(eq(step.id, later)).get()?.prompt).not.toContain(
      MEMORY_PASS_MARK,
    );
  });

  test('a failed digest applies nothing and a successful one applies the memory field', async () => {
    const index = await edit('line\n'.repeat(205));
    H.s.db
      .insert(chiefMessage)
      .values({
        id: 'last-row',
        threadId: H.threadId,
        role: 'user',
        content: 'hi',
        createdAt: NOW - 5,
      })
      .run();
    const meta = `\nDigest thread=${H.threadId} until=${NOW - 5} last=last-row reason=daily`;
    const stepId = queueDigestStep(H.s.svc, chiefRow(), `prompt${meta}`, NOW);
    const reply = (text: string) =>
      H.s.db
        .insert(chiefMessage)
        .values({
          id: `reply-${Math.random()}`,
          threadId: chiefDigestThreadId(H.chiefId),
          role: 'assistant',
          content: text,
          createdAt: NOW,
        })
        .run();
    const stepRow = () => H.s.db.select().from(step).where(eq(step.id, stepId)).get()!;
    reply(
      JSON.stringify({ items: [], memory: { operations: [update(index, { content: 'short' })] } }),
    );
    finishChiefDigest(H.s.svc, stepRow(), { status: 'failed' } as never, NOW);
    expect((await read()).content).toBe(index.content);
    finishChiefDigest(H.s.svc, stepRow(), { status: 'success' } as never, NOW);
    expect(stepRow().status).toBe('done');
    expect((await read()).content).toBe('short');
  });
});

describe('a digest turn is not a use', () => {
  test('the digest step reads memories without refreshing lastInjectedAt', () => {
    for (const id of ['a', 'b', 'c', 'd']) put(id, id);
    const chiefRow = H.s.db.select().from(chiefTable).where(eq(chiefTable.id, H.chiefId)).get()!;
    const stepId = queueDigestStep(
      H.s.svc,
      chiefRow,
      `base\nDigest thread=t until=1 last=x reason=daily`,
      NOW,
    );
    const stepRow = H.s.db.select().from(step).where(eq(step.id, stepId)).get()!;
    const threadRow = H.s.db
      .select()
      .from(chiefThread)
      .where(eq(chiefThread.id, stepRow.buildId))
      .get()!;
    const context = chiefTurnContext(
      {
        ...H.s.svc,
        box: H.s.secretBox,
        reposDir: H.s.reposDir,
        attachmentsDir: H.s.attachmentsDir,
        skillsDir: H.s.skillsDir,
      },
      stepRow,
      threadRow,
      agent(),
    );
    expect(context.memories).toEqual([
      { title: 'MEMORY.md', content: '- title a：a\n- title b：b\n- title c：c\n- title d：d' },
      { title: '记忆文件', content: '0 个；用 memories 按需读取。' },
    ]);
    expect(valid().every((m) => m.lastInjectedAt === null)).toBe(true);
  });
});

describe('prompt helpers', () => {
  test('withMemoryPass keeps the digest meta line last', () => {
    const out = withMemoryPass('body\nDigest thread=t until=1 last=x reason=daily', 'SECTION');
    expect(out).toBe('body\n\nSECTION\nDigest thread=t until=1 last=x reason=daily');
  });
  test('the section lists scope and revisions and never invalidated entries', async () => {
    await edit('line\n'.repeat(205));
    put('dead', 'gone\n'.repeat(205));
    H.s.db.update(agentMemory).set({ invalidAt: NOW }).where(eq(agentMemory.id, 'dead')).run();
    const section = memoryPassSection(H.s.db, H.chiefId, H.teamId, agent());
    expect(section).toContain('team | MEMORY.md | memory-index:');
    expect(section).not.toContain('dead:');
  });
});
