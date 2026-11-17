import { userInfo } from 'node:os';
import type { AutonomyPauseEntry, TeamRecord, UserRecord } from '@cairn/shared';
import { eq, sql } from 'drizzle-orm';
import { newRecordId, nowMs } from '../lib/ids.js';
import type { Db } from './client.js';
import { team, user } from './schema.js';

export interface SeedResult {
  user: UserRecord;
  team: TeamRecord;
}

export function defaultOwnerName(): string {
  try {
    return userInfo().username.trim() || 'Owner';
  } catch {
    return 'Owner';
  }
}

export function seed(db: Db): SeedResult {
  const existingTeam = db.select().from(team).all()[0];
  const existingUser = db.select(userRecordColumns).from(user).all()[0];
  if (existingTeam && existingUser) {
    if (existingUser.displayName === 'Owner') {
      existingUser.displayName = defaultOwnerName();
      db.update(user)
        .set({ displayName: existingUser.displayName })
        .where(eq(user.id, existingUser.id))
        .run();
    }
    return { user: toUserRecord(existingUser), team: toTeamRecord(existingTeam) };
  }

  const userId = newRecordId();
  const teamId = newRecordId();
  const createdAt = nowMs();
  const displayName = defaultOwnerName();
  db.run(
    sql`insert into ${user} (${sql.identifier(user.id.name)}, ${sql.identifier(user.displayName.name)}) values (${userId}, ${displayName})`,
  );
  db.insert(team)
    .values({
      id: teamId,
      name: `${displayName}'s team`,
      createdAt,
      plan: 'free',
      avatarStyle: 'notionist',
    })
    .run();

  const userRow = db.select(userRecordColumns).from(user).where(eq(user.id, userId)).get();
  const teamRow = db.select().from(team).where(eq(team.id, teamId)).get();
  if (!userRow || !teamRow) throw new Error('seed failed: rows missing after insert');
  return { user: toUserRecord(userRow), team: toTeamRecord(teamRow) };
}

const userRecordColumns = {
  id: user.id,
  displayName: user.displayName,
  avatarUrl: user.avatarUrl,
};

export function toUserRecord(row: {
  id: string;
  displayName: string;
  avatarUrl: string | null;
}): UserRecord {
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
    avatarStyle: row.avatarStyle,
    ...(pauses === undefined ? {} : { autonomyPaused: pauses.length > 0, autonomyPauses: pauses }),
    maxAutonomousMergesPerDay: row.maxAutonomousMergesPerDay,
    defaultMachineId: row.defaultMachineId,
  };
}
