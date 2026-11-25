import type { ComposioApps, ComposioAuthorizeResponse, McpConnectorRecord } from '@cairn/shared';
import { COMPOSIO_CATALOG_ID, composioToolkitSlugSchema } from '@cairn/shared';
import { and, eq } from 'drizzle-orm';
import { mcpConnector } from '../db/schema.js';
import { HttpError, notFound } from '../lib/errors.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import {
  type ComposioDeps,
  createComposioLink,
  createComposioSession,
  findActiveComposioAccount,
  getComposioAccount,
  listComposioToolkits,
  readComposioKey,
  revokeComposioAccount,
} from './composio.js';
import {
  assertSlugFree,
  checkMcpConnector,
  connectorRow,
  deleteMcpConnector,
  type McpConnectorDeps,
  toConnectorRecord,
} from './mcp-servers.js';

export interface ComposioConnectorDeps {
  composio: ComposioDeps;
  mcp: McpConnectorDeps;
}

type ConnectorRow = typeof mcpConnector.$inferSelect;

function composioRows(deps: ComposioConnectorDeps, teamId: string): ConnectorRow[] {
  return deps.mcp.db
    .select()
    .from(mcpConnector)
    .where(and(eq(mcpConnector.teamId, teamId), eq(mcpConnector.catalogId, COMPOSIO_CATALOG_ID)))
    .all();
}

function composioRow(deps: ComposioConnectorDeps, teamId: string, id: string): ConnectorRow {
  const row = connectorRow(deps.mcp, teamId, id);
  if (row.authKind !== 'composio') throw notFound(`composio connector ${id}`);
  return row;
}

function requireKey(deps: ComposioConnectorDeps, teamId: string): string {
  const key = readComposioKey(deps.composio, teamId);
  if (key === null)
    throw new HttpError(400, 'no Composio API key is saved; add one under MCP servers');
  return key;
}

export async function listComposioApps(
  deps: ComposioConnectorDeps,
  teamId: string,
): Promise<ComposioApps> {
  const configured = readComposioKey(deps.composio, teamId) !== null;
  if (!configured) return { configured: false, apps: [] };
  const toolkits = await listComposioToolkits(deps.composio, teamId);
  const rows = composioRows(deps, teamId);
  const bySlug = new Map(rows.map((row) => [row.slug, row]));
  const apps = toolkits.map((toolkit) => {
    const row = bySlug.get(toolkit.slug);
    return {
      slug: toolkit.slug,
      name: toolkit.name,
      description: toolkit.description,
      logoUrl: toolkit.logoUrl,
      noAuth: toolkit.noAuth,
      toolsCount: toolkit.toolsCount,
      connector: row === undefined ? null : toConnectorRecord(deps.mcp, row),
    };
  });
  return { configured: true, apps };
}

async function ensureSession(
  deps: ComposioConnectorDeps,
  teamId: string,
  row: ConnectorRow,
): Promise<{ row: ConnectorRow; sessionId: string }> {
  if (row.composioSession !== null) return { row, sessionId: row.composioSession };
  const session = await createComposioSession(deps.composio, teamId, row.slug);
  deps.mcp.db
    .update(mcpConnector)
    .set({ composioSession: session.sessionId, url: session.mcpUrl, updatedAt: nowMs() })
    .where(eq(mcpConnector.id, row.id))
    .run();
  return { row: connectorRow(deps.mcp, teamId, row.id), sessionId: session.sessionId };
}

const CLEAR_CACHED_TOOLS = { toolCount: null, toolsJson: null } as const;

function setStatus(
  deps: ComposioConnectorDeps,
  row: ConnectorRow,
  patch: Partial<typeof mcpConnector.$inferInsert>,
): void {
  deps.mcp.db
    .update(mcpConnector)
    .set({ ...patch, updatedAt: Math.max(nowMs(), row.updatedAt + 1) })
    .where(eq(mcpConnector.id, row.id))
    .run();
}

