import {
  GITHUB_CONNECTION_OAUTH,
  type GithubConnectionStatus,
  type SecretBox,
} from '@cairn/shared';
import { eq, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { githubConnection } from '../db/schema.js';
import { type FetchLike, refreshOAuthAccessToken } from '../lib/github.js';
import { nowMs } from '../lib/ids.js';
import { SecretBoxError } from '../lib/secret-box.js';
import type { OAuthClientConfig } from './oauth.js';

const REFRESH_SKEW_MS = 60_000;

export interface GithubConnectionDeps {
  db: Db;
  box: SecretBox;
}

export interface GithubTokenDeps {
  db: Db;
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
    accessToken: string;
    scope: string;
    refreshToken?: string | null | undefined;
    accessTokenExpiresAt?: number | null | undefined;
  },
): void {
  const accessTokenCipher = deps.box.seal(input.accessToken);
  const refreshTokenCipher =
    input.refreshToken === undefined || input.refreshToken === null
      ? null
      : deps.box.seal(input.refreshToken);
  const createdAt = nowMs();
  deps.db
    .insert(githubConnection)
    .values({
      teamId: input.teamId,
      login: input.login,
      accessTokenCipher,
      refreshTokenCipher,
      accessTokenExpiresAt: input.accessTokenExpiresAt ?? null,
      disconnectedReason: null,
      scope: input.scope,
      createdAt,
    })
    .onConflictDoUpdate({
      target: githubConnection.teamId,
      set: {
        login: input.login,
        accessTokenCipher,
        refreshTokenCipher,
        accessTokenExpiresAt: input.accessTokenExpiresAt ?? null,
        disconnectedReason: null,
        scope: input.scope,
        createdAt,
      },
    })
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
    .where(eq(githubConnection.teamId, row.teamId))
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

export async function teamGithubToken(
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
    if (client === null || row.refreshTokenCipher === null) return { token: staleToken, box };
    const fetchImpl = deps.githubFetch ?? globalThis.fetch;
    let refreshToken: string;
    try {
      refreshToken = box.open(row.refreshTokenCipher);
    } catch {
      markGithubConnectionDisconnected(connectionDeps, teamId, 'stored refresh token unreadable');
      return { reason: 'github-disconnected' };
    }
    try {
      const tokens = await refreshOAuthAccessToken(fetchImpl, {
        tokenUrl: GITHUB_CONNECTION_OAUTH.tokenUrl,
        clientId: client.clientId,
        clientSecret: client.clientSecret,
        refreshToken,
      });
      saveRefreshedTokens(connectionDeps, row, tokens);
      return { token: tokens.accessToken, box };
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      markGithubConnectionDisconnected(connectionDeps, teamId, `oauth refresh failed: ${why}`);
      return { reason: 'github-disconnected' };
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

export function refreshingGithubFetch(deps: GithubTokenDeps, inner: FetchLike): FetchLike {
  return async (input, init) => {
    const res = await inner(input, init);
    const header = init?.headers?.authorization;
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
  const access = await teamGithubToken(deps, teamId);
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
  if (row.disconnectedReason !== null) {
    return { connected: false, disconnectReason: row.disconnectedReason };
  }
  return { connected: true, login: row.login, scope: row.scope };
}
