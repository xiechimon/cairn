import {
  GITHUB_CONNECTION_OAUTH,
  type GithubConnectionStatus,
  type GitIdentity,
  type SecretBox,
} from '@cairn/shared';
import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { githubConnection } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { type FetchLike, refreshOAuthAccessToken } from '../lib/github.js';
import { onGithubOauthBase } from '../lib/github-oauth-base.js';
import { isAppToken, type UserToken } from '../lib/github-token.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import type { OAuthClientConfig } from '../lib/oauth-client.js';
import { SecretBoxError } from '../lib/secret-box.js';
import { refreshGithubDeviceToken } from './github-device-core.js';

const REFRESH_SKEW_MS = 60_000;

export interface GithubConnectionDeps {
  db: Db;
  box: SecretBox;
}

export interface GithubTokenDeps {
  db: Db;
  githubAppTokenSocket?: string | null;
  githubAppIdentity?: GitIdentity | null | undefined;
  box?: SecretBox | undefined;
  githubFetch?: FetchLike | undefined;
  oauthClient?: OAuthClientConfig | null | undefined;
}

export type GithubTokenReason =
  | 'no-secret-box'
  | 'no-github-connection'
  | 'token-unreadable'
  | 'github-disconnected';

export type GithubTokenAccess = { token: string; box: SecretBox } | { reason: GithubTokenReason };

function getRow(deps: GithubConnectionDeps, teamId: string) {
  return deps.db.select().from(githubConnection).where(eq(githubConnection.teamId, teamId)).get();
}

export function upsertGithubConnection(
  deps: GithubConnectionDeps,
  input: {
    teamId: string;
    login: string;
    githubUserId?: number | null;
    githubName?: string | null;
    accessToken: string;
    scope: string;
    refreshToken?: string | null | undefined;
    accessTokenExpiresAt?: number | null | undefined;
    device?: { clientId: string; refreshTokenExpiresAt: number } | undefined;
  },
): void {
  const accessTokenCipher = deps.box.seal(input.accessToken);
  const refreshTokenCipher =
    input.refreshToken === undefined || input.refreshToken === null
      ? null
      : deps.box.seal(input.refreshToken);
  const fields = {
    login: input.login,
    githubUserId: input.githubUserId ?? null,
    githubName: input.githubName ?? null,
    accessTokenCipher,
    refreshTokenCipher,
    accessTokenExpiresAt: input.accessTokenExpiresAt ?? null,
    refreshTokenExpiresAt: input.device?.refreshTokenExpiresAt ?? null,
    appClientId: input.device?.clientId ?? null,
    connectionGeneration: input.device === undefined ? null : newRecordId(32),
    refreshLeaseUntil: null,
    disconnectedReason: null,
    scope: input.scope,
    createdAt: nowMs(),
  };
  deps.db
    .insert(githubConnection)
    .values({ teamId: input.teamId, ...fields })
    .onConflictDoUpdate({ target: githubConnection.teamId, set: fields })
    .run();
}

export function markGithubConnectionDisconnected(
  deps: GithubConnectionDeps,
  teamId: string,
  reason: string,
): void {
  deps.db
    .update(githubConnection)
    .set({ disconnectedReason: reason })
    .where(eq(githubConnection.teamId, teamId))
    .run();
}

export function saveRefreshedTokens(
  deps: GithubConnectionDeps,
  row: typeof githubConnection.$inferSelect,
  tokens: { accessToken: string; refreshToken: string | null; expiresInSeconds: number | null },
): void {
  deps.db
    .update(githubConnection)
    .set({
      accessTokenCipher: deps.box.seal(tokens.accessToken),
      refreshTokenCipher:
        tokens.refreshToken === null ? row.refreshTokenCipher : deps.box.seal(tokens.refreshToken),
      accessTokenExpiresAt:
        tokens.expiresInSeconds === null ? null : nowMs() + tokens.expiresInSeconds * 1000,
      disconnectedReason: null,
    })
    .where(and(eq(githubConnection.teamId, row.teamId), isNull(githubConnection.appClientId)))
    .run();
}

export function deleteGithubConnection(deps: GithubConnectionDeps, teamId: string): boolean {
  const existed = getRow(deps, teamId) !== undefined;
  deps.db.delete(githubConnection).where(eq(githubConnection.teamId, teamId)).run();
  return existed;
}