export async function connectComposioApp(
  deps: ComposioConnectorDeps,
  teamId: string,
  slug: string,
): Promise<McpConnectorRecord> {
  requireKey(deps, teamId);
  const parsed = composioToolkitSlugSchema.safeParse(slug);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? 'bad slug');
  const toolkits = await listComposioToolkits(deps.composio, teamId);
  const toolkit = toolkits.find((entry) => entry.slug === slug);
  if (toolkit === undefined) throw notFound(`composio toolkit ${slug}`);
  assertSlugFree(deps.mcp, teamId, slug);
  const account = toolkit.noAuth
    ? null
    : await findActiveComposioAccount(deps.composio, teamId, slug);
  const session = await createComposioSession(deps.composio, teamId, slug);
  const now = nowMs();
  const id = newRecordId();
  deps.mcp.db
    .insert(mcpConnector)
    .values({
      id,
      teamId,
      slug,
      label: toolkit.name,
      catalogId: COMPOSIO_CATALOG_ID,
      url: session.mcpUrl,
      headerNames: ['x-api-key'],
      authKind: 'composio',
      status: account === null && !toolkit.noAuth ? 'needs_auth' : 'unchecked',
      statusReason: account === null && !toolkit.noAuth ? 'no connected account' : null,
      composioSession: session.sessionId,
      composioAccount: account,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  if (account !== null || toolkit.noAuth) await checkMcpConnector(deps.mcp, teamId, id);
  return toConnectorRecord(deps.mcp, connectorRow(deps.mcp, teamId, id));
}

export async function authorizeComposioApp(
  deps: ComposioConnectorDeps,
  teamId: string,
  id: string,
): Promise<ComposioAuthorizeResponse> {
  requireKey(deps, teamId);
  const row = composioRow(deps, teamId, id);
  let active: string | null = null;
  if (row.composioAccount !== null) {
    const existing = await getComposioAccount(deps.composio, teamId, row.composioAccount);
    if (existing !== null && !existing.isDisabled && existing.status === 'ACTIVE')
      active = existing.id;
  }
  if (active === null) active = await findActiveComposioAccount(deps.composio, teamId, row.slug);
  if (active !== null) {
    if (row.composioAccount !== active || row.status !== 'connected')
      setStatus(deps, row, {
        composioAccount: active,
        status: 'unchecked',
        statusReason: null,
        ...CLEAR_CACHED_TOOLS,
      });
    const record = await checkMcpConnector(deps.mcp, teamId, id);
    return { redirectUrl: null, connector: record };
  }
  const ensured = await ensureSession(deps, teamId, row);
  const link = await createComposioLink(deps.composio, teamId, ensured.sessionId, row.slug);
  setStatus(deps, row, {
    composioAccount: link.connectedAccountId,
    status: 'needs_auth',
    statusReason: 'authorizing',
    ...CLEAR_CACHED_TOOLS,
  });
  return {
    redirectUrl: link.redirectUrl,
    connector: toConnectorRecord(deps.mcp, connectorRow(deps.mcp, teamId, id)),
  };
}

export async function pollComposioApp(
  deps: ComposioConnectorDeps,
  teamId: string,
  id: string,
): Promise<McpConnectorRecord> {
  requireKey(deps, teamId);
  let row = composioRow(deps, teamId, id);
  if (row.status === 'revoked') return toConnectorRecord(deps.mcp, row);
  const accountId =
    row.composioAccount ?? (await findActiveComposioAccount(deps.composio, teamId, row.slug));
  if (accountId === null) {
    if (row.status !== 'needs_auth')
      setStatus(deps, row, {
        status: 'needs_auth',
        statusReason: 'no connected account',
        ...CLEAR_CACHED_TOOLS,
      });
    return toConnectorRecord(deps.mcp, connectorRow(deps.mcp, teamId, id));
  }
  const account = await getComposioAccount(deps.composio, teamId, accountId);
  row = connectorRow(deps.mcp, teamId, id);
  if (account === null) {
    setStatus(deps, row, {
      status: 'revoked',
      statusReason: 'account removed',
      ...CLEAR_CACHED_TOOLS,
    });
    return toConnectorRecord(deps.mcp, connectorRow(deps.mcp, teamId, id));
  }
  if (account.isDisabled || account.status === 'INACTIVE') {
    setStatus(deps, row, {
      status: 'revoked',
      statusReason: 'account disabled',
      ...CLEAR_CACHED_TOOLS,
    });
  } else if (account.status === 'ACTIVE') {
    if (row.composioAccount !== accountId) setStatus(deps, row, { composioAccount: accountId });
    const record = await checkMcpConnector(deps.mcp, teamId, id);
    if (record.status === 'error') {
      const session = await createComposioSession(deps.composio, teamId, row.slug);
      setStatus(deps, connectorRow(deps.mcp, teamId, id), {
        composioSession: session.sessionId,
        url: session.mcpUrl,
        status: 'unchecked',
        ...CLEAR_CACHED_TOOLS,
      });
      return checkMcpConnector(deps.mcp, teamId, id);
    }
    return record;
  } else if (account.status === 'INITIALIZING' || account.status === 'INITIATED') {
    setStatus(deps, row, {
      status: 'needs_auth',
      statusReason: 'authorizing',
      ...CLEAR_CACHED_TOOLS,
    });
  } else if (account.status === 'FAILED') {
    setStatus(deps, row, {
      status: 'needs_auth',
      statusReason: account.statusReason ?? 'authorization failed',
      ...CLEAR_CACHED_TOOLS,
    });
  } else if (account.status === 'EXPIRED') {
    setStatus(deps, row, {
      status: 'needs_auth',
      statusReason: 'expired',
      ...CLEAR_CACHED_TOOLS,
    });
  } else {
    setStatus(deps, row, {
      status: 'needs_auth',
      statusReason: account.statusReason ?? 'waiting',
      ...CLEAR_CACHED_TOOLS,
    });
  }
  return toConnectorRecord(deps.mcp, connectorRow(deps.mcp, teamId, id));
}

export async function revokeComposioApp(
  deps: ComposioConnectorDeps,
  teamId: string,
  id: string,
): Promise<McpConnectorRecord> {
  const row = composioRow(deps, teamId, id);
  if (row.composioAccount !== null && readComposioKey(deps.composio, teamId) !== null)
    await revokeComposioAccount(deps.composio, teamId, row.composioAccount);
  setStatus(deps, row, {
    status: 'revoked',
    statusReason: 'revoked',
    ...CLEAR_CACHED_TOOLS,
  });
  return toConnectorRecord(deps.mcp, connectorRow(deps.mcp, teamId, id));
}

export async function removeComposioApp(
  deps: ComposioConnectorDeps,
  teamId: string,
  id: string,
): Promise<boolean> {
  const row = composioRow(deps, teamId, id);
  if (row.composioAccount !== null && readComposioKey(deps.composio, teamId) !== null)
    await revokeComposioAccount(deps.composio, teamId, row.composioAccount);
  return deleteMcpConnector(deps.mcp, teamId, id);
}

export async function reconnectComposioApp(
  deps: ComposioConnectorDeps,
  teamId: string,
  id: string,
): Promise<ComposioAuthorizeResponse> {
  const row = composioRow(deps, teamId, id);
  if (row.status === 'revoked')
    setStatus(deps, row, {
      status: 'needs_auth',
      statusReason: 'reconnect',
      ...CLEAR_CACHED_TOOLS,
    });
  else if (row.status === 'error')
    setStatus(deps, row, {
      status: 'unchecked',
      statusReason: null,
      ...CLEAR_CACHED_TOOLS,
    });
  return authorizeComposioApp(deps, teamId, id);
}
