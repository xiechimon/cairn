import {
  type GithubConnectorAvailability,
  type GithubConnectorDevicePoll,
  type GithubConnectorDeviceStart,
  mcpCatalogEntry,
} from '@cairn/shared';
import { and, eq, sql } from 'drizzle-orm';
import { mcpConnector } from '../db/schema.js';
import { conflict, HttpError, notFound } from '../lib/errors.js';
import { githubUserHasInstallation } from '../lib/github.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import { pollGithubDeviceCode, requestGithubDeviceCode } from './github-device-core.js';
import {
  assertSlugFree,
  checkMcpConnector,
  connectorRow,
  type GithubConnectorAttempt,
  type GithubConnectorTarget,
  githubAppOfDeps,
  guardedOAuthFetch,
  type McpConnectorDeps,
  openGithubApp,
  refreshMcpConnectorToken,
  sealGithubApp,
  toConnectorRecord,
  UNCHECKED,
} from './mcp-servers.js';

const GITHUB_CATALOG_ID = 'github';

function requireApp(deps: McpConnectorDeps) {
  const app = githubAppOfDeps(deps);
  if (app === null)
    throw new HttpError(400, 'GitHub sign-in is not set up on this server; use a token');
  return app;
}

export function githubConnectorAvailability(deps: McpConnectorDeps): GithubConnectorAvailability {
  const app = githubAppOfDeps(deps);
  return app === null
    ? { available: false, installUrl: null }
    : { available: true, installUrl: `https://github.com/apps/${app.slug}/installations/new` };
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

function sweep(attempts: Map<string, GithubConnectorAttempt>): void {
  const now = nowMs();
  for (const [id, attempt] of attempts) if (attempt.expiresAt <= now) attempts.delete(id);
}

export async function startGithubConnectorDevice(
  deps: McpConnectorDeps,
  input: { teamId: string; userId: string; connectorId?: string | undefined },
): Promise<GithubConnectorDeviceStart> {
  const app = requireApp(deps);
  let target: GithubConnectorTarget;
  if (input.connectorId !== undefined) {
    const row = connectorRow(deps, input.teamId, input.connectorId);
    if (row.authKind !== 'github-app')
      throw new HttpError(400, 'only a GitHub sign-in connector can reconnect here');
    target = { kind: 'reconnect', connectorId: row.id, authRevision: row.authRevision };
  } else {
    target = { kind: 'new', slug: freeGithubSlug(deps, input.teamId) };
  }
  const code = await requestGithubDeviceCode({ fetch: guardedOAuthFetch(deps) }, app.clientId);
  const attempts = deps.oauthState.githubDevice;
  sweep(attempts);
  for (const [id, attempt] of attempts) if (attempt.teamId === input.teamId) attempts.delete(id);
  const attemptId = newRecordId(32);
  const now = nowMs();
  attempts.set(attemptId, {
    teamId: input.teamId,
    userId: input.userId,
    deviceCode: code.deviceCode,
    target,
    intervalSeconds: code.intervalSeconds,
    expiresAt: now + code.expiresInSeconds * 1000,
    nextPollAt: now + code.intervalSeconds * 1000,
    polling: false,
  });
  return {
    attemptId,
    userCode: code.userCode,
    verificationUri: code.verificationUri,
    intervalSeconds: code.intervalSeconds,
    expiresInSeconds: code.expiresInSeconds,
  };
}

function ownAttempt(
  deps: McpConnectorDeps,
  input: { teamId: string; userId: string; attemptId: string },
): GithubConnectorAttempt {
  const attempt = deps.oauthState.githubDevice.get(input.attemptId);
  if (!attempt || attempt.teamId !== input.teamId || attempt.userId !== input.userId)
    throw notFound('GitHub sign-in attempt');
  return attempt;
}

export function cancelGithubConnectorDevice(
  deps: McpConnectorDeps,
  input: { teamId: string; userId: string; attemptId: string },
): void {
  ownAttempt(deps, input);
  deps.oauthState.githubDevice.delete(input.attemptId);
}

function saveGrant(
  deps: McpConnectorDeps,
  teamId: string,
  target: GithubConnectorTarget,
  oauthCipher: string,
): string {
  const now = nowMs();
  if (target.kind === 'new') {
    const entry = mcpCatalogEntry(GITHUB_CATALOG_ID);
    if (!entry) throw notFound(`catalog entry ${GITHUB_CATALOG_ID}`);
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
        oauthCipher,
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
      oauthCipher,
      authRevision: target.authRevision + 1,
      tokenGeneration: sql`${mcpConnector.tokenGeneration} + 1`,
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
  input: { teamId: string; userId: string; attemptId: string },
): Promise<GithubConnectorDevicePoll> {
  const attempt = ownAttempt(deps, input);
  const attempts = deps.oauthState.githubDevice;
  const now = nowMs();
  if (attempt.expiresAt <= now) {
    attempts.delete(input.attemptId);
    return { status: 'expired' };
  }
  if (attempt.polling || now < attempt.nextPollAt)
    return { status: 'pending', intervalSeconds: attempt.intervalSeconds };
  const app = requireApp(deps);
  attempt.polling = true;
  let result: Awaited<ReturnType<typeof pollGithubDeviceCode>>;
  try {
    result = await pollGithubDeviceCode(
      { fetch: guardedOAuthFetch(deps) },
      app.clientId,
      attempt.deviceCode,
    );
  } finally {
    attempt.polling = false;
    attempt.nextPollAt = nowMs() + attempt.intervalSeconds * 1000;
  }
  if (attempts.get(input.attemptId) !== attempt) return { status: 'expired' };
  if (result.status === 'pending')
    return { status: 'pending', intervalSeconds: attempt.intervalSeconds };
  if (result.status === 'slow_down') {
    attempt.intervalSeconds = result.intervalSeconds ?? attempt.intervalSeconds + 5;
    attempt.nextPollAt = nowMs() + attempt.intervalSeconds * 1000;
    return { status: 'pending', intervalSeconds: attempt.intervalSeconds };
  }
  attempts.delete(input.attemptId);
  if (result.status !== 'complete') return { status: result.status };
  const id = saveGrant(
    deps,
    input.teamId,
    attempt.target,
    sealGithubApp(deps, result, result.identity),
  );
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
  if ((openGithubApp(deps, row)?.expiresAt ?? 0) <= nowMs())
    await refreshMcpConnectorToken(deps, teamId, connectorId);
  const secrets = openGithubApp(deps, connectorRow(deps, teamId, connectorId));
  if (secrets === null || secrets.expiresAt <= nowMs())
    throw new HttpError(409, 'reconnect GitHub first');
  return githubUserHasInstallation(guardedOAuthFetch(deps), secrets.accessToken);
}
