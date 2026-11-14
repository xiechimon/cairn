import type { AutonomyPauseEntry, TeamRecord, UserRecord } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { newRecordId, nowMs } from '../lib/ids.js';
import type { Db } from './client.js';
import { team, user } from './schema.js';

export interface SeedResult {
  user: UserRecord;
  team: TeamRecord;
}

export function seed(db: Db): SeedResult {
  const existingTeam = db.select().from(team).all()[0];
  const existingUser = db.select().from(user).all()[0];
  if (existingTeam && existingUser) {
    return { user: toUserRecord(existingUser), team: toTeamRecord(existingTeam) };
  }

  const userId = newRecordId();
  const teamId = newRecordId();
  const createdAt = nowMs();
  const displayName = 'Owner';
  db.insert(user).values({ id: userId, displayName, avatarUrl: null }).run();
  db.insert(team)
    .values({
      id: teamId,
      name: `${displayName}'s team`,
      createdAt,
      plan: 'free',
      avatarStyle: 'notionist',
    })
    .run();

  const userRow = db.select().from(user).where(eq(user.id, userId)).get();
  const teamRow = db.select().from(team).where(eq(team.id, teamId)).get();
  if (!userRow || !teamRow) throw new Error('seed failed: rows missing after insert');
  return { user: toUserRecord(userRow), team: toTeamRecord(teamRow) };
}

export function toUserRecord(row: typeof user.$inferSelect): UserRecord {
  return { type: 'user', id: row.id, displayName: row.displayName, avatarUrl: row.avatarUrl };
}

export function toTeamRecord(
  row: typeof team.$inferSelect,
  pauses?: AutonomyPauseEntry[],
): TeamRecord {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt,
    plan: row.plan,
    claudeUsage: row.claudeUsage,
    avatarStyle: row.avatarStyle,
    ...(pauses === undefined ? {} : { autonomyPaused: pauses.length > 0, autonomyPauses: pauses }),
    coAuthorTrailer: row.coAuthorTrailer,
    requestInstructorReview: row.requestInstructorReview,
    maxAutonomousMergesPerDay: row.maxAutonomousMergesPerDay,
    defaultMachineId: row.defaultMachineId,
  };
}
