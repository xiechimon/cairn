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
      githubOAuth: false,
      githubDeviceInstallUrl: 'https://github.com/apps/cairnwright/installations/new',
    });
  });

  test('githubOAuth is true only when the server has a GitHub OAuth client', async () => {
    const s = bootServer({ oauthClient: { clientId: 'id', clientSecret: 'secret' } });
    const res = await req(s.app, 'GET', '/api/capabilities');
    expect(await res.json()).toMatchObject({ githubOAuth: true });
  });

  test('team-independent read surface: answers without a team param too (capabilities are engine facts, not forked per team)', async () => {
    const s = bootServer();
    const res = await req(s.app, 'GET', '/api/capabilities');
    expect(res.status).toBe(200);
  });
});
