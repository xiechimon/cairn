import type { UserRecord } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { githubConnection, user } from '../db/schema.js';
import { defaultOwnerName } from '../db/seed.js';

export function adoptGithubProfile(deps: { db: Db; user: UserRecord }, teamId: string): void {
  const connection = deps.db
    .select()
    .from(githubConnection)
    .where(eq(githubConnection.teamId, teamId))
    .get();
  const row = deps.db.select().from(user).where(eq(user.id, deps.user.id)).get();
  if (connection === undefined || row === undefined) return;
  const avatarUrl =
    connection.githubUserId === null
      ? row.avatarUrl
      : `https://avatars.githubusercontent.com/u/${connection.githubUserId}?v=4`;
  const renamed = row.displayNameEdited ?? row.displayName !== defaultOwnerName();
  const displayName = renamed ? row.displayName : connection.githubName?.trim() || connection.login;
  deps.db
    .update(user)
    .set({ displayName, displayNameEdited: renamed, avatarUrl })
    .where(eq(user.id, row.id))
    .run();
  deps.user.displayName = displayName;
  deps.user.avatarUrl = avatarUrl;
}
