import { eq } from 'drizzle-orm';
import { expect, test } from 'vitest';
import { team } from '../src/db/schema.js';
import { seed } from '../src/db/seed.js';
import { bootServer, req } from './helpers.js';

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
