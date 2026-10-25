import { type Phase, todoRecordSchema } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { todo as todoTable } from '../src/db/schema.js';
import { bootServer, postProject, req, type TestServer } from './helpers.js';

async function setup(phase: Phase, hasChanges?: boolean): Promise<{ s: TestServer; id: string }> {
  const s = bootServer();
  const projectId = await postProject(s.app);
  const created = todoRecordSchema.parse(
    await (
      await req(s.app, 'POST', `/api/projects/${projectId}/todos`, { title: 'p', spec: 'x' })
    ).json(),
  );
  s.db
    .update(todoTable)
    .set({ phase, ...(hasChanges === undefined ? {} : { hasChanges }) })
    .where(eq(todoTable.id, created.id))
    .run();
  return { s, id: created.id };
}

async function patchPhase(s: TestServer, id: string, phase: Phase): Promise<Response> {
  return req(s.app, 'PATCH', `/api/todos/${id}`, { phase });
}

describe('manual drop matrix (#753): done source', () => {
  test('done(changed)->review = reopen to the review gate: 200 + phaseAt refreshed', async () => {
    const { s, id } = await setup('done', true);
    const res = await patchPhase(s, id, 'review');
    expect(res.status).toBe(200);
    const doc = todoRecordSchema.parse(await res.json());
    expect(doc.phase).toBe('review');
  });

  test('done(unchanged)->review = 409 (data gate: nothing to reopen for acceptance)', async () => {
    const { s, id } = await setup('done', false);
    const res = await patchPhase(s, id, 'review');
    expect(res.status).toBe(409);
    expect(await res.json()).toHaveProperty('error');
  });

  test('done->todo: never started = 200; changed (already started) = 409 pointing at /reset (#1486)', async () => {
    const fresh = await setup('done');
    const res = await patchPhase(fresh.s, fresh.id, 'todo');
    expect(res.status).toBe(200);
    expect(todoRecordSchema.parse(await res.json()).phase).toBe('todo');
    const started = await setup('done', true);
    expect((await patchPhase(started.s, started.id, 'todo')).status).toBe(409);
  });

  test('done->building = 409 (in-progress only takes to-do sources, observed always-plain surface)', async () => {
    const { s, id } = await setup('done', true);
    const res = await patchPhase(s, id, 'building');
    expect(res.status).toBe(409);
    expect(await res.json()).toHaveProperty('error');
  });
});

describe('manual drop matrix (#753): awaiting source', () => {
  test('confirm->done / review->done = 200 (manual acceptance shortcut; merge step not this surface semantics)', async () => {
    for (const phase of ['confirm', 'review'] as const) {
      const { s, id } = await setup(phase);
      const res = await patchPhase(s, id, 'done');
      expect(res.status, phase).toBe(200);
      expect(todoRecordSchema.parse(await res.json()).phase).toBe('done');
    }
  });

  test('confirm/review/failed->closed = 200 (#1247 canceled ending)', async () => {
    for (const phase of ['confirm', 'review', 'failed'] as const) {
      const { s, id } = await setup(phase);
      const res = await patchPhase(s, id, 'closed');
      expect(res.status, phase).toBe(200);
      expect(todoRecordSchema.parse(await res.json()).phase).toBe('closed');
    }
  });

  test('confirm/review->todo = 200 (reference site: started cards drag back to to-do; reset semantics separate ticket)', async () => {
    for (const phase of ['confirm', 'review'] as const) {
      const { s, id } = await setup(phase);
      const res = await patchPhase(s, id, 'todo');
      expect(res.status, phase).toBe(200);
      expect(todoRecordSchema.parse(await res.json()).phase).toBe('todo');
    }
  });

  test('->in-progress: review->building = 409; confirm->building goes through the legal funnel edge and is still allowed', async () => {
    const review = await setup('review');
    expect((await patchPhase(review.s, review.id, 'building')).status).toBe(409);
    const confirm = await setup('confirm');
    expect((await patchPhase(confirm.s, confirm.id, 'building')).status).toBe(200);
  });

  test('failed→done = 200 without hasChanges (#1247 manual close)', async () => {
    const { s, id } = await setup('failed', false);
    const res = await patchPhase(s, id, 'done');
    expect(res.status).toBe(200);
    expect(todoRecordSchema.parse(await res.json()).phase).toBe('done');
  });

  test('failed->review = 409 and still uses the #702 action-surface dedicated text (legal funnel edge refused by the manual surface)', async () => {
    const { s, id } = await setup('failed', true);
    const res = await patchPhase(s, id, 'review');
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('恢复由合并/审核重跑动作发起');
  });

  test('same-column migration (confirm->review) = 409 (drag produces no intra-column phase rewrite)', async () => {
    const { s, id } = await setup('confirm');
    expect((await patchPhase(s, id, 'review')).status).toBe(409);
  });
});

describe('manual drop matrix (#753): to-do/in-progress sources and non-landing phases', () => {
  test('todo->building = 200 (#160 manual surface kept: legal edges from the flat-whitelist era do not regress)', async () => {
    const { s, id } = await setup('todo');
    const res = await patchPhase(s, id, 'building');
    expect(res.status).toBe(200);
    expect(todoRecordSchema.parse(await res.json()).phase).toBe('building');
  });

  test('todo->review = 409 (to-do->awaiting observed always-plain surface)', async () => {
    const { s, id } = await setup('todo');
    expect((await patchPhase(s, id, 'review')).status).toBe(409);
  });

  test('building->done = 200; building->todo = 409 pointing at /reset (in-progress is already started, #1486)', async () => {
    const a = await setup('building');
    expect((await patchPhase(a.s, a.id, 'todo')).status).toBe(409);
    const b = await setup('building');
    expect((await patchPhase(b.s, b.id, 'done')).status).toBe(200);
  });

  test('non-landing phases (failed/confirm/closed as target) = 409 {error} (funnel fallback)', async () => {
    for (const target of ['failed', 'confirm', 'closed'] as const) {
      const { s, id } = await setup('done', true);
      const res = await patchPhase(s, id, target);
      expect(res.status, target).toBe(409);
      expect(await res.json(), target).toHaveProperty('error');
    }
  });
});
