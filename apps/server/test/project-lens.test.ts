import { describe, expect, test } from 'vitest';
import { H, registerChiefHarness } from './chief-harness.js';
import { req } from './helpers.js';

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
});
