import type { CoordinatorPageResponse } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { setTodoPhase } from '../src/services/todos.js';
import { H, registerChiefHarness, relay } from './chief-harness.js';
import { postProject, req } from './helpers.js';

registerChiefHarness();

describe('Duet project lens', () => {
  test('projects round-trip a nullable group through the existing project API', async () => {
    const initial = await req(H.s.app, 'GET', '/api/projects');
    expect(await initial.json()).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: H.projectId, group: null })]),
    );
    for (const group of ['Side projects', 'Personal', null]) {
      const patched = await req(H.s.app, 'PATCH', `/api/projects/${H.projectId}`, { group });
      expect(patched.status).toBe(200);
      expect(await patched.json()).toMatchObject({ group });
      const listed = await req(H.s.app, 'GET', '/api/projects');
      expect(await listed.json()).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: H.projectId, group })]),
      );
    }
  });

  test('omitted group preserves membership and invalid names do not mutate it', async () => {
    const url = `/api/projects/${H.projectId}`;
    expect((await req(H.s.app, 'PATCH', url, { group: '  Side projects  ' })).status).toBe(200);
    const renamed = await req(H.s.app, 'PATCH', url, { name: 'Renamed' });
    expect(await renamed.json()).toMatchObject({ group: 'Side projects' });
    for (const group of ['', '   ', 1]) {
      expect((await req(H.s.app, 'PATCH', url, { group })).status).toBe(400);
    }
    const listed = await req(H.s.app, 'GET', '/api/projects');
    expect(await listed.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: H.projectId, group: 'Side projects' }),
      ]),
    );
  });

  test('a project filter returns its verbatim owner message and task card only', async () => {
    const other = await postProject(H.s.app, 'other');
    const url = `/api/teams/${H.teamId}/coordinator`;
    const sent = await req(H.s.app, 'POST', `${url}/messages`, {
      content: 'Keep these exact words',
      projectId: H.projectId,
    });
    expect(sent.status).toBe(201);
    const { message } = (await sent.json()) as { message: { id: string } };
    await req(H.s.app, 'POST', `${url}/messages`, { content: 'Other project', projectId: other });
    await req(H.s.app, 'POST', `${url}/messages`, { content: 'Everything only' });
    const task = (await relay('create_todo', {
      projectId: H.projectId,
      title: 'Lens task',
      spec: 'Keep these exact words',
    })) as { id: string };
    for (const phase of ['queued', 'building', 'done'] as const)
      setTodoPhase(H.s.svc, task.id, phase);
    const filtered = await req(H.s.app, 'GET', `${url}?projectId=${H.projectId}`);
    expect(filtered.status).toBe(200);
    const page = (await filtered.json()) as CoordinatorPageResponse;
    expect(page.messages).toHaveLength(2);
    expect(page.messages).toContainEqual(
      expect.objectContaining({
        id: message.id,
        content: 'Keep these exact words',
        projectId: H.projectId,
      }),
    );
    expect(page.messages).toContainEqual(
      expect.objectContaining({
        projectId: H.projectId,
        content: expect.stringContaining(task.id),
      }),
    );
    const all = await req(H.s.app, 'GET', url);
    expect(((await all.json()) as CoordinatorPageResponse).messages).toHaveLength(4);
  });
});
