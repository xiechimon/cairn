import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  BRAND,
  CLAUDE_CONFIG_FILE_NAME,
  type CreateMcpConnectorBody,
  type McpCatalogEntry,
  type McpConnectorRecord,
  type McpConnectorStatus,
  type McpServerRecord,
  mcpCatalogEntry,
  type PatchMcpConnectorBody,
  parseClaudeMcpEntries,
  type SecretBox,
} from '@cairn/shared';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ErrorCode, ListToolsResultSchema, McpError } from '@modelcontextprotocol/sdk/types.js';
import { and, asc, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { machine, mcpConnector } from '../db/schema.js';
import { conflict, HttpError, notFound } from '../lib/errors.js';
import { newRecordId, nowMs } from '../lib/ids.js';

export interface McpServerDeps {
  mcpConfigPath: string;
}

export function defaultMcpConfigPath(): string {
  return join(homedir(), CLAUDE_CONFIG_FILE_NAME);
}

export interface ClaudeMcpRead {
  records: Omit<McpServerRecord, 'teamId' | 'id' | 'createdBy' | 'createdAt' | 'updatedAt'>[];
  mtimeMs: number;
}

export function readClaudeMcpServers(path: string): ClaudeMcpRead {
  let text: string;
  let mtimeMs: number;
  try {
    text = readFileSync(path, 'utf8');
    mtimeMs = Math.floor(statSync(path).mtimeMs);
  } catch {
    return { records: [], mtimeMs: 0 };
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { records: [], mtimeMs };
  }
  const records: ClaudeMcpRead['records'] = [];
  for (const { key, slug, entry } of parseClaudeMcpEntries(json)) {
    if ('command' in entry) {
      const credentialKeys = Object.keys(entry.env ?? {});
      records.push({
        label: key,
        slug,
        transport: 'stdio',
        url: entry.command,
        hasCredential: credentialKeys.length > 0,
        credentialKeys,
      });
      continue;
    }
    const credentialKeys = Object.keys(entry.headers ?? {});
    records.push({
      label: key,
      slug,
      transport: 'http',
      url: entry.url,
      hasCredential: credentialKeys.length > 0,
      credentialKeys,
    });
  }
  return { records, mtimeMs };
}

export function listMcpServers(deps: McpServerDeps, teamId: string): McpServerRecord[] {
  const { records, mtimeMs } = readClaudeMcpServers(deps.mcpConfigPath);
  return records.map((r) => ({
    ...r,
    teamId,
    id: r.slug,
    createdBy: '',
    createdAt: mtimeMs,
    updatedAt: mtimeMs,
  }));
}

const CHECK_TIMEOUT_MS = 10_000;
const MAX_TOOL_PAGES = 10;

export interface McpConnectorDeps {
  db: Db;
  box: SecretBox;
  mcpConfigPath: string;
  fetch: typeof fetch;
  checkTimeoutMs?: number;
}

type ConnectorRow = typeof mcpConnector.$inferSelect;

function toConnectorRecord(row: ConnectorRow): McpConnectorRecord {
  const url = new URL(row.url);
  return {
    id: row.id,
    teamId: row.teamId,
    slug: row.slug,
    label: row.label,
    catalogId: row.catalogId,
    url: `${url.origin}${url.pathname}`,
    headerNames: row.headerNames,
    status: row.status,
    statusReason: row.statusReason,
    toolCount: row.toolCount,
    checkedAt: row.checkedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function connectorRow(deps: McpConnectorDeps, teamId: string, id: string): ConnectorRow {
  const row = deps.db
    .select()
    .from(mcpConnector)
    .where(and(eq(mcpConnector.id, id), eq(mcpConnector.teamId, teamId)))
    .get();
  if (!row) throw notFound(`mcp connector ${id}`);
  return row;
}

function openHeaders(deps: McpConnectorDeps, row: ConnectorRow): Record<string, string> {
  return row.valuesCipher === null
    ? {}
    : (JSON.parse(deps.box.open(row.valuesCipher)) as Record<string, string>);
}

interface ConnectorTarget {
  url: string;
  headers: Record<string, string>;
}

function catalogTarget(
  entry: McpCatalogEntry,
  token: string | undefined,
  options: Record<string, string>,
): ConnectorTarget {
  if (token !== undefined && !entry.auth.includes('token'))
    throw new HttpError(400, `${entry.name} does not take a token`);
  if (token === undefined && !entry.auth.includes('none'))
    throw new HttpError(400, `${entry.name} needs a token`);
  const url = new URL(entry.url);
  const headers: Record<string, string> =
    token === undefined ? {} : { Authorization: `Bearer ${token}` };
  for (const [id, value] of Object.entries(options)) {
    const option = entry.options.find((o) => o.id === id);
    if (!option) throw new HttpError(400, `${entry.name} has no option ${id}`);
    if (option.input === 'flag' ? value !== 'true' : value.trim() === '')
      throw new HttpError(400, `option ${id} has an invalid value`);
    if (option.kind === 'query') url.searchParams.set(option.name, value.trim());
    else headers[option.name] = value.trim();
  }
  return { url: url.toString(), headers };
}

function catalogState(
  entry: McpCatalogEntry,
  row: ConnectorRow,
  headers: Record<string, string>,
): { token: string | undefined; options: Record<string, string> } {
  const url = new URL(row.url);
  const options: Record<string, string> = {};
  for (const option of entry.options) {
    const value =
      option.kind === 'query' ? url.searchParams.get(option.name) : headers[option.name];
    if (value != null) options[option.id] = value;
  }
  const auth = headers.Authorization;
  return { token: auth?.startsWith('Bearer ') ? auth.slice(7) : undefined, options };
}

function localSlugs(deps: McpConnectorDeps, teamId: string): Set<string> {
  const slugs = new Set(readClaudeMcpServers(deps.mcpConfigPath).records.map((r) => r.slug));
  for (const { capabilities } of deps.db
    .select({ capabilities: machine.capabilities })
    .from(machine)
    .where(eq(machine.teamId, teamId))
    .all()) {
    for (const slug of capabilities?.mcpServers ?? []) slugs.add(slug.toLowerCase());
  }
  return slugs;
}

function sealHeaders(deps: McpConnectorDeps, headers: Record<string, string>) {
  return {
    headerNames: Object.keys(headers),
    valuesCipher: Object.keys(headers).length === 0 ? null : deps.box.seal(JSON.stringify(headers)),
  };
}

const UNCHECKED = {
  status: 'unchecked',
  statusReason: null,
  toolCount: null,
  checkedAt: null,
} as const;

export function listMcpConnectors(deps: McpConnectorDeps, teamId: string): McpConnectorRecord[] {
  return deps.db
    .select()
    .from(mcpConnector)
    .where(eq(mcpConnector.teamId, teamId))
    .orderBy(asc(mcpConnector.slug))
    .all()
    .map(toConnectorRecord);
}

export function createMcpConnector(
  deps: McpConnectorDeps,
  teamId: string,
  body: CreateMcpConnectorBody,
): McpConnectorRecord {
  let label: string;
  let target: ConnectorTarget;
  if (body.kind === 'catalog') {
    const entry = mcpCatalogEntry(body.catalogId);
    if (!entry) throw notFound(`catalog entry ${body.catalogId}`);
    label = entry.name;
    target = catalogTarget(entry, body.token, body.options ?? {});
  } else {
    label = body.label;
    target = { url: body.url, headers: body.headers ?? {} };
  }
  if (localSlugs(deps, teamId).has(body.slug))
    throw conflict(`${body.slug} is already a local MCP server; choose another name`);
  const taken = deps.db
    .select({ id: mcpConnector.id })
    .from(mcpConnector)
    .where(and(eq(mcpConnector.teamId, teamId), eq(mcpConnector.slug, body.slug)))
    .get();
  if (taken) throw conflict(`connector ${body.slug} already exists`);
  const now = nowMs();
  const id = newRecordId();
  deps.db
    .insert(mcpConnector)
    .values({
      id,
      teamId,
      slug: body.slug,
      label,
      catalogId: body.kind === 'catalog' ? body.catalogId : null,
      url: target.url,
      ...sealHeaders(deps, target.headers),
      ...UNCHECKED,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return toConnectorRecord(connectorRow(deps, teamId, id));
}

export function updateMcpConnector(
  deps: McpConnectorDeps,
  teamId: string,
  id: string,
  patch: PatchMcpConnectorBody,
): { record: McpConnectorRecord; targetChanged: boolean } {
  const row = connectorRow(deps, teamId, id);
  let target: ConnectorTarget | null = null;
  const entry = row.catalogId === null ? undefined : mcpCatalogEntry(row.catalogId);
  if (entry) {
    if (patch.url !== undefined || patch.headers !== undefined)
      throw new HttpError(
        400,
        'a catalog connector takes a token and options, not a url or headers',
      );
    if (patch.token !== undefined || patch.options !== undefined) {
      const current = catalogState(entry, row, openHeaders(deps, row));
      target = catalogTarget(entry, patch.token ?? current.token, patch.options ?? current.options);
    }
  } else {
    if (patch.token !== undefined || patch.options !== undefined)
      throw new HttpError(
        400,
        'a custom connector takes a url and headers, not a token or options',
      );
    if (patch.url !== undefined || patch.headers !== undefined) {
      const url = patch.url ?? row.url;
      if (new URL(url).origin !== new URL(row.url).origin && patch.headers === undefined)
        throw new HttpError(400, 'a new origin needs its headers again');
      target = { url, headers: patch.headers ?? openHeaders(deps, row) };
    }
  }
  deps.db
    .update(mcpConnector)
    .set({
      ...(patch.label !== undefined ? { label: patch.label } : {}),
      ...(target !== null
        ? { url: target.url, ...sealHeaders(deps, target.headers), ...UNCHECKED }
        : {}),
      updatedAt: Math.max(nowMs(), row.updatedAt + 1),
    })
    .where(eq(mcpConnector.id, row.id))
    .run();
  return {
    record: toConnectorRecord(connectorRow(deps, teamId, id)),
    targetChanged: target !== null,
  };
}

export function deleteMcpConnector(deps: McpConnectorDeps, teamId: string, id: string): boolean {
  return (
    deps.db
      .delete(mcpConnector)
      .where(and(eq(mcpConnector.id, id), eq(mcpConnector.teamId, teamId)))
      .run().changes > 0
  );
}

interface ProbeResult {
  status: Exclude<McpConnectorStatus, 'unchecked'>;
  statusReason: string | null;
  toolCount: number | null;
}

function probeFailure(err: unknown): ProbeResult {
  const code = err instanceof StreamableHTTPError ? err.code : undefined;
  if (err instanceof UnauthorizedError || code === 401)
    return { status: 'needs_auth', statusReason: 'unauthorized', toolCount: null };
  if (code === 403) return { status: 'needs_auth', statusReason: 'forbidden', toolCount: null };
  if (err instanceof McpError && err.code === ErrorCode.RequestTimeout)
    return { status: 'error', statusReason: 'timeout', toolCount: null };
  if (typeof code === 'number' && code > 0)
    return { status: 'error', statusReason: `http_${code}`, toolCount: null };
  return { status: 'error', statusReason: 'unreachable', toolCount: null };
}

async function probeMcpServer(
  deps: McpConnectorDeps,
  url: string,
  headers: Record<string, string>,
): Promise<ProbeResult> {
  const timeout = deps.checkTimeoutMs ?? CHECK_TIMEOUT_MS;
  const deadline = AbortSignal.timeout(timeout);
  const client = new Client({ name: BRAND.cliCommandName, version: '0.1.0' });
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers },
    fetch: (input, init) =>
      deps.fetch(input, {
        ...init,
        redirect: 'manual',
        signal: init?.signal ? AbortSignal.any([init.signal, deadline]) : deadline,
      }),
  });
  try {
    await client.connect(transport, { timeout });
    let toolCount = 0;
    let cursor: string | undefined;
    for (let page = 0; page < MAX_TOOL_PAGES; page += 1) {
      const result = await client.request(
        { method: 'tools/list', params: cursor === undefined ? {} : { cursor } },
        ListToolsResultSchema,
        { timeout },
      );
      toolCount += result.tools.length;
      cursor = result.nextCursor;
      if (cursor === undefined) break;
    }
    return { status: 'connected', statusReason: null, toolCount };
  } catch (err) {
    if (deadline.aborted) return { status: 'error', statusReason: 'timeout', toolCount: null };
    return probeFailure(err);
  } finally {
    await client.close().catch(() => {});
  }
}

export async function checkMcpConnector(
  deps: McpConnectorDeps,
  teamId: string,
  id: string,
): Promise<McpConnectorRecord> {
  const row = connectorRow(deps, teamId, id);
  const result = await probeMcpServer(deps, row.url, openHeaders(deps, row));
  deps.db
    .update(mcpConnector)
    .set({ ...result, checkedAt: nowMs() })
    .where(and(eq(mcpConnector.id, row.id), eq(mcpConnector.updatedAt, row.updatedAt)))
    .run();
  return toConnectorRecord(connectorRow(deps, teamId, id));
}
