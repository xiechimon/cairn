import { execFileSync } from 'node:child_process';
import { afterAll, describe, expect, test } from 'vitest';
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
