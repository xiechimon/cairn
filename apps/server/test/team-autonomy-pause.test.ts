import { eq } from 'drizzle-orm';
import { expect, test } from 'vitest';
import { project, team } from '../src/db/schema.js';
import { seed } from '../src/db/seed.js';
import { upsertGithubConnection } from '../src/services/github-connection.js';
import { bootServer, postProject, req } from './helpers.js';

test('team autonomy pause persists, is readable after reseeding, and unpauses without changing other settings', async () => {
  const s = bootServer();
  try {
    const before = await (await req(s.app, 'GET', '/api/teams')).json();
    expect(before).toMatchObject([{ autonomyPaused: false }]);
    const paused = await req(s.app, 'PATCH', `/api/teams/${s.team.id}`, { autonomyPaused: true });
    expect(paused.status).toBe(200);
    expect(await paused.json()).toMatchObject({ autonomyPaused: true });
    expect(s.db.select().from(team).where(eq(team.id, s.team.id)).get()).toMatchObject({
      autonomyPaused: true,
    });
    expect(seed(s.db).team).toMatchObject({ autonomyPaused: true });
    expect(await (await req(s.app, 'GET', '/api/teams')).json()).toMatchObject([
      { autonomyPaused: true },
    ]);
    const prompt = await req(s.app, 'PATCH', `/api/teams/${s.team.id}`, {
      firstPrReportPrompt: { enabled: true },
    });
    expect(await prompt.json()).toMatchObject({
      autonomyPaused: true,
      firstPrReportPrompt: { enabled: true },
    });
    const unpaused = await req(s.app, 'PATCH', `/api/teams/${s.team.id}`, {
      autonomyPaused: false,
    });
    expect(await unpaused.json()).toMatchObject({
      autonomyPaused: false,
      firstPrReportPrompt: { enabled: true },
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

test('pausing through the product opens the GitHub marker for each GitHub project', async () => {
  const writes: string[] = [];
  const s = bootServer({
    githubFetch: async (url, init) => {
      if (init?.method === 'POST') writes.push(String(url));
      return Response.json(String(url).includes('/issues?') ? [] : { number: 7 });
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
