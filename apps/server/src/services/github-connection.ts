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
  githubBaseFetch?: FetchLike | undefined;
  oauthClient?: OAuthClientConfig | null | undefined;
}

export type GithubTokenReason =
  | 'no-secret-box'
  | 'no-github-connection'
  | 'token-unreadable'
  | 'github-disconnected';

type GithubConnectionRow = typeof githubConnection.$inferSelect;
export type GithubConnectionPin = Pick<
  GithubConnectionRow,
  'teamId' | 'createdAt' | 'connectionGeneration'
>;
export type GithubTokenAccess =
  | { token: string; box: SecretBox; pin: GithubConnectionPin }
  | { reason: GithubTokenReason };

function connectionPin(row: GithubConnectionPin): GithubConnectionPin {
  const { teamId, createdAt, connectionGeneration } = row;
  return { teamId, createdAt, connectionGeneration };
}

function matchesConnection(left: GithubConnectionPin, right: GithubConnectionPin): boolean {
  return (
    left.teamId === right.teamId &&
    left.createdAt === right.createdAt &&
    left.connectionGeneration === right.connectionGeneration
  );
}

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
  const prior = deps.db
    .select({ createdAt: githubConnection.createdAt })
    .from(githubConnection)
    .where(eq(githubConnection.teamId, input.teamId))
    .get();
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
    createdAt: prior === undefined ? nowMs() : Math.max(nowMs(), prior.createdAt + 1),
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

function sameConnectionRow(row: typeof githubConnection.$inferSelect) {
  return and(
    eq(githubConnection.teamId, row.teamId),
    eq(githubConnection.createdAt, row.createdAt),
    row.connectionGeneration === null
      ? isNull(githubConnection.connectionGeneration)
      : eq(githubConnection.connectionGeneration, row.connectionGeneration),
  );
}