export function openGithubToken(deps: GithubConnectionDeps, teamId: string): string | null {
  const row = getRow(deps, teamId);
  if (!row || row.disconnectedReason !== null) return null;
  return deps.box.open(row.accessTokenCipher);
}

const refreshChains = new Map<string, Promise<GithubTokenAccess>>();

export async function connectionToken(
  deps: GithubTokenDeps,
  teamId: string,
): Promise<GithubTokenAccess> {
  const box = deps.box;
  if (box === undefined) return { reason: 'no-secret-box' };
  const connectionDeps = { db: deps.db, box };
  const row = getRow(connectionDeps, teamId);
  if (!row) return { reason: 'no-github-connection' };
  let token: string;
  try {
    token = box.open(row.accessTokenCipher);
  } catch (err) {
    if (!(err instanceof SecretBoxError)) throw err;
    return { reason: 'token-unreadable' };
  }
  if (row.disconnectedReason !== null) return { reason: 'github-disconnected' };
  const expired =
    row.refreshTokenCipher !== null &&
    row.accessTokenExpiresAt !== null &&
    Date.now() >= row.accessTokenExpiresAt - REFRESH_SKEW_MS;
  if (!expired) return { token, box };
  return refreshConnectionToken(deps, connectionDeps, row, token);
}

function refreshConnectionToken(
  deps: GithubTokenDeps,
  connectionDeps: GithubConnectionDeps,
  row: typeof githubConnection.$inferSelect,
  staleToken: string,
): Promise<GithubTokenAccess> {
  const { box } = connectionDeps;
  const teamId = row.teamId;
  const chained = refreshChains.get(teamId);
  if (chained !== undefined) return chained;
  const refresh = (async (): Promise<GithubTokenAccess> => {
    const client = deps.oauthClient ?? null;
    if (row.refreshTokenCipher === null || (client === null && row.appClientId === null))
      return { token: staleToken, box };
    const fetchImpl = deps.githubFetch ?? globalThis.fetch;
    let refreshToken: string;
    try {
      refreshToken = box.open(row.refreshTokenCipher);
    } catch {
      markGithubConnectionDisconnected(connectionDeps, teamId, 'stored refresh token unreadable');
      return { reason: 'github-disconnected' };
    }
    if (row.appClientId !== null)
      return refreshDeviceGrant(
        connectionDeps,
        fetchImpl,
        row,
        row.appClientId,
        refreshToken,
        staleToken,
      );
    if (client === null) return { token: staleToken, box };
    try {
      const tokens = await refreshOAuthAccessToken(fetchImpl, {
        tokenUrl: onGithubOauthBase(GITHUB_CONNECTION_OAUTH.tokenUrl),
        clientId: client.clientId,
        clientSecret: client.clientSecret,
        refreshToken,
      });
      saveRefreshedTokens(connectionDeps, row, tokens);
      if (getRow(connectionDeps, teamId)?.appClientId != null)
        return currentConnectionToken(connectionDeps, teamId);
      return { token: tokens.accessToken, box };
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      connectionDeps.db
        .update(githubConnection)
        .set({ disconnectedReason: `oauth refresh failed: ${why}` })
        .where(and(eq(githubConnection.teamId, teamId), isNull(githubConnection.appClientId)))
        .run();
      return currentConnectionToken(connectionDeps, teamId);
    }
  })();
  refreshChains.set(teamId, refresh);
  refresh
    .finally(() => {
      if (refreshChains.get(teamId) === refresh) refreshChains.delete(teamId);
    })
    .catch(() => undefined);
  return refresh;
}

