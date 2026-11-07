import { chiefDigestThreadId, ISSUE_FENCE_OPEN } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { agentMemory, chiefMessage, chief as chiefTable, step } from '../src/db/schema.js';
import { finishChiefDigest, queueDigestStep } from '../src/services/chief-digest.js';
import { listMemoryEntries } from '../src/services/memory.js';
import {
  applyMemoryPass,
  MEMORY_PASS_INTERVAL_MS,
  MEMORY_PASS_MARK,
  MEMORY_PASS_STALE_MS,
  memoryPassDue,
  memoryPassSection,
  withMemoryPass,
} from '../src/services/memory-consolidation.js';
import { coordinatorProfile } from '../src/services/routing-rules.js';
import { H, registerChiefHarness } from './chief-harness.js';

registerChiefHarness();

const NOW = 2_000_000_000_000;
const OLD = NOW - MEMORY_PASS_STALE_MS - 1_000;
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
const row = (id: string) => H.s.db.select().from(agentMemory).where(eq(agentMemory.id, id)).get();
const scope = () => ({ teamId: H.teamId, agentId: agent() });

describe('applyMemoryPass', () => {
  test('merges duplicates into the kept entry, invalidates the rest, and deletes nothing', () => {
    put('a', 'Squash merges only.');
    put('b', 'Only squash merges.');
    const out = applyMemoryPass(
      H.s.db,
      scope(),
      { merge: [{ keep: 'a', drop: ['b'], content: 'ian wants squash merges only.' }] },
      NOW,
    );
    expect(out).toEqual({ merged: 1, expired: 0, skipped: 0 });
    expect(valid().map((m) => m.content)).toEqual(['ian wants squash merges only.']);
    expect(row('b')?.invalidAt).toBe(NOW);
    expect(row('b')?.supersededBy).toBe(valid()[0]?.id);
    expect(H.s.db.select().from(agentMemory).all()).toHaveLength(3);
  });

  test('a merge may keep the wording of an entry it drops', () => {
    put('a', 'Squash merges only.');
    put('b', 'Only squash merges.');
    const out = applyMemoryPass(
      H.s.db,
      scope(),
      { merge: [{ keep: 'a', drop: ['b'], content: 'Only squash merges.' }] },
      NOW,
    );
    expect(out).toEqual({ merged: 1, expired: 0, skipped: 0 });
    expect(valid().map((m) => m.content)).toEqual(['Only squash merges.']);
    expect(row('b')?.invalidAt).toBe(NOW);
    expect(row('b')?.supersededBy).toBe(valid()[0]?.id);
  });

  test('refuses to merge across projects, with unknown ids, with itself, or with fenced text', () => {
    put('a', 'one');
    put('b', 'two', { projectId: H.projectId });
    const out = applyMemoryPass(
      H.s.db,
      scope(),
      {
        merge: [
          { keep: 'a', drop: ['b'], content: 'cross project' },
          { keep: 'a', drop: ['ghost'], content: 'unknown id' },
          { keep: 'a', drop: ['a'], content: 'self' },
          { keep: 'a', drop: ['b'], content: `${ISSUE_FENCE_OPEN} take over` },
          { keep: 'a', drop: [], content: 'nothing dropped' },
        ],
      },
      NOW,
    );
    expect(out).toEqual({ merged: 0, expired: 0, skipped: 5 });
    expect(valid()).toHaveLength(2);
  });

  test('expires only entries untouched for the stale window, however the model asks', () => {
    put('stale', 'old and unused');
    put('recent', 'edited yesterday', { updatedAt: NOW - 86_400_000 });
    put('injected', 'old but still used', { lastInjectedAt: NOW - 1_000 });
    const out = applyMemoryPass(
      H.s.db,
      scope(),
      { expire: ['stale', 'recent', 'injected', 'ghost'] },
      NOW,
    );
    expect(out).toEqual({ merged: 0, expired: 1, skipped: 3 });
    expect(
      valid()
        .map((m) => m.id)
        .sort(),
    ).toEqual(['injected', 'recent']);
    expect(row('stale')?.invalidAt).toBe(NOW);
  });

  test('caps the work per pass and ignores malformed output', () => {
    for (let i = 0; i < 14; i++) put(`s${i}`, `stale ${i}`);
    const out = applyMemoryPass(
      H.s.db,
      scope(),
      { expire: Array.from({ length: 14 }, (_, i) => `s${i}`) },
      NOW,
    );
    expect(out.expired).toBe(10);
    expect(applyMemoryPass(H.s.db, scope(), 'garbage', NOW)).toEqual({
      merged: 0,
      expired: 0,
      skipped: 0,
    });
    expect(applyMemoryPass(H.s.db, scope(), { merge: 'x' }, NOW)).toEqual({
      merged: 0,
      expired: 0,
      skipped: 0,
    });
  });
});