export function saveRefreshedTokens(
  deps: GithubConnectionDeps,
  row: typeof githubConnection.$inferSelect,
  tokens: { accessToken: string; refreshToken: string | null; expiresInSeconds: number | null },
): number {
  return deps.db
    .update(githubConnection)
    .set({
      accessTokenCipher: deps.box.seal(tokens.accessToken),
      refreshTokenCipher:
        tokens.refreshToken === null ? row.refreshTokenCipher : deps.box.seal(tokens.refreshToken),
      accessTokenExpiresAt:
        tokens.expiresInSeconds === null ? null : nowMs() + tokens.expiresInSeconds * 1000,
      disconnectedReason: null,
    })
    .where(and(sameConnectionRow(row), isNull(githubConnection.appClientId)))
    .run().changes;
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

const refreshChainsByDb = new WeakMap<Db, Map<string, Promise<GithubTokenAccess>>>();

function refreshChainsOf(db: Db): Map<string, Promise<GithubTokenAccess>> {
  let map = refreshChainsByDb.get(db);
  if (map === undefined) {
    map = new Map<string, Promise<GithubTokenAccess>>();
    refreshChainsByDb.set(db, map);
  }
  return map;
}

export async function connectionToken(
  deps: GithubTokenDeps,
  teamId: string,
  pin?: GithubConnectionPin,
): Promise<GithubTokenAccess> {
  const box = deps.box;
  if (box === undefined) return { reason: 'no-secret-box' };
  const connectionDeps = { db: deps.db, box };
  const row = getRow(connectionDeps, teamId);
  if (!row || (pin !== undefined && !matchesConnection(row, pin))) {
    return { reason: 'no-github-connection' };
  }
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
  if (!expired) return { token, box, pin: connectionPin(row) };
  const access = await refreshConnectionToken(deps, connectionDeps, row, token);
  if (pin !== undefined && 'token' in access && !matchesConnection(access.pin, pin)) {
    return { reason: 'no-github-connection' };
  }
  return access;
}

function refreshConnectionToken(
  deps: GithubTokenDeps,
  connectionDeps: GithubConnectionDeps,
  row: GithubConnectionRow,
  staleToken: string,
): Promise<GithubTokenAccess> {
  const { box } = connectionDeps;
  const pin = connectionPin(row);
  const key = JSON.stringify([pin.teamId, pin.createdAt, pin.connectionGeneration]);
  const refreshChains = refreshChainsOf(connectionDeps.db);
  const chained = refreshChains.get(key);
  if (chained !== undefined) return chained;
  const refresh = (async (): Promise<GithubTokenAccess> => {
    const client = deps.oauthClient ?? null;
    if (row.refreshTokenCipher === null || (client === null && row.appClientId === null))
      return { token: staleToken, box, pin };
    const fetchImpl = deps.githubFetch ?? globalThis.fetch;
    let refreshToken: string;
    try {
      refreshToken = box.open(row.refreshTokenCipher);
    } catch {
      markGithubConnectionDisconnected(
        connectionDeps,
        row.teamId,
        'stored refresh token unreadable',
      );
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
    if (client === null) return { token: staleToken, box, pin };
    try {
      const tokens = await refreshOAuthAccessToken(fetchImpl, {
        tokenUrl: onGithubOauthBase(GITHUB_CONNECTION_OAUTH.tokenUrl),
        clientId: client.clientId,
        clientSecret: client.clientSecret,
        refreshToken,
      });
      if (saveRefreshedTokens(connectionDeps, row, tokens) === 0)
        return currentConnectionToken(connectionDeps, row.teamId);
      return { token: tokens.accessToken, box, pin };
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      connectionDeps.db
        .update(githubConnection)
        .set({ disconnectedReason: `oauth refresh failed: ${why}` })
        .where(and(sameConnectionRow(row), isNull(githubConnection.appClientId)))
        .run();
      return currentConnectionToken(connectionDeps, row.teamId);
    }
  })();
  refreshChains.set(key, refresh);
  refresh
    .finally(() => {
      if (refreshChains.get(key) === refresh) refreshChains.delete(key);
    })
    .catch(() => undefined);
  return refresh;
}

async function refreshDeviceGrant(
  deps: GithubConnectionDeps,
  fetchImpl: FetchLike,
  row: GithubConnectionRow,
  clientId: string,
  refreshToken: string,
  staleToken: string,
): Promise<GithubTokenAccess> {
  let grant: Awaited<ReturnType<typeof refreshGithubDeviceToken>>;
  try {
    grant = await refreshGithubDeviceToken({ fetch: fetchImpl }, clientId, refreshToken);
  } catch (err) {
    if (!(err instanceof HttpError && err.status === 401))
      return { token: staleToken, box: deps.box, pin: connectionPin(row) };
    deps.db
      .update(githubConnection)
      .set({ disconnectedReason: 'GitHub authorization expired' })
      .where(sameConnectionRow(row))
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
    .where(sameConnectionRow(row))
    .run().changes;
  if (saved === 0) return currentConnectionToken(deps, row.teamId);
  return { token: grant.accessToken, box: deps.box, pin: connectionPin(row) };
}

function currentConnectionToken(deps: GithubConnectionDeps, teamId: string): GithubTokenAccess {
  const current = getRow(deps, teamId);
  if (!current) return { reason: 'no-github-connection' };
  if (current.disconnectedReason !== null) return { reason: 'github-disconnected' };
  try {
    return {
      token: deps.box.open(current.accessTokenCipher),
      box: deps.box,
      pin: connectionPin(current),
    };
  } catch (err) {
    if (!(err instanceof SecretBoxError)) throw err;
    return { reason: 'token-unreadable' };
  }
}

export function refreshingGithubFetch(
  deps: GithubTokenDeps,
  inner: FetchLike,
  scope?: string | GithubConnectionPin,
): FetchLike {
  const pin = typeof scope === 'string' ? undefined : scope;
  const teamId = typeof scope === 'string' ? scope : scope?.teamId;
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
      .where(
        teamId === undefined
          ? isNull(githubConnection.disconnectedReason)
          : and(eq(githubConnection.teamId, teamId), isNull(githubConnection.disconnectedReason)),
      )
      .all();
    const candidates: (typeof githubConnection.$inferSelect)[] = [];
    for (const row of rows) {
      if (row.refreshTokenCipher === null || (pin !== undefined && !matchesConnection(row, pin))) {
        continue;
      }
      let accessToken: string | null;
      try {
        accessToken = box.open(row.accessTokenCipher);
      } catch {
        accessToken = null;
      }
      if (accessToken === rejected) candidates.push(row);
    }
    const candidate = candidates.length === 1 ? candidates[0] : undefined;
    if (candidate === undefined) return res;
    const access = await refreshConnectionToken(
      { ...deps, githubFetch: inner },
      connectionDeps,
      candidate,
      rejected,
    );
    if (
      !('token' in access) ||
      access.token === rejected ||
      (pin !== undefined && !matchesConnection(access.pin, pin))
    ) {
      return res;
    }
    return inner(input, {
      ...init,
      headers: { ...init?.headers, authorization: `Bearer ${access.token}` },
    });
  };
}

export async function githubTokenOrNull(
  deps: GithubTokenDeps,
  teamId: string,
): Promise<string | null> {
  const access = await connectionToken(deps, teamId);
  return 'token' in access ? access.token : null;
}

export function githubConnectionPin(db: Db, teamId: string): GithubConnectionPin | null {
  const row = db
    .select({
      teamId: githubConnection.teamId,
      createdAt: githubConnection.createdAt,
      connectionGeneration: githubConnection.connectionGeneration,
      disconnectedReason: githubConnection.disconnectedReason,
    })
    .from(githubConnection)
    .where(eq(githubConnection.teamId, teamId))
    .get();
  if (row === undefined || row.disconnectedReason !== null) return null;
  return connectionPin(row);
}

export function assertGithubConnectionCurrent(
  db: Db,
  teamId: string,
  pin: GithubConnectionPin,
): void {
  const current = githubConnectionPin(db, teamId);
  if (current === null || !matchesConnection(current, pin)) {
    throw new HttpError(409, 'github connection changed while binding; retry');
  }
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
  return 'token' in access ? { token: access.token as UserToken, box: access.box } : access;
}

export async function userTokenOrNull(
  deps: GithubTokenDeps,
  teamId: string,
): Promise<UserToken | null> {
  const access = await teamUserToken(deps, teamId);
  return 'token' in access ? access.token : null;
}

export { teamUserToken as teamGithubToken };
