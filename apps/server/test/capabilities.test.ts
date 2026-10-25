import { capabilitiesResponseSchema } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { bootServer, req } from './helpers.js';

describe('GET /api/capabilities (capabilities read surface)', () => {
  test('200 + envelope shape, tiers = pi seven tiers ordered verbatim', async () => {
    const s = bootServer();
    const res = await req(s.app, 'GET', '/api/capabilities');
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    expect(capabilitiesResponseSchema.safeParse(body).success).toBe(true);
    expect(body).toEqual({
      thinkingLevels: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
    });
  });

  test('team-independent read surface: answers without a team param too (capabilities are engine facts, not forked per team)', async () => {
    const s = bootServer();
    const res = await req(s.app, 'GET', '/api/capabilities');
    expect(res.status).toBe(200);
  });
});
