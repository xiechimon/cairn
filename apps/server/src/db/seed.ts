// 单用户 seed + team 保形（02 §2/A2）：seed 单本地用户、启动即自动登录；
// team 表与全部 teamId 路径段形状保留，数据恒 seed 一行。幂等：已有行即返回。
// seed 内容（displayName/team name/avatarStyle）= [设计]（无观测 canon，内容自选）。

import type { TeamRecord, UserRecord } from '@cairn/shared';
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
  // 02 §2.1：seed 单本地用户。响应面补 type:"user"（r2 §1.5 me-v1 缓存样本；
  // 记录本体还是缓存封套未分离观测 [推断]，按封套处理不落列）。
  const displayName = 'Owner';
  db.insert(user).values({ id: userId, displayName, avatarUrl: null }).run();
  db.insert(team)
    .values({
      id: teamId,
      name: `${displayName}'s team`,
      createdAt,
      plan: 'free', // 形状保留、不参与门控（02 §2.4/A3）
      avatarStyle: 'notionist', // [推断] 值域（records/team.ts）
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

export function toTeamRecord(row: typeof team.$inferSelect): TeamRecord {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt,
    plan: row.plan,
    avatarStyle: row.avatarStyle,
  };
}
