import { beforeEach, describe, expect, test } from 'vitest';
import { createSecret, openSecretValues } from '../src/services/secrets.js';
import { bootServer, req, type TestServer } from './helpers.js';

let s: TestServer;

const deps = () => ({ db: s.db, box: s.secretBox });

async function createProject(name: string): Promise<string> {
  const res = await req(s.app, 'POST', '/api/projects', { name });
  return ((await res.json()) as { id: string }).id;
}

beforeEach(() => {
  s = bootServer();
});

describe('project secrets are stored per project (D74 P5)', () => {
  test('a secret can belong to a project and the API returns its project', async () => {
    const id = await createProject('cairn');
    const res = await req(s.app, 'POST', `/api/teams/${s.team.id}/secrets`, {
      name: 'DEPLOY_TOKEN',
      value: 'proj-value',
      projectId: id,
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ name: 'DEPLOY_TOKEN', projectId: id });
    const listed = (await (await req(s.app, 'GET', `/api/teams/${s.team.id}/secrets`)).json()) as {
      name: string;
      projectId: string | null;
    }[];
    expect(listed).toEqual([expect.objectContaining({ name: 'DEPLOY_TOKEN', projectId: id })]);
  });

  test('the same name may exist once team-wide and once per project, not twice in one scope', async () => {
    const id = await createProject('cairn');
    const post = (body: Record<string, unknown>) =>
      req(s.app, 'POST', `/api/teams/${s.team.id}/secrets`, { value: 'v', ...body });
    expect((await post({ name: 'TOKEN' })).status).toBe(201);
    expect((await post({ name: 'TOKEN', projectId: id })).status).toBe(201);
    expect((await post({ name: 'TOKEN', projectId: id })).status).toBe(409);
    expect((await post({ name: 'TOKEN' })).status).toBe(409);
  });

  test('a project outside the team is refused', async () => {
    const res = await req(s.app, 'POST', `/api/teams/${s.team.id}/secrets`, {
      name: 'TOKEN',
      value: 'v',
      projectId: 'no-such-project',
    });
    expect(res.status).toBe(404);
  });
});

describe('a step only receives secrets of its own project (D74 P5)', () => {
  test('a granted secret of another project is withheld; team secrets still flow', async () => {
    const mine = await createProject('cairn');
    const other = await createProject('site');
    const team = createSecret(deps(), { teamId: s.team.id, name: 'TEAM', value: 'team-value' });
    const foreign = createSecret(deps(), {
      teamId: s.team.id,
      name: 'SITE_ONLY',
      value: 'site-value',
      projectId: other,
    });
    expect(openSecretValues(deps(), s.team.id, [team.id, foreign.id], mine)).toEqual({
      TEAM: 'team-value',
    });
  });

  test('a project secret with the same name as a granted team secret wins', async () => {
    const mine = await createProject('cairn');
    const team = createSecret(deps(), { teamId: s.team.id, name: 'TOKEN', value: 'team-value' });
    createSecret(deps(), {
      teamId: s.team.id,
      name: 'TOKEN',
      value: 'project-value',
      projectId: mine,
    });
    expect(openSecretValues(deps(), s.team.id, [team.id], mine)).toEqual({
      TOKEN: 'project-value',
    });
  });

  test('a step of another project still gets the team value of that name', async () => {
    const mine = await createProject('cairn');
    const other = await createProject('site');
    const team = createSecret(deps(), { teamId: s.team.id, name: 'TOKEN', value: 'team-value' });
    createSecret(deps(), {
      teamId: s.team.id,
      name: 'TOKEN',
      value: 'project-value',
      projectId: mine,
    });
    expect(openSecretValues(deps(), s.team.id, [team.id], other)).toEqual({ TOKEN: 'team-value' });
  });
});
