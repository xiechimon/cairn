import {
  GITHUB_CONNECTION_OAUTH,
  OAUTH_FAMILIES,
  type SecretBox,
  type StartMcpConnectorOAuthBody,
} from '@cairn/shared';
import type { Db } from '../db/client.js';
import {
  exchangeOAuthCode,
  type FetchLike,
  githubUserIdentity,
  type OAuthTokenExchange,
} from '../lib/github.js';
import { newRecordId } from '../lib/ids.js';
import { upsertGithubConnection } from './github-connection.js';
import {
  completeMcpConnectorOAuth,
  type McpConnectorDeps,
  McpOAuthError,
  type McpOAuthPending,
  prepareMcpConnectorOAuth,
} from './mcp-servers.js';
import { createProvider, openProviderKey, updateProvider } from './providers.js';

export const OAUTH_STATE_TTL_MS = 30 * 60 * 1000;

export type OAuthStateKind = 'provider' | 'github-connection' | 'mcp-connector';

export type OAuthStateEntry =
  | {
      kind: 'provider';
      teamId: string;
      presetId: string;
      origin: string;
      createdAt: number;
    }
  | {
      kind: 'github-connection';
      teamId: string;
      origin: string;
      createdAt: number;
    }
  | {
      kind: 'mcp-connector';
      teamId: string;
      origin: string;
      createdAt: number;
      pending: McpOAuthPending;
    };

export interface OAuthClientConfig {
  clientId: string;
  clientSecret: string;
}

export interface OAuthDeps {
  db: Db;
  box: SecretBox;
  states: Map<string, OAuthStateEntry>;
  fetch: FetchLike;
  client: OAuthClientConfig | null;
  mcp: McpConnectorDeps;
}

export class OAuthFlowError extends Error {
  constructor(
    readonly reason:
      | 'unknown-family'
      | 'not-configured'
      | 'bad-state'
      | 'exchange-failed'
      | 'conflict',
    message: string,
    readonly origin?: string,
    readonly kind?: OAuthStateKind,
  ) {
    super(message);
    this.name = 'OAuthFlowError';
  }
}

function familyOf(presetId: string) {
  return OAUTH_FAMILIES.find((f) => f.presetId === presetId);
}

function sweep(states: Map<string, OAuthStateEntry>): void {
  const now = Date.now();
  for (const [state, entry] of states) {
    if (now - entry.createdAt > OAUTH_STATE_TTL_MS) states.delete(state);
  }
}

function notConfigured(): OAuthFlowError {
  return new OAuthFlowError(
    'not-configured',
    'oauth client not configured (set CAIRN_GITHUB_OAUTH_CLIENT_ID/CAIRN_GITHUB_OAUTH_CLIENT_SECRET)',
  );
}

function issueAuthorize(
  deps: OAuthDeps,
  client: OAuthClientConfig,
  entry: OAuthStateEntry,
  target: { authorizeUrl: string; scope: string },
): { authorizationUrl: string } {
  sweep(deps.states);
  const state = newRecordId(32);
  deps.states.set(state, entry);
  const url = new URL(target.authorizeUrl);
  url.searchParams.set('client_id', client.clientId);
  url.searchParams.set('redirect_uri', `${entry.origin}/api/oauth/callback`);
  url.searchParams.set('scope', target.scope);
  url.searchParams.set('state', state);
  return { authorizationUrl: url.toString() };
}

export function startOAuthAuthorize(
  deps: OAuthDeps,
  input: { teamId: string; presetId: string; origin: string },
): { authorizationUrl: string } {
  const family = familyOf(input.presetId);
  if (!family) {
    throw new OAuthFlowError('unknown-family', `oauth family ${input.presetId} not found`);
  }
  if (!deps.client) throw notConfigured();
  return issueAuthorize(
    deps,
    deps.client,
    {
      kind: 'provider',
      teamId: input.teamId,
      presetId: input.presetId,
      origin: input.origin,
      createdAt: Date.now(),
    },
    family,
  );
}

export function startGithubConnectionAuthorize(
  deps: OAuthDeps,
  input: { teamId: string; origin: string },
): { authorizationUrl: string } {
  if (!deps.client) throw notConfigured();
  return issueAuthorize(
    deps,
    deps.client,
    {
      kind: 'github-connection',
      teamId: input.teamId,
      origin: input.origin,
      createdAt: Date.now(),
    },
    GITHUB_CONNECTION_OAUTH,
  );
}

export async function startMcpConnectorAuthorize(
  deps: OAuthDeps,
  input: { teamId: string; origin: string; body: StartMcpConnectorOAuthBody },
): Promise<{ authorizationUrl: string }> {
  sweep(deps.states);
  const state = newRecordId(32);
  const { authorizationUrl, pending } = await prepareMcpConnectorOAuth(deps.mcp, input.teamId, {
    body: input.body,
    origin: input.origin,
    state,
  });
  deps.states.set(state, {
    kind: 'mcp-connector',
    teamId: input.teamId,
    origin: input.origin,
    createdAt: Date.now(),
    pending,
  });
  return { authorizationUrl };
}

