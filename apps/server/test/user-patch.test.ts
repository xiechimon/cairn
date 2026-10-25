import { describe, expect, test } from 'vitest';
import { user as userTable } from '../src/db/schema.js';
import { bootServer, req } from './helpers.js';

async function patchName(s: ReturnType<typeof bootServer>, body: unknown) {
  return req(s.app, 'PATCH', '/api/user/me', body);
}

describe('PATCH /api/user/me (the #1031 rename round trip)', () => {
  test('renaming -> a 200 full-shape receipt + the DB row stored + the three read surfaces show the new name', async () => {
    const s = bootServer();
    try {
      const res = await patchName(s, { displayName: '新名字' });
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.displayName).toBe('新名字');
      expect(body.id).toBe(s.user.id);
      expect(body.avatarUrl).toBeNull();

      const row = s.db.select().from(userTable).all()[0];
      expect(row?.displayName).toBe('新名字');

      const me = (await (await req(s.app, 'GET', '/api/user/me')).json()) as {
        displayName: string;
      };
      expect(me.displayName).toBe('新名字');
      const session = (await (await req(s.app, 'GET', '/api/auth/session')).json()) as {
        displayName: string;
      };
      expect(session.displayName).toBe('新名字');
      const members = (await (
        await req(s.app, 'GET', `/api/teams/${s.team.id}/members`)
      ).json()) as { actor: { displayName: string } }[];
      expect(members[0]?.actor.displayName).toBe('新名字');
    } finally {
      s.dispose();
    }
  });

  test('a second rename converges to the last value (idempotent overwrite, no stacked history)', async () => {
    const s = bootServer();
    try {
      await patchName(s, { displayName: '甲' });
      const res = await patchName(s, { displayName: '乙' });
      expect(((await res.json()) as { displayName: string }).displayName).toBe('乙');
      const me = (await (await req(s.app, 'GET', '/api/user/me')).json()) as {
        displayName: string;
      };
      expect(me.displayName).toBe('乙');
    } finally {
      s.dispose();
    }
  });

  test('a blank name is always the single 400 {error} shape -- empty string / whitespace only / missing field / non-string', async () => {
    const s = bootServer();
    try {
      for (const bad of [{ displayName: '' }, { displayName: '   ' }, {}, { displayName: 7 }]) {
        const res = await patchName(s, bad);
        expect(res.status, JSON.stringify(bad)).toBe(400);
        const body = (await res.json()) as { error?: unknown };
        expect(typeof body.error, JSON.stringify(bad)).toBe('string');
      }
      const row = s.db.select().from(userTable).all()[0];
      expect(row?.displayName).toBe(s.user.displayName);
    } finally {
      s.dispose();
    }
  });
});
