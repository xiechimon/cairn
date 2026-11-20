import { afterEach, describe, expect, test } from 'vitest';
import { actionTierOf } from '../src/services/autonomy.js';
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
  test('a new project follows the team tier', async () => {
    const { s, projectId } = await boot();
    const res = await req(s.app, 'GET', `/api/projects/${projectId}/autonomy`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ actionTier: 'full', actionTierOverride: null });
  });

  test('PATCH actionTier pins an explicit tier over the team default', async () => {
    const { s, projectId } = await boot();
    const res = await req(s.app, 'PATCH', `/api/projects/${projectId}/autonomy`, {
      actionTier: 'guarded',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      actionTier: string;
      actionTierOverride: string | null;
    };
    expect(body.actionTier).toBe('guarded');
    expect(body.actionTierOverride).toBe('guarded');
    const again = await req(s.app, 'GET', `/api/projects/${projectId}/autonomy`);
    expect(await again.json()).toEqual({ actionTier: 'guarded', actionTierOverride: 'guarded' });
  });

  test.each([
    ['unknown key', { surprise: 1 }],
    ['retired gate key', { quietMinutes: 30 }],
    ['retired gate flag', { enabled: false }],
    ['unknown tier', { actionTier: 'bold' }],
    ['wrong type', { actionTier: 1 }],
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
      actionTier: string;
      actionTierOverride: string | null;
    };
    expect(body.actionTier).toBe('guarded');
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
      actionTier: string;
      actionTierOverride: string | null;
    };
    expect(body.actionTierOverride).toBeNull();
    expect(body.actionTier).toBe('full');
    expect(actionTierOf(s.db, s.team.id, projectId)).toBe('full');
    await patchTeam(s, 'guarded');
    expect(actionTierOf(s.db, s.team.id, projectId)).toBe('guarded');
  });
});
