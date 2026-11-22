import { eq } from 'drizzle-orm';
import { expect, test } from 'vitest';
import { project } from '../src/db/schema.js';
import { seed } from '../src/db/seed.js';
import { issueBrowserSession } from '../src/services/browser-session.js';
import { upsertGithubConnection } from '../src/services/github-connection.js';
import { createPairedDevice } from '../src/services/paired-devices.js';
import { bootServer, postProject, req, teamPausedForTest } from './helpers.js';

test('team autonomy pause persists, is readable after reseeding, and unpauses without changing other settings', async () => {
  const s = bootServer();
  try {
    const before = await (await req(s.app, 'GET', '/api/teams')).json();
    expect(before).toMatchObject([{ autonomyPaused: false }]);
    const paused = await req(s.app, 'PATCH', `/api/teams/${s.team.id}`, { autonomyPaused: true });
    expect(paused.status).toBe(200);
    expect(await paused.json()).toMatchObject({ autonomyPaused: true });
    expect(teamPausedForTest(s.db, s.team.id)).toBe(true);
    seed(s.db);
    expect(await (await req(s.app, 'GET', '/api/teams')).json()).toMatchObject([
      { autonomyPaused: true },
    ]);
    const limit = await req(s.app, 'PATCH', `/api/teams/${s.team.id}`, {
      maxAutonomousMergesPerDay: 5,
    });
    expect(await limit.json()).toMatchObject({
      autonomyPaused: true,
      maxAutonomousMergesPerDay: 5,
    });
    const unpaused = await req(s.app, 'PATCH', `/api/teams/${s.team.id}`, {
      autonomyPaused: false,
    });
    expect(await unpaused.json()).toMatchObject({
      autonomyPaused: false,
      maxAutonomousMergesPerDay: 5,
    });
  } finally {
    s.dispose();
  }
});

test('team autonomy pause rejects non-booleans and other teams without writing', async () => {
  const s = bootServer();
  try {
    expect(
      (await req(s.app, 'PATCH', `/api/teams/${s.team.id}`, { autonomyPaused: 'true' })).status,
    ).toBe(400);
    expect(
      (await req(s.app, 'PATCH', '/api/teams/not-mine', { autonomyPaused: true })).status,
    ).toBe(404);
    expect(await (await req(s.app, 'GET', '/api/teams')).json()).toMatchObject([
      { autonomyPaused: false },
    ]);
  } finally {
    s.dispose();
  }
});

test('autonomy pause and explicit resume require an owner, not a paired device', async () => {
  const s = bootServer({ authToken: 'owner-fixture' });
  try {
    const { device: phone } = createPairedDevice(s.db, { teamId: s.team.id, name: 'Phone' });
    const device = issueBrowserSession(s.db, 'device', phone.id);
    const patch = (paused: boolean, auth: Record<string, string>) =>
      s.app.request(`/api/teams/${s.team.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', ...auth },
        body: JSON.stringify({ autonomyPaused: paused }),
      });
    const owner = { authorization: 'Bearer owner-fixture' };
    const paired = { cookie: `cairn_auth=${device.token}` };
    expect((await patch(true, paired)).status).toBe(403);
    expect((await patch(true, owner)).status).toBe(200);
    expect((await patch(false, paired)).status).toBe(403);
    expect(teamPausedForTest(s.db, s.team.id)).toBe(true);
    expect((await patch(false, owner)).status).toBe(200);
  } finally {
    s.dispose();
  }
});

test('pausing through the product opens the GitHub marker for each GitHub project', async () => {
  const writes: string[] = [];
  const s = bootServer({
    githubFetch: async (url, init) => {
      if (init?.method === 'POST') writes.push(String(url));
      return Response.json(
        String(url).includes('/issues?') ? [] : { number: 7, node_id: 'issue-7' },
      );
    },
  });
  try {
    upsertGithubConnection(
      { db: s.db, box: s.secretBox },
      { teamId: s.team.id, login: 'owner', accessToken: 'token', scope: 'repo' },
    );
    const id = await postProject(s.app, 'github');
    s.db
      .update(project)
      .set({ repoKind: 'github', githubRepo: 'owner/repo' })
      .where(eq(project.id, id))
      .run();
    const response = await req(s.app, 'PATCH', `/api/teams/${s.team.id}`, { autonomyPaused: true });
    expect(response.status).toBe(200);
    expect(writes).toContain('https://api.github.com/repos/owner/repo/issues');
  } finally {
    s.dispose();
  }
});
