import { describe, expect, test } from 'vitest';
import { bootServer, req } from './helpers.js';

describe('removed agent surfaces', () => {
  test('every /agents endpoint is gone', async () => {
    const s = bootServer();
    const team = s.team.id;
    for (const [method, path, body] of [
      ['GET', `/api/teams/${team}/agents`, undefined],
      ['POST', `/api/teams/${team}/agents`, { displayName: 'x' }],
      ['PATCH', `/api/teams/${team}/agents/agent-1`, { displayName: 'y' }],
      ['DELETE', `/api/teams/${team}/agents/agent-1`, undefined],
      ['GET', `/api/teams/${team}/agents/agent-1/memories`, undefined],
    ] as const) {
      const res = await req(s.app, method, path, body);
      expect(res.status, `${method} ${path}`).toBe(404);
    }
  });
});
