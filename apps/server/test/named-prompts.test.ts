import { CONTINUE_PROMPTS, DEFAULT_NAMED_PROMPTS, REVIEW_GATE_HEAD } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, test } from 'vitest';
import {
  agent as agentTable,
  project as projectTable,
  step as stepTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { startBuilds } from '../src/services/builds.js';
import { setTodoPhase } from '../src/services/todos.js';
import { bootServer, postProject, req } from './helpers.js';

const s = bootServer();
afterAll(() => s.dispose());

interface PromptRow {
  id: string;
  title: string;
  defaultText: string;
  text: string;
  overridden: boolean;
}

async function listPrompts(): Promise<PromptRow[]> {
  const res = await req(s.app, 'GET', '/api/prompts');
  expect(res.status).toBe(200);
  return (await res.json()) as PromptRow[];
}

async function reviewTodo(projectId: string): Promise<{ todoId: string; buildId: string }> {
  const created = (await (
    await req(s.app, 'POST', `/api/projects/${projectId}/todos`, { title: 'ship me', spec: '' })
  ).json()) as { id: string };
  startBuilds(s.svc, {
    projectId,
    todoIds: [created.id],
    assignment: { plan: null, build: null },
    withPlan: true,
  });
  setTodoPhase(s.svc, created.id, 'planning');
  setTodoPhase(s.svc, created.id, 'confirm');
  s.db
    .update(todoTable)
    .set({ phase: 'review', hasChanges: true })
    .where(eq(todoTable.id, created.id))
    .run();
  const row = s.db.select().from(todoTable).where(eq(todoTable.id, created.id)).get();
  return { todoId: created.id, buildId: row?.latestBuildId ?? '' };
}

function stepsOf(buildId: string, kind: 'merge' | 'review') {
  return s.db
    .select()
    .from(stepTable)
    .where(eq(stepTable.buildId, buildId))
    .all()
    .filter((r) => r.kind === kind);
}

describe('named prompts: list, edit, reset', () => {
  test('lists the built-in Ship and Review defaults with no overrides', async () => {
    const rows = await listPrompts();
    expect(rows.map((r) => r.id)).toEqual(['ship', 'review']);
    for (const row of rows) {
      expect(row.overridden).toBe(false);
      expect(row.text).toBe(row.defaultText);
      expect(row.defaultText).toBe(DEFAULT_NAMED_PROMPTS[row.id as 'ship' | 'review'].text);
    }
  });

  test('PUT stores an override, GET shows it, DELETE resets to the default', async () => {
    const put = await req(s.app, 'PUT', '/api/prompts/ship', { text: 'Merge it my way.' });
    expect(put.status).toBe(200);
    expect(await put.json()).toMatchObject({
      id: 'ship',
      text: 'Merge it my way.',
      overridden: true,
    });
    const ship = (await listPrompts()).find((r) => r.id === 'ship');
    expect(ship).toMatchObject({ text: 'Merge it my way.', overridden: true });
    const review = (await listPrompts()).find((r) => r.id === 'review');
    expect(review?.overridden).toBe(false);

    const reset = await req(s.app, 'DELETE', '/api/prompts/ship');
    expect(reset.status).toBe(200);
    expect((await listPrompts()).find((r) => r.id === 'ship')?.overridden).toBe(false);
  });

  test('rejects unknown ids, blank text, oversized text and extra keys', async () => {
    expect((await req(s.app, 'PUT', '/api/prompts/nope', { text: 'x' })).status).toBe(404);
    expect((await req(s.app, 'DELETE', '/api/prompts/nope')).status).toBe(404);
    expect((await req(s.app, 'PUT', '/api/prompts/ship', { text: '   ' })).status).toBe(400);
    expect(
      (await req(s.app, 'PUT', '/api/prompts/ship', { text: 'x'.repeat(20_001) })).status,
    ).toBe(400);
    expect((await req(s.app, 'PUT', '/api/prompts/ship', { text: 'x', extra: 1 })).status).toBe(
      400,
    );
  });
});

describe('project ship route', () => {
  test('defaults to merge-gate, stores a custom route and survives autonomy and merge-policy patches', async () => {
    const projectId = await postProject(s.app);
    const initial = await req(s.app, 'GET', `/api/projects/${projectId}/ship-route`);
    expect(await initial.json()).toEqual({ shipRoute: 'merge-gate' });

    const set = await req(s.app, 'PUT', `/api/projects/${projectId}/ship-route`, {
      shipRoute: 'custom',
    });
    expect(set.status).toBe(200);
    expect(await set.json()).toEqual({ shipRoute: 'custom' });

    await req(s.app, 'PATCH', `/api/projects/${projectId}/autonomy`, { quietMinutes: 5 });
    await req(s.app, 'PATCH', `/api/projects/${projectId}/merge-policy`, { mergePolicy: 'human' });
    const after = await req(s.app, 'GET', `/api/projects/${projectId}/ship-route`);
    expect(await after.json()).toEqual({ shipRoute: 'custom' });
  });

  test('local-merge is refused for a project that is not a local repository', async () => {
    const projectId = await postProject(s.app);
    const res = await req(s.app, 'PUT', `/api/projects/${projectId}/ship-route`, {
      shipRoute: 'local-merge',
    });
    expect(res.status).toBe(409);
    const read = await req(s.app, 'GET', `/api/projects/${projectId}/ship-route`);
    expect(await read.json()).toEqual({ shipRoute: 'merge-gate' });
  });

  test('rejects an unknown route and an unknown project', async () => {
    const projectId = await postProject(s.app);
    expect(
      (await req(s.app, 'PUT', `/api/projects/${projectId}/ship-route`, { shipRoute: 'yolo' }))
        .status,
    ).toBe(400);
    expect(
      (await req(s.app, 'PUT', '/api/projects/missing/ship-route', { shipRoute: 'custom' })).status,
    ).toBe(404);
  });

  test('local-merge is accepted for a local repository project', async () => {
    const projectId = await postProject(s.app);
    s.db
      .update(projectTable)
      .set({ repoKind: 'local' })
      .where(eq(projectTable.id, projectId))
      .run();
    const res = await req(s.app, 'PUT', `/api/projects/${projectId}/ship-route`, {
      shipRoute: 'local-merge',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ shipRoute: 'local-merge' });
  });
});

describe('the ship action uses the stored route and prompt', () => {
  test('merge-gate route ignores the edited Ship prompt', async () => {
    const projectId = await postProject(s.app);
    const { buildId } = await reviewTodo(projectId);
    await req(s.app, 'PUT', '/api/prompts/ship', { text: 'should not be used' });
    const res = await req(s.app, 'POST', `/api/builds/${buildId}/merge`);
    expect(res.status).toBe(202);
    const merges = stepsOf(buildId, 'merge');
    expect(merges).toHaveLength(1);
    expect(merges[0]?.prompt).not.toBe('should not be used');
    await req(s.app, 'DELETE', '/api/prompts/ship');
  });

  test('custom route enqueues a merge step carrying the edited Ship prompt', async () => {
    const projectId = await postProject(s.app);
    await req(s.app, 'PUT', `/api/projects/${projectId}/ship-route`, { shipRoute: 'custom' });
    await req(s.app, 'PUT', '/api/prompts/ship', { text: 'Squash and push to main.' });
    const { buildId } = await reviewTodo(projectId);
    const res = await req(s.app, 'POST', `/api/builds/${buildId}/merge`);
    expect(res.status).toBe(202);
    expect(stepsOf(buildId, 'merge')[0]?.prompt).toBe('Squash and push to main.');
    await req(s.app, 'DELETE', '/api/prompts/ship');
  });

  test('custom route without an edit falls back to the default Ship text', async () => {
    const projectId = await postProject(s.app);
    await req(s.app, 'PUT', `/api/projects/${projectId}/ship-route`, { shipRoute: 'custom' });
    const { buildId } = await reviewTodo(projectId);
    await req(s.app, 'POST', `/api/builds/${buildId}/merge`);
    expect(stepsOf(buildId, 'merge')[0]?.prompt).toBe(CONTINUE_PROMPTS.merge);
  });

  test('review action swaps the review-gate instruction for the edited Review prompt only when overridden', async () => {
    const agentId = 'agent-named-prompts';
    s.db
      .insert(agentTable)
      .values({ id: agentId, teamId: s.team.id, displayName: 'Reviewer', status: 'active' })
      .run();
    const projectId = await postProject(s.app);

    const plain = await reviewTodo(projectId);
    const first = await req(s.app, 'POST', `/api/builds/${plain.buildId}/steps`, {
      action: 'review',
      agentId,
    });
    expect(first.status).toBe(202);
    expect(stepsOf(plain.buildId, 'review')[0]?.prompt ?? '').toContain(REVIEW_GATE_HEAD);

    await req(s.app, 'PUT', '/api/prompts/review', { text: 'Only look for data loss.' });
    const edited = await reviewTodo(projectId);
    const second = await req(s.app, 'POST', `/api/builds/${edited.buildId}/steps`, {
      action: 'review',
      agentId,
    });
    expect(second.status).toBe(202);
    const editedPrompt = stepsOf(edited.buildId, 'review')[0]?.prompt ?? '';
    expect(editedPrompt).toContain('Only look for data loss.');
    expect(editedPrompt).not.toContain(REVIEW_GATE_HEAD);
    expect(editedPrompt).toContain('## 输出契约');
    await req(s.app, 'DELETE', '/api/prompts/review');
  });
});
