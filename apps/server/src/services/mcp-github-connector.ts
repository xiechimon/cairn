import {
  type GithubConnectorAvailability,
  type GithubConnectorDevicePoll,
  type GithubConnectorDeviceStart,
  isLocalCatalogEntry,
  mcpCatalogEntry,
} from '@cairn/shared';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { githubConnection, mcpConnector } from '../db/schema.js';
import { conflict, HttpError, notFound } from '../lib/errors.js';
import { githubUserHasInstallation } from '../lib/github.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import {
  connectionToken,
  readGithubConnectionStatus,
  upsertGithubConnection,
} from './github-connection.js';
import {
  cancelGithubConnectionDevice,
  type GithubConnectionDeviceDeps,
  pollGithubConnectionDevice,
  startGithubConnectionDevice,
} from './github-connection-device.js';
import {
  assertSlugFree,
  checkMcpConnector,
  connectorRow,
  type GithubConnectorTarget,
  githubAppOfDeps,
  guardedOAuthFetch,
  type McpConnectorDeps,
  toConnectorRecord,
  UNCHECKED,
} from './mcp-servers.js';

const GITHUB_CATALOG_ID = 'github';

function requireApp(deps: Pick<McpConnectorDeps, 'githubApp'>) {
  const app = githubAppOfDeps(deps);
  if (app === null)
    throw new HttpError(400, 'GitHub sign-in is not set up on this server; use a token');
  return app;
}

export function githubConnectorAvailability(
  deps: Pick<McpConnectorDeps, 'githubApp' | 'db' | 'box'>,
  teamId: string,
): GithubConnectorAvailability {
  const app = githubAppOfDeps(deps);
  const connectionReady = readGithubConnectionStatus(
    { db: deps.db, box: deps.box },
    teamId,
  ).connected;
  return app === null
    ? { available: false, installUrl: null, connectionReady: false }
    : {
        available: true,
        installUrl: `https://github.com/apps/${app.slug}/installations/new`,
        connectionReady,
      };
}

function freeGithubSlug(deps: McpConnectorDeps, teamId: string): string {
  for (let n = 1; n <= 20; n += 1) {
    const slug = n === 1 ? GITHUB_CATALOG_ID : `${GITHUB_CATALOG_ID}-${n}`;
    try {
      assertSlugFree(deps, teamId, slug);
      return slug;
    } catch (err) {
      if (!(err instanceof HttpError && err.status === 409)) throw err;
    }
  }
  throw conflict('every GitHub connector name is taken; delete one first');
}

export function githubConnectorTarget(
  deps: McpConnectorDeps,
  teamId: string,
  connectorId: string | undefined,
): GithubConnectorTarget {
  if (connectorId !== undefined) {
    const row = connectorRow(deps, teamId, connectorId);
    if (row.authKind !== 'github-app')
      throw new HttpError(400, 'only a GitHub sign-in connector can reconnect here');
    return { kind: 'reconnect', connectorId: row.id, authRevision: row.authRevision };
  }
  return { kind: 'new', slug: freeGithubSlug(deps, teamId) };
}

export async function startGithubConnectorDevice(
  deps: McpConnectorDeps,
  connectionDeps: GithubConnectionDeviceDeps,
  input: { teamId: string; userId: string; connectorId?: string | undefined },
): Promise<GithubConnectorDeviceStart> {
  requireApp(deps);
  const target = githubConnectorTarget(deps, input.teamId, input.connectorId);
  return startGithubConnectionDevice(connectionDeps, {
    teamId: input.teamId,
    userId: input.userId,
    target: { type: 'mcp-connector', target },
  });
}

interface ConnectorAttemptTag {
  type: 'mcp-connector';
  target: GithubConnectorTarget;
}

function attemptTarget(
  connectionDeps: GithubConnectionDeviceDeps,
  input: { teamId: string; userId: string; attemptId: string },
): GithubConnectorTarget {
  const attempt = connectionDeps.attempts.get(input.attemptId);
  const tag = attempt?.target;
  if (
    attempt === undefined ||
    attempt.teamId !== input.teamId ||
    attempt.userId !== input.userId ||
    typeof tag !== 'object' ||
    tag === null ||
    (tag as { type?: string }).type !== 'mcp-connector'
  )
    throw notFound('GitHub sign-in attempt');
  return (tag as ConnectorAttemptTag).target;
}

export function cancelGithubConnectorDevice(
  connectionDeps: GithubConnectionDeviceDeps,
  input: { teamId: string; userId: string; attemptId: string },
): void {
  attemptTarget(connectionDeps, input);
  cancelGithubConnectionDevice(connectionDeps, input);
}

