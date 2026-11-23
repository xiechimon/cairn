import { execFileSync } from 'node:child_process';
import { afterAll, describe, expect, test } from 'vitest';
import { pairedDevice } from '../src/db/schema.js';
import { issueBrowserSession } from '../src/services/browser-session.js';
import { bootServer, req } from './helpers.js';

function hasGuiSession(): boolean {
  if (process.platform !== 'darwin') return false;
  try {
    return execFileSync('launchctl', ['managername'], { encoding: 'utf8' }).trim() === 'Aqua';
  } catch {
    return false;
  }
}

const s = bootServer();
afterAll(() => s.dispose());

describe.skipIf(hasGuiSession())(
  'POST /api/fs/pick -- the missing-capability degraded surface (S1/S2)',
  () => {
    test('probe fails -> 422 + reason unavailable, wire shape {error, reason} exact', async () => {
      const res = await req(s.app, 'POST', '/api/fs/pick');
      expect(res.status).toBe(422);
      const body = (await res.json()) as Record<string, unknown>;
      expect(Object.keys(body).sort()).toEqual(['error', 'reason']);
      expect(body.reason).toBe('unavailable');
      expect(typeof body.error).toBe('string');
    });
  },
);

describe('POST /api/fs/pick -- owner-only', () => {
  test('a paired device gets 403 before the picker is ever consulted', async () => {
    const authed = bootServer({ authToken: 'owner-secret-0123456789abcdef' });
    try {
      authed.db
        .insert(pairedDevice)
        .values({
          id: 'phone',
          teamId: authed.team.id,
          name: 'phone',
          tokenHash: 'synthetic',
          masked: 'phone',
          createdAt: 1,
        })
        .run();
      const cookie = `cairn_auth=${issueBrowserSession(authed.db, 'device', 'phone').token}`;
      const res = await authed.app.request('/api/fs/pick', {
        method: 'POST',
        headers: { cookie, 'sec-fetch-site': 'same-origin' },
      });
      expect(res.status).toBe(403);
    } finally {
      authed.dispose();
    }
  });
});
