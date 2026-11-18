import { eq } from 'drizzle-orm';
import { expect, test } from 'vitest';
import { team } from '../src/db/schema.js';
import { bootServer, req } from './helpers.js';

test('retired team features stay absent from the wire and reject writes', async () => {
  const s = bootServer();
  try {
    s.db.update(team).set({ maxAutonomousMergesPerDay: 7 }).where(eq(team.id, s.team.id)).run();
    const listed = (await (await req(s.app, 'GET', '/api/teams')).json()) as Record<
      string,
      unknown
    >[];
    const updated = (await (
      await req(s.app, 'PATCH', `/api/teams/${s.team.id}`, {
        maxAutonomousMergesPerDay: 3,
      })
    ).json()) as Record<string, unknown>;
    expect(listed).toHaveLength(1);
    for (const record of [...listed, updated]) {
      expect(record).not.toHaveProperty('coAuthorTrailer');
      expect(record).not.toHaveProperty('requestInstructorReview');
      expect(record).not.toHaveProperty('firstPrReportPrompt');
      expect(record.maxAutonomousMergesPerDay).toBeDefined();
    }
    for (const body of [
      { coAuthorTrailer: false },
      { requestInstructorReview: true },
      { firstPrReportPrompt: { enabled: true } },
    ]) {
      expect((await req(s.app, 'PATCH', `/api/teams/${s.team.id}`, body)).status).toBe(400);
    }
  } finally {
    s.dispose();
  }
});