export function bindGithubConnector(
  deps: McpConnectorDeps,
  teamId: string,
  target: GithubConnectorTarget,
): string {
  const now = nowMs();
  if (target.kind === 'new') {
    const entry = mcpCatalogEntry(GITHUB_CATALOG_ID);
    if (!entry) throw notFound(`catalog entry ${GITHUB_CATALOG_ID}`);
    if (isLocalCatalogEntry(entry))
      throw new HttpError(400, `${entry.name} runs on the machine and has no url`);
    try {
      assertSlugFree(deps, teamId, target.slug);
    } catch {
      throw conflict(`connector ${target.slug} was created while you signed in; start again`);
    }
    const id = newRecordId();
    deps.db
      .insert(mcpConnector)
      .values({
        id,
        teamId,
        slug: target.slug,
        label: entry.name,
        catalogId: entry.id,
        url: entry.url,
        headerNames: [],
        valuesCipher: null,
        authKind: 'github-app',
        oauthCipher: null,
        authRevision: 1,
        tokenGeneration: 1,
        ...UNCHECKED,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    return id;
  }
  const changed = deps.db
    .update(mcpConnector)
    .set({
      authRevision: target.authRevision + 1,
      ...UNCHECKED,
      updatedAt: sql`max(${now}, ${mcpConnector.updatedAt} + 1)`,
    })
    .where(
      and(
        eq(mcpConnector.id, target.connectorId),
        eq(mcpConnector.teamId, teamId),
        eq(mcpConnector.authKind, 'github-app'),
        eq(mcpConnector.authRevision, target.authRevision),
      ),
    )
    .run().changes;
  if (changed === 0)
    throw conflict('this GitHub connector changed while you signed in; start again');
  return target.connectorId;
}

export async function pollGithubConnectorDevice(
  deps: McpConnectorDeps,
  connectionDeps: GithubConnectionDeviceDeps,
  input: { teamId: string; userId: string; attemptId: string },
): Promise<GithubConnectorDevicePoll> {
  const target = attemptTarget(connectionDeps, input);
  const result = await pollGithubConnectionDevice(connectionDeps, input);
  if (result.status !== 'complete') return result;
  const id = bindGithubConnector(deps, input.teamId, target);
  try {
    await checkMcpConnector(deps, input.teamId, id);
  } catch (err) {
    if (!(err instanceof HttpError)) throw err;
  }
  return {
    status: 'complete',
    connector: toConnectorRecord(deps, connectorRow(deps, input.teamId, id)),
  };
}

export async function githubConnectorInstalled(
  deps: McpConnectorDeps,
  teamId: string,
  connectorId: string,
): Promise<boolean> {
  const row = connectorRow(deps, teamId, connectorId);
  if (row.authKind !== 'github-app')
    throw new HttpError(400, 'only a GitHub sign-in connector has installations');
  const access = await connectionToken(
    {
      db: deps.db,
      box: deps.box,
      githubFetch: deps.githubFetch ?? deps.oauthFetch,
      oauthClient: deps.oauthClient,
    },
    teamId,
  );
  if (!('token' in access)) throw new HttpError(409, 'reconnect GitHub first');
  return githubUserHasInstallation(deps.githubFetch ?? guardedOAuthFetch(deps), access.token);
}

interface LegacyGithubAppSecrets {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  refreshExpiresAt: number;
  login: string;
  userId: number;
}

export function adoptGithubConnectorGrants(
  deps: Pick<McpConnectorDeps, 'db' | 'box' | 'githubApp'>,
): void {
  const rows = deps.db
    .select()
    .from(mcpConnector)
    .where(and(eq(mcpConnector.authKind, 'github-app'), isNotNull(mcpConnector.oauthCipher)))
    .all();
  if (rows.length === 0) return;
  const app = githubAppOfDeps(deps);
  for (const row of rows) {
    let secrets: LegacyGithubAppSecrets;
    try {
      secrets = JSON.parse(deps.box.open(row.oauthCipher as string)) as LegacyGithubAppSecrets;
    } catch {
      continue;
    }
    const hasConnection =
      deps.db
        .select({ teamId: githubConnection.teamId })
        .from(githubConnection)
        .where(eq(githubConnection.teamId, row.teamId))
        .get() !== undefined;
    if (!hasConnection) {
      if (app === null) continue;
      upsertGithubConnection(
        { db: deps.db, box: deps.box },
        {
          teamId: row.teamId,
          login: secrets.login,
          githubUserId: secrets.userId,
          accessToken: secrets.accessToken,
          refreshToken: secrets.refreshToken,
          accessTokenExpiresAt: secrets.expiresAt,
          scope: '',
          device: {
            clientId: app.clientId,
            refreshTokenExpiresAt: secrets.refreshExpiresAt,
          },
        },
      );
    }
    deps.db
      .update(mcpConnector)
      .set({ oauthCipher: null })
      .where(eq(mcpConnector.id, row.id))
      .run();
  }
}