function consumeState(deps: OAuthDeps, state: string): OAuthStateEntry {
  const entry = deps.states.get(state);
  if (!entry) throw new OAuthFlowError('bad-state', `oauth state ${state} not found`);
  deps.states.delete(state);
  if (Date.now() - entry.createdAt > OAUTH_STATE_TTL_MS) {
    throw new OAuthFlowError('bad-state', `oauth state ${state} expired`, entry.origin, entry.kind);
  }
  return entry;
}

export interface OAuthReturnRef {
  origin: string;
  kind: OAuthStateKind;
}

export function abortOAuthCallback(deps: OAuthDeps, state: string): OAuthReturnRef {
  const entry = consumeState(deps, state);
  return { origin: entry.origin, kind: entry.kind };
}

async function exchangeToken(
  deps: OAuthDeps,
  client: OAuthClientConfig,
  tokenUrl: string,
  entry: OAuthReturnRef,
  code: string,
): Promise<OAuthTokenExchange> {
  try {
    return await exchangeOAuthCode(deps.fetch, {
      tokenUrl,
      clientId: client.clientId,
      clientSecret: client.clientSecret,
      code,
      redirectUri: `${entry.origin}/api/oauth/callback`,
    });
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    throw new OAuthFlowError('exchange-failed', why, entry.origin, entry.kind);
  }
}

export type OAuthCallbackOutcome =
  | { kind: 'provider'; origin: string; presetId: string }
  | { kind: 'github-connection'; origin: string }
  | { kind: 'mcp-connector'; origin: string; connectorId: string };

export async function completeOAuthCallback(
  deps: OAuthDeps,
  input: { code: string; state: string; iss?: string; createdBy: string },
): Promise<OAuthCallbackOutcome> {
  const entry = consumeState(deps, input.state);
  if (entry.kind === 'mcp-connector') {
    try {
      const record = await completeMcpConnectorOAuth(deps.mcp, entry.teamId, entry.pending, {
        code: input.code,
        iss: input.iss,
      });
      return { kind: 'mcp-connector', origin: entry.origin, connectorId: record.id };
    } catch (err) {
      if (!(err instanceof McpOAuthError)) throw err;
      throw new OAuthFlowError(
        err.reason === 'conflict' ? 'conflict' : 'exchange-failed',
        err.message,
        entry.origin,
        entry.kind,
      );
    }
  }
  if (!deps.client) {
    throw new OAuthFlowError('exchange-failed', 'oauth client missing', entry.origin, entry.kind);
  }
  if (entry.kind === 'github-connection') {
    const tokens = await exchangeToken(
      deps,
      deps.client,
      GITHUB_CONNECTION_OAUTH.tokenUrl,
      entry,
      input.code,
    );
    const { accessToken, scope } = tokens;
    let identity: Awaited<ReturnType<typeof githubUserIdentity>>;
    try {
      identity = await githubUserIdentity(deps.fetch, accessToken);
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      throw new OAuthFlowError(
        'exchange-failed',
        `github user login fetch failed: ${why}`,
        entry.origin,
        entry.kind,
      );
    }
    upsertGithubConnection(
      { db: deps.db, box: deps.box },
      {
        teamId: entry.teamId,
        login: identity.login,
        githubUserId: identity.id,
        githubName: identity.name,
        accessToken,
        scope,
        refreshToken: tokens.refreshToken,
        accessTokenExpiresAt:
          tokens.expiresInSeconds === null ? null : Date.now() + tokens.expiresInSeconds * 1000,
      },
    );
    return { kind: 'github-connection', origin: entry.origin };
  }
  const family = familyOf(entry.presetId);
  if (!family) {
    throw new OAuthFlowError('exchange-failed', 'oauth family missing', entry.origin, entry.kind);
  }
  const { accessToken } = await exchangeToken(
    deps,
    deps.client,
    family.tokenUrl,
    entry,
    input.code,
  );
  const keyDeps = { db: deps.db, box: deps.box };
  const existing = openProviderKey(keyDeps, entry.teamId, family.presetId);
  if (existing) {
    updateProvider(keyDeps, entry.teamId, existing.row.id, { apiKey: accessToken });
  } else {
    createProvider(keyDeps, {
      teamId: entry.teamId,
      createdBy: input.createdBy,
      body: {
        providerId: family.presetId,
        label: family.providerLabel,
        baseUrl: family.providerBaseUrl,
        api: family.providerApi,
        authHeader: true,
        models: [],
        apiKey: accessToken,
      },
    });
  }
  return { kind: 'provider', origin: entry.origin, presetId: entry.presetId };
}
