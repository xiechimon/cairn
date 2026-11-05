import { chiefIdFormat, isChiefConversationId } from '@cairn/shared';
import { and, eq, type SQL, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { chief, chiefThread, computer, type computerCall, step, user } from '../db/schema.js';

export type ComputerRow = typeof computer.$inferSelect;

export function privateComputerWhere(teamId: string, userId: string): SQL {
  return sql`${computer.scope} = 'private'
    and ${computer.teamId} = ${teamId}
    and ${computer.scopeKey} = ${`chief:${chiefIdFormat(userId, teamId)}`}`;
}

export function ownedPrivateComputer(
  db: Db,
  teamId: string,
  userId: string,
  computerId: string,
): ComputerRow | undefined {
  return db
    .select()
    .from(computer)
    .where(and(eq(computer.id, computerId), privateComputerWhere(teamId, userId)))
    .get();
}

export function computerCallOwnerUserId(
  db: Db,
  call: typeof computerCall.$inferSelect,
): string | undefined {
  const owners = db
    .select({
      userId: chief.userId,
      chiefId: chief.id,
      chiefTeamId: chief.teamId,
      threadUserId: chiefThread.userId,
      threadTeamId: chiefThread.teamId,
      threadId: chiefThread.id,
      kind: step.kind,
    })
    .from(step)
    .innerJoin(chiefThread, eq(chiefThread.id, step.buildId))
    .innerJoin(chief, eq(chief.id, chiefThread.chiefId))
    .innerJoin(user, eq(user.id, chief.userId))
    .where(eq(step.id, call.stepId))
    .all();
  if (owners.length !== 1) return undefined;
  const owner = owners[0];
  if (
    !owner?.userId ||
    owner.kind !== 'chief' ||
    !isChiefConversationId(owner.threadId) ||
    owner.chiefTeamId !== call.teamId ||
    owner.threadTeamId !== call.teamId ||
    owner.threadUserId !== owner.userId ||
    owner.chiefId !== chiefIdFormat(owner.userId, call.teamId)
  ) {
    return undefined;
  }
  const hostTool = call.tool.startsWith('user_computer_');
  if (call.computerId === null) return hostTool ? owner.userId : undefined;
  if (hostTool) return undefined;
  const target = ownedPrivateComputer(db, call.teamId, owner.userId, call.computerId);
  return target?.machineId === call.machineId ? owner.userId : undefined;
}
