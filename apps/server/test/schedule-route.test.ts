import { afterEach, describe, expect, test } from 'vitest';
import { bootServer, req, type TestServer } from './helpers.js';

const servers: TestServer[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.dispose();
});

describe('GET /api/projects/{id}/schedule', () => {
  test('returns null before the first weekly run', async () => {
    const s = bootServer();
    servers.push(s);
    const created = await req(s.app, 'POST', '/api/projects', { name: 'sched-route' });
    expect(created.status).toBe(201);
    const projectId = ((await created.json()) as { id: string }).id;
    const res = await req(s.app, 'GET', `/api/projects/${projectId}/schedule`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ report: null });
  });

  test('unknown project → 404', async () => {
    const s = bootServer();
    servers.push(s);
    expect((await req(s.app, 'GET', '/api/projects/nope/schedule')).status).toBe(404);
  });
});

describe('schedule route table', () => {
  test('POST schedule and execute are absent (GET only in this ticket)', async () => {
    const s = bootServer();
    servers.push(s);
    const created = await req(s.app, 'POST', '/api/projects', { name: 'sched-write-pin' });
    expect(created.status).toBe(201);
    const projectId = ((await created.json()) as { id: string }).id;
    expect((await req(s.app, 'POST', `/api/projects/${projectId}/schedule`, {})).status).toBe(404);
    expect(
      (
        await req(s.app, 'POST', `/api/projects/${projectId}/schedule/execute`, {
          reportId: 'x',
          issues: [1],
        })
      ).status,
    ).toBe(404);
  });
});