async function refreshDeviceGrant(
  deps: GithubConnectionDeps,
  fetchImpl: FetchLike,
  row: typeof githubConnection.$inferSelect,
  clientId: string,
  refreshToken: string,
  staleToken: string,
): Promise<GithubTokenAccess> {
  const sameGeneration = and(
    eq(githubConnection.teamId, row.teamId),
    eq(githubConnection.connectionGeneration, row.connectionGeneration ?? ''),
  );
  let grant: Awaited<ReturnType<typeof refreshGithubDeviceToken>>;
  try {
    grant = await refreshGithubDeviceToken({ fetch: fetchImpl }, clientId, refreshToken);
  } catch (err) {
    if (!(err instanceof HttpError && err.status === 401))
      return { token: staleToken, box: deps.box };
    deps.db
      .update(githubConnection)
      .set({ disconnectedReason: 'GitHub authorization expired' })
      .where(sameGeneration)
      .run();
    return currentConnectionToken(deps, row.teamId);
  }
  const now = nowMs();
  const saved = deps.db
    .update(githubConnection)
    .set({
      accessTokenCipher: deps.box.seal(grant.accessToken),
      refreshTokenCipher: deps.box.seal(grant.refreshToken),
      accessTokenExpiresAt: now + grant.expiresInSeconds * 1000,
      refreshTokenExpiresAt: now + grant.refreshTokenExpiresInSeconds * 1000,
      disconnectedReason: null,
    })
    .where(sameGeneration)
    .run().changes;
  if (saved === 0) return currentConnectionToken(deps, row.teamId);
  return { token: grant.accessToken, box: deps.box };
}

function currentConnectionToken(deps: GithubConnectionDeps, teamId: string): GithubTokenAccess {
  const current = getRow(deps, teamId);
  if (!current) return { reason: 'no-github-connection' };
  if (current.disconnectedReason !== null) return { reason: 'github-disconnected' };
  try {
    return { token: deps.box.open(current.accessTokenCipher), box: deps.box };
  } catch (err) {
    if (!(err instanceof SecretBoxError)) throw err;
    return { reason: 'token-unreadable' };
  }
}

export function refreshingGithubFetch(deps: GithubTokenDeps, inner: FetchLike): FetchLike {
  return async (input, init) => {
    const header = init?.headers?.authorization;
    if (header?.startsWith('Bearer ') && isAppToken(header.slice(7))) return inner(input, init);
    const res = await inner(input, init);
    if (res.status !== 401 || deps.box === undefined || !header?.startsWith('Bearer ')) return res;
    const box = deps.box;
    const rejected = header.slice('Bearer '.length);
    const connectionDeps = { db: deps.db, box };
    const rows = deps.db
      .select()
      .from(githubConnection)
      .where(isNull(githubConnection.disconnectedReason))
      .all();
    for (const row of rows) {
      let stored: string;
      try {
        stored = box.open(row.accessTokenCipher);
      } catch {
        continue;
      }
      if (stored !== rejected || row.refreshTokenCipher === null) continue;
      const access = await refreshConnectionToken(
        { ...deps, githubFetch: inner },
        connectionDeps,
        row,
        stored,
      );
      if (!('token' in access) || access.token === rejected) return res;
      return inner(input, {
        ...init,
        headers: { ...init?.headers, authorization: `Bearer ${access.token}` },
      });
    }
    return res;
  };
}

export async function githubTokenOrNull(
  deps: GithubTokenDeps,
  teamId: string,
): Promise<string | null> {
  const access = await connectionToken(deps, teamId);
  return 'token' in access ? access.token : null;
}

export function hasGithubConnection(db: Db, teamId: string): boolean {
  const row = db
    .select({ disconnectedReason: githubConnection.disconnectedReason })
    .from(githubConnection)
    .where(eq(githubConnection.teamId, teamId))
    .get();
  return row !== undefined && row.disconnectedReason === null;
}

export function readGithubConnectionStatus(
  deps: GithubConnectionDeps,
  teamId: string,
): GithubConnectionStatus {
  const row = getRow(deps, teamId);
  if (!row) return { connected: false };
  const webhook = {
    ...(row.webhookMasked !== null ? { webhookMasked: row.webhookMasked } : {}),
    ...(row.webhookLastUsedAt !== null ? { webhookLastUsedAt: row.webhookLastUsedAt } : {}),
  };
  if (row.disconnectedReason !== null) {
    return { connected: false, disconnectReason: row.disconnectedReason, ...webhook };
  }
  return { connected: true, login: row.login, scope: row.scope, ...webhook };
}

export async function teamUserToken(
  deps: GithubTokenDeps,
  teamId: string,
): Promise<{ token: UserToken; box: SecretBox } | { reason: GithubTokenReason }> {
  const access = await connectionToken(deps, teamId);
  return 'token' in access ? { ...access, token: access.token as UserToken } : access;
}

export async function userTokenOrNull(
  deps: GithubTokenDeps,
  teamId: string,
): Promise<UserToken | null> {
  const access = await teamUserToken(deps, teamId);
  return 'token' in access ? access.token : null;
}

export { teamUserToken as teamGithubToken };