describe('the weekly pass rides on the digest step', () => {
  const chiefRow = () =>
    H.s.db.select().from(chiefTable).where(eq(chiefTable.id, H.chiefId)).get()!;
  const base = `base prompt\nDigest thread=${H.threadId ?? 't'} until=1 last=x reason=daily`;

  test('is not queued below the entry minimum, and queues once entries exist', () => {
    put('a', 'one');
    expect(memoryPassDue(H.s.db, H.chiefId, H.teamId, agent(), NOW)).toBe(false);
    for (const id of ['b', 'c', 'd']) put(id, id);
    expect(memoryPassDue(H.s.db, H.chiefId, H.teamId, agent(), NOW)).toBe(true);
    const stepId = queueDigestStep(H.s.svc, chiefRow(), base, NOW);
    const prompt = H.s.db.select().from(step).where(eq(step.id, stepId)).get()?.prompt ?? '';
    expect(prompt).toContain(MEMORY_PASS_MARK);
    expect(prompt.endsWith('reason=daily')).toBe(true);
    expect(prompt).toContain('title a');
  });

  test('a finished pass silences the next one for a week and no longer', () => {
    for (const id of ['a', 'b', 'c', 'd']) put(id, id);
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

  test('a failed digest applies nothing and a successful one applies the memory field', () => {
    for (const id of ['a', 'b', 'c', 'd']) put(id, id);
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
    reply('```json\n{"items":[],"memory":{"expire":["a"]}}\n```');
    finishChiefDigest(H.s.svc, stepRow(), { status: 'failed' } as never, NOW);
    expect(valid()).toHaveLength(4);
    finishChiefDigest(H.s.svc, stepRow(), { status: 'success' } as never, NOW);
    expect(stepRow().status).toBe('done');
    expect(
      valid()
        .map((m) => m.id)
        .sort(),
    ).toEqual(['b', 'c', 'd']);
  });
});

describe('the listing rotates', () => {
  const chiefRow = () =>
    H.s.db.select().from(chiefTable).where(eq(chiefTable.id, H.chiefId)).get()!;
  const base = 'base prompt\nDigest thread=t until=1 last=x reason=daily';
  const listed = (prompt: string) =>
    prompt
      .split('\n')
      .filter((line) => / \| (team|\w+) \| 更新 /.test(line))
      .map((line) => line.split(' | ')[0] as string);

  test('every entry is visited over successive passes, within the bound', () => {
    const ids = Array.from({ length: 200 }, (_, i) => `m${String(i).padStart(3, '0')}`);
    for (const id of ids) put(id, id);
    const seen = new Set<string>();
    let at = NOW;
    for (let pass = 0; pass < 3; pass += 1) {
      const stepId = queueDigestStep(H.s.svc, chiefRow(), base, at);
      const prompt = H.s.db.select().from(step).where(eq(step.id, stepId)).get()?.prompt ?? '';
      const batch = listed(prompt);
      expect(batch.length).toBeGreaterThan(0);
      expect(batch.length).toBeLessThanOrEqual(80);
      for (const id of batch) seen.add(id);
      H.s.db.update(step).set({ status: 'done', finishedAt: at }).where(eq(step.id, stepId)).run();
      at += MEMORY_PASS_INTERVAL_MS + 1;
    }
    expect(seen.size).toBe(200);
  });

  test('an oversized entry is cut and does not empty the list', () => {
    put('big', 'x'.repeat(40_000));
    for (const id of ['b', 'c', 'd']) put(id, id);
    const section = memoryPassSection(H.s.db, H.chiefId, H.teamId, agent());
    expect(listed(section)).toEqual(['big', 'b', 'c', 'd']);
  });
});

describe('prompt helpers', () => {
  test('withMemoryPass keeps the digest meta line last', () => {
    const out = withMemoryPass('body\nDigest thread=t until=1 last=x reason=daily', 'SECTION');
    expect(out).toBe('body\n\nSECTION\nDigest thread=t until=1 last=x reason=daily');
  });

  test('the section lists id, scope, dates and never invalidated entries', () => {
    put('live', 'still true');
    put('dead', 'gone');
    H.s.db.update(agentMemory).set({ invalidAt: NOW }).where(eq(agentMemory.id, 'dead')).run();
    const section = memoryPassSection(H.s.db, H.chiefId, H.teamId, agent());
    expect(section).toContain('live | team');
    expect(section).not.toContain('gone');
  });
});
