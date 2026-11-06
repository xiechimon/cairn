import { expect, test } from 'vitest';
import { bootServer, req } from './helpers.js';

test('sending to a Coordinator with no agent is a 409 carrying the coordinator-not-ready reason', async () => {
  const s = bootServer();
  const res = await req(s.app, 'POST', `/api/teams/${s.team.id}/chief/threads`, {
    content: 'hello',
  });
  expect(res.status).toBe(409);
  const body = (await res.json()) as { error: string; reason?: string };
  expect(body.reason).toBe('coordinator-not-ready');
});
