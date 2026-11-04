import { eq } from 'drizzle-orm';
import { expect, test } from 'vitest';
import { project } from '../src/db/schema.js';
import { bootServer, req } from './helpers.js';

test('icon and colour survive PATCH, GET and unrelated edits, and clear with null', async () => {
  const s = bootServer();
  const created = await req(s.app, 'POST', '/api/projects', { name: 'avatars' });
  const { id } = (await created.json()) as { id: string };

  const patched = await req(s.app, 'PATCH', `/api/projects/${id}`, {
    icon: 'flask-conical',
    color: 'plum',
  });
  expect(patched.status).toBe(200);
  expect(await patched.json()).toMatchObject({ icon: 'flask-conical', color: 'plum' });
  expect(await (await req(s.app, 'GET', '/api/projects')).json()).toEqual(
    expect.arrayContaining([expect.objectContaining({ id, icon: 'flask-conical', color: 'plum' })]),
  );

  const renamed = await req(s.app, 'PATCH', `/api/projects/${id}`, { name: 'renamed' });
  expect(await renamed.json()).toMatchObject({ icon: 'flask-conical', color: 'plum' });

  const colourOnly = await req(s.app, 'PATCH', `/api/projects/${id}`, { color: 'gray' });
  expect(await colourOnly.json()).toMatchObject({ icon: 'flask-conical', color: 'gray' });

  const cleared = await req(s.app, 'PATCH', `/api/projects/${id}`, { icon: null, color: null });
  expect(cleared.status).toBe(200);
  expect(s.db.select().from(project).where(eq(project.id, id)).get()).toMatchObject({
    icon: null,
    color: null,
  });
  expect(await cleared.json()).not.toHaveProperty('icon');
});

test('an unknown icon or colour is rejected and nothing is stored', async () => {
  const s = bootServer();
  const created = await req(s.app, 'POST', '/api/projects', { name: 'avatars' });
  const { id } = (await created.json()) as { id: string };
  expect((await req(s.app, 'PATCH', `/api/projects/${id}`, { icon: 'not-an-icon' })).status).toBe(
    400,
  );
  expect((await req(s.app, 'PATCH', `/api/projects/${id}`, { color: 'chartreuse' })).status).toBe(
    400,
  );
  expect(s.db.select().from(project).where(eq(project.id, id)).get()).toMatchObject({
    icon: null,
    color: null,
  });
});
