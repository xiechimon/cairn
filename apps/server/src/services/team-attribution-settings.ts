import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { team } from '../db/schema.js';

export function readTeamAttributionSettings(db: Db, teamId: string) {
  const row = db
    .select({
      coAuthorTrailer: team.coAuthorTrailer,
      requestInstructorReview: team.requestInstructorReview,
    })
    .from(team)
    .where(eq(team.id, teamId))
    .get();
  return {
    coAuthorTrailer: row?.coAuthorTrailer ?? true,
    requestInstructorReview: row?.requestInstructorReview ?? false,
  };
}
