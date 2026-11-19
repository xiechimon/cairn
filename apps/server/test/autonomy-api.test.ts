import { DEFAULT_AUTONOMY_SETTINGS } from '@cairn/shared';
import { afterEach, describe, expect, test } from 'vitest';
import {
  actionTierOf,
  countsAsMemberWrite,
  lastMemberWriteAt,
} from '../src/services/autonomy-gates.js';
import { bootServer, req, type TestServer } from './helpers.js';

const servers: TestServer[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.dispose();
});

async function boot(): Promise<{ s: TestServer; projectId: string }> {
  const s = bootServer();
  servers.push(s);
  const res = await req(s.app, 'POST', '/api/projects', { name: 'gates' });
  expect(res.status).toBe(201);
  return { s, projectId: ((await res.json()) as { id: string }).id };
}

describe('GET / PATCH /api/projects/{id}/autonomy', () => {
  test('a new project follows the team tier and reads an empty history', async () => {
    const { s, projectId } = await boot();
    const res = await req(s.app, 'GET', `/api/projects/${projectId}/autonomy`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      settings: DEFAULT_AUTONOMY_SETTINGS,
      actionTierOverride: null,
      spentTodayUsd: 0,
      kinds: [
        {
          kind: 'issue-intake',
          lastStartedAt: null,
          lastBlockedReason: null,
          lastEvaluatedAt: null,
        },
        { kind: 'scheduling', lastStartedAt: null, lastBlockedReason: null, lastEvaluatedAt: null },
      ],
    });
  });

  test('PATCH merges the given keys; missing keys stay', async () => {
    const { s, projectId } = await boot();
    const res = await req(s.app, 'PATCH', `/api/projects/${projectId}/autonomy`, {
      enabled: false,
      dailyBudgetUsd: 2.5,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { settings: unknown };
    expect(body.settings).toEqual({
      ...DEFAULT_AUTONOMY_SETTINGS,
      enabled: false,
      dailyBudgetUsd: 2.5,
    });
    const again = await req(s.app, 'GET', `/api/projects/${projectId}/autonomy`);
    expect(((await again.json()) as { settings: unknown }).settings).toEqual(body.settings);
  });

  test('PATCH actionTier pins an explicit tier over the team default', async () => {
    const { s, projectId } = await boot();
    const res = await req(s.app, 'PATCH', `/api/projects/${projectId}/autonomy`, {
      actionTier: 'guarded',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      settings: { actionTier: string };
      actionTierOverride: string | null;
    };
    expect(body.settings.actionTier).toBe('guarded');
    expect(body.actionTierOverride).toBe('guarded');
    const again = await req(s.app, 'GET', `/api/projects/${projectId}/autonomy`);
    const persisted = (await again.json()) as {
      settings: { actionTier: string };
      actionTierOverride: string | null;
    };
    expect(persisted.settings.actionTier).toBe('guarded');
    expect(persisted.actionTierOverride).toBe('guarded');
  });

  test.each([
    ['unknown key', { surprise: 1 }],
    ['negative minutes', { quietMinutes: -1 }],
    ['fractional minutes', { cooldownMinutes: 1.5 }],
    ['negative budget', { dailyBudgetUsd: -0.01 }],
    ['wrong type', { enabled: 'yes' }],
    ['unknown tier', { actionTier: 'bold' }],
  ])('PATCH rejects %s with 400', async (_name, body) => {
    const { s, projectId } = await boot();
    const res = await req(s.app, 'PATCH', `/api/projects/${projectId}/autonomy`, body);
    expect(res.status).toBe(400);
  });

  test('unknown project → 404', async () => {
    const { s } = await boot();
    expect((await req(s.app, 'GET', '/api/projects/nope/autonomy')).status).toBe(404);
    expect((await req(s.app, 'PATCH', '/api/projects/nope/autonomy', {})).status).toBe(404);
  });
});

describe('GET / PATCH /api/teams/{id}/autonomy', () => {
  test('a fresh team defaults to full; PATCH persists the global tier', async () => {
    const { s } = await boot();
    const res = await req(s.app, 'GET', `/api/teams/${s.team.id}/autonomy`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ actionTier: 'full' });
    const patched = await req(s.app, 'PATCH', `/api/teams/${s.team.id}/autonomy`, {
      actionTier: 'guarded',
    });
    expect(patched.status).toBe(200);
    expect(await patched.json()).toEqual({ actionTier: 'guarded' });
    const again = await req(s.app, 'GET', `/api/teams/${s.team.id}/autonomy`);
    expect(await again.json()).toEqual({ actionTier: 'guarded' });
  });

  test.each([
    ['unknown key', { surprise: 1 }],
    ['unknown tier', { actionTier: 'bold' }],
    ['null tier', { actionTier: null }],
  ])('PATCH rejects %s with 400', async (_name, body) => {
    const { s } = await boot();
    const res = await req(s.app, 'PATCH', `/api/teams/${s.team.id}/autonomy`, body);
    expect(res.status).toBe(400);
  });

  test('unknown team → 404', async () => {
    const { s } = await boot();
    expect((await req(s.app, 'GET', '/api/teams/nope/autonomy')).status).toBe(404);
    expect((await req(s.app, 'PATCH', '/api/teams/nope/autonomy', {})).status).toBe(404);
  });
});

describe('action-tier resolution: project explicit → team → full', () => {
  async function patchTeam(s: TestServer, actionTier: 'guarded' | 'full'): Promise<void> {
    const res = await req(s.app, 'PATCH', `/api/teams/${s.team.id}/autonomy`, { actionTier });
    expect(res.status).toBe(200);
  }

  test('a project without an explicit tier inherits the team tier', async () => {
    const { s, projectId } = await boot();
    expect(actionTierOf(s.db, s.team.id, projectId)).toBe('full');
    await patchTeam(s, 'guarded');
    expect(actionTierOf(s.db, s.team.id, projectId)).toBe('guarded');
    const res = await req(s.app, 'GET', `/api/projects/${projectId}/autonomy`);
    const body = (await res.json()) as {
      settings: { actionTier: string };
      actionTierOverride: string | null;
    };
    expect(body.settings.actionTier).toBe('guarded');
    expect(body.actionTierOverride).toBeNull();
  });

  test('an explicit project tier beats the team tier', async () => {
    const { s, projectId } = await boot();
    await patchTeam(s, 'full');
    const res = await req(s.app, 'PATCH', `/api/projects/${projectId}/autonomy`, {
      actionTier: 'guarded',
    });
    expect(res.status).toBe(200);
    expect(actionTierOf(s.db, s.team.id, projectId)).toBe('guarded');
  });

  test('an unset team tier resolves to full; a null projectId uses the team tier', async () => {
    const { s, projectId } = await boot();
    expect(actionTierOf(s.db, s.team.id, null)).toBe('full');
    expect(actionTierOf(s.db, s.team.id, projectId)).toBe('full');
    await patchTeam(s, 'guarded');
    expect(actionTierOf(s.db, s.team.id, null)).toBe('guarded');
  });

  test('a project in another team does not leak its explicit tier', async () => {
    const { s, projectId } = await boot();
    const res = await req(s.app, 'PATCH', `/api/projects/${projectId}/autonomy`, {
      actionTier: 'guarded',
    });
    expect(res.status).toBe(200);
    expect(actionTierOf(s.db, 'other-team', projectId)).toBe('full');
    expect(actionTierOf(s.db, 'other-team', 'missing-project')).toBe('full');
  });

  test('writing actionTier null makes the project follow the team again', async () => {
    const { s, projectId } = await boot();
    const pin = await req(s.app, 'PATCH', `/api/projects/${projectId}/autonomy`, {
      actionTier: 'guarded',
    });
    expect(pin.status).toBe(200);
    await patchTeam(s, 'full');
    expect(actionTierOf(s.db, s.team.id, projectId)).toBe('guarded');
    const unpinned = await req(s.app, 'PATCH', `/api/projects/${projectId}/autonomy`, {
      actionTier: null,
    });
    expect(unpinned.status).toBe(200);
    const body = (await unpinned.json()) as {
      settings: { actionTier: string };
      actionTierOverride: string | null;
    };
    expect(body.actionTierOverride).toBeNull();
    expect(body.settings.actionTier).toBe('full');
    expect(actionTierOf(s.db, s.team.id, projectId)).toBe('full');
    await patchTeam(s, 'guarded');
    expect(actionTierOf(s.db, s.team.id, projectId)).toBe('guarded');
  });

  test('patching other autonomy keys keeps the follow-global state', async () => {
    const { s, projectId } = await boot();
    const res = await req(s.app, 'PATCH', `/api/projects/${projectId}/autonomy`, {
      quietMinutes: 30,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { actionTierOverride: string | null };
    expect(body.actionTierOverride).toBeNull();
    await patchTeam(s, 'guarded');
    expect(actionTierOf(s.db, s.team.id, projectId)).toBe('guarded');
  });
});

describe('member_activity: only a member’s successful writes count', () => {
  test('a successful POST is recorded; a GET and a failed write are not', async () => {
    const s = bootServer();
    servers.push(s);
    expect(lastMemberWriteAt(s.db)).toBeNull();
    await req(s.app, 'GET', '/api/projects');
    expect(lastMemberWriteAt(s.db)).toBeNull();
    expect((await req(s.app, 'POST', '/api/projects', {})).status).toBe(400);
    expect(lastMemberWriteAt(s.db)).toBeNull();
    const before = Date.now();
    expect((await req(s.app, 'POST', '/api/projects', { name: 'x' })).status).toBe(201);
    expect(lastMemberWriteAt(s.db)).toBeGreaterThanOrEqual(before);
  });

  test.each([
    ['POST', '/api/projects', 201, true],
    ['PATCH', '/api/todos/t1', 200, true],
    ['DELETE', '/api/projects/p1', 204, true],
    ['GET', '/api/projects', 200, false],
    ['HEAD', '/api/projects', 200, false],
    ['POST', '/api/projects', 409, false],
    ['POST', '/api/mcp', 200, false],
    ['POST', '/api/machine/claim', 200, false],
    ['POST', '/api/webhook/github/tok', 202, false],
    ['POST', '/api/webhook/schedule/tok', 202, false],
    ['GET', '/api/oauth/callback', 302, false],
    ['POST', '/api/machinefoo', 200, true],
    ['POST', '/git/team/repo', 200, false],
  ] as const)('%s %s (%i) → %s', (method, path, status, counts) => {
    expect(countsAsMemberWrite(method, path, status)).toBe(counts);
  });
});
