import type { GithubConnectionStatus, SecretBox } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { githubConnection } from '../db/schema.js';
import { nowMs } from '../lib/ids.js';

export interface GithubConnectionDeps {
  db: Db;
  box: SecretBox;
}

function getRow(deps: GithubConnectionDeps, teamId: string) {
  return deps.db.select().from(githubConnection).where(eq(githubConnection.teamId, teamId)).get();
}

export function upsertGithubConnection(
  deps: GithubConnectionDeps,
  input: { teamId: string; login: string; accessToken: string; scope: string },
): void {
  const accessTokenCipher = deps.box.seal(input.accessToken);
  const createdAt = nowMs();
  deps.db
    .insert(githubConnection)
    .values({
      teamId: input.teamId,
      login: input.login,
      accessTokenCipher,
      scope: input.scope,
      createdAt,
    })
    .onConflictDoUpdate({
      target: githubConnection.teamId,
      set: { login: input.login, accessTokenCipher, scope: input.scope, createdAt },
    })
    .run();
}

export function deleteGithubConnection(deps: GithubConnectionDeps, teamId: string): boolean {
  const existed = getRow(deps, teamId) !== undefined;
  deps.db.delete(githubConnection).where(eq(githubConnection.teamId, teamId)).run();
  return existed;
}

export function openGithubToken(deps: GithubConnectionDeps, teamId: string): string | null {
  const row = getRow(deps, teamId);
  if (!row) return null;
  return deps.box.open(row.accessTokenCipher);
}

export function teamGithubToken(
  deps: { db: Db; box?: SecretBox | undefined },
  teamId: string,
):
  | { token: string; box: SecretBox }
  | { reason: 'no-secret-box' | 'no-github-connection' | 'token-unreadable' } {
  const box = deps.box;
  if (box === undefined) return { reason: 'no-secret-box' };
  try {
    const token = openGithubToken({ db: deps.db, box }, teamId);
    return token === null ? { reason: 'no-github-connection' } : { token, box };
  } catch {
    return { reason: 'token-unreadable' };
  }
}

export function githubTokenOrNull(
  deps: { db: Db; box?: SecretBox | undefined },
  teamId: string,
): string | null {
  const access = teamGithubToken(deps, teamId);
  return 'token' in access ? access.token : null;
}

export function hasGithubConnection(db: Db, teamId: string): boolean {
  return (
    db
      .select({ teamId: githubConnection.teamId })
      .from(githubConnection)
      .where(eq(githubConnection.teamId, teamId))
      .get() !== undefined
  );
}

export function readGithubConnectionStatus(
  deps: GithubConnectionDeps,
  teamId: string,
): GithubConnectionStatus {
  const row = getRow(deps, teamId);
  if (!row) return { connected: false };
  return { connected: true, login: row.login, scope: row.scope };
}
