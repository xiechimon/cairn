import { expect, test } from 'vitest';
import { createTodo, setTodoArchived } from '../src/services/todos.js';
import { bootServer, postProject, req } from './helpers.js';

async function world() {
  const s = bootServer();
  const projectId = await postProject(s.app);
  const make = (title: string) =>
    createTodo(s.svc, {
      teamId: s.team.id,
      projectId,
      title,
      spec: '',
      createdBy: s.user.id,
      ownerId: s.user.id,
    });
  return { ...s, make };
}

async function titles(s: Awaited<ReturnType<typeof world>>, query: string) {
  const res = await req(s.app, 'GET', `/api/todos?teamId=${s.team.id}${query}`);
  expect(res.status).toBe(200);
  return ((await res.json()) as { title: string }[]).map((row) => row.title);
}

test('the default list omits archived threads and archived=1 lists only them', async () => {
  const s = await world();
  s.make('open one');
  const gone = s.make('archived one');
  setTodoArchived(s.svc, gone.id, true);
  expect(await titles(s, '')).toEqual(['open one']);
  expect(await titles(s, '&archived=1')).toEqual(['archived one']);
});

test('archived=1 with nothing archived returns an empty list and unarchive removes the row', async () => {
  const s = await world();
  const record = s.make('toggled');
  expect(await titles(s, '&archived=1')).toEqual([]);
  setTodoArchived(s.svc, record.id, true);
  expect(await titles(s, '&archived=1')).toEqual(['toggled']);
  setTodoArchived(s.svc, record.id, false);
  expect(await titles(s, '&archived=1')).toEqual([]);
});
