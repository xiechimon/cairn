import { lookup as dnsLookup, type LookupAddress, type LookupOptions } from 'node:dns';
import { readFileSync, statSync } from 'node:fs';
import { isIP } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  BRAND,
  CLAUDE_CONFIG_FILE_NAME,
  type CreateMcpConnectorBody,
  type McpCatalogEntry,
  type McpConnectorAuthKind,
  type McpConnectorOAuthMeta,
  type McpConnectorRecord,
  type McpConnectorStatus,
  type McpServerRecord,
  mcpCatalogEntry,
  type PatchMcpConnectorBody,
  parseClaudeMcpEntries,
  type SecretBox,
  type StartMcpConnectorOAuthBody,
} from '@cairn/shared';
import { isPrivateAddress } from '@cairn/shared/private-address';
import {
  discoverAuthorizationServerMetadata,
  discoverOAuthProtectedResourceMetadata,
  exchangeAuthorization,
  refreshAuthorization,
  registerClient,
  startAuthorization,
  UnauthorizedError,
} from '@modelcontextprotocol/sdk/client/auth.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  InvalidClientError,
  InvalidGrantError,
} from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type {
  AuthorizationServerMetadata,
  OAuthClientInformationFull,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { checkResourceAllowed } from '@modelcontextprotocol/sdk/shared/auth-utils.js';
import { ErrorCode, ListToolsResultSchema, McpError } from '@modelcontextprotocol/sdk/types.js';
import { and, asc, eq, sql } from 'drizzle-orm';
import { Agent, fetch as undiciFetch } from 'undici';
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

export interface McpOAuthState {
  registrations: Map<string, OAuthClientInformationFull>;
  refreshes: Map<string, Promise<void>>;
}

export function newMcpOAuthState(): McpOAuthState {
  return { registrations: new Map(), refreshes: new Map() };
}

export interface McpConnectorDeps {
  db: Db;
  box: SecretBox;
  mcpConfigPath: string;
  fetch: typeof fetch;
  oauthFetch: typeof fetch;
  oauthState: McpOAuthState;
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
    authKind: row.authKind,
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
  oauth = false,
): ConnectorTarget {
  if (oauth && !entry.auth.includes('oauth'))
    throw new HttpError(400, `${entry.name} does not offer browser sign-in`);
  if (token !== undefined && !entry.auth.includes('token'))
    throw new HttpError(400, `${entry.name} does not take a token`);
  if (!oauth && token === undefined && !entry.auth.includes('none'))
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

function staticAuthKind(headers: Record<string, string>): McpConnectorAuthKind {
  return Object.keys(headers).length === 0 ? 'none' : 'static';
}

function assertSlugFree(deps: McpConnectorDeps, teamId: string, slug: string): void {
  if (localSlugs(deps, teamId).has(slug))
    throw conflict(`${slug} is already a local MCP server; choose another name`);
  const taken = deps.db
    .select({ id: mcpConnector.id })
    .from(mcpConnector)
    .where(and(eq(mcpConnector.teamId, teamId), eq(mcpConnector.slug, slug)))
    .get();
  if (taken) throw conflict(`connector ${slug} already exists`);
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
  assertSlugFree(deps, teamId, body.slug);
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
      authKind: staticAuthKind(target.headers),
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
  const oauth = row.authKind === 'oauth';
  let target: ConnectorTarget | null = null;
  let dropTokens = false;
  const entry = row.catalogId === null ? undefined : mcpCatalogEntry(row.catalogId);
  if (oauth && (patch.token !== undefined || patch.headers !== undefined))
    throw new HttpError(400, 'this connector signs in with the browser; reconnect it instead');
  if (entry) {
    if (patch.url !== undefined || patch.headers !== undefined)
      throw new HttpError(
        400,
        'a catalog connector takes a token and options, not a url or headers',
      );
    if (patch.token !== undefined || patch.options !== undefined) {
      const current = catalogState(entry, row, openHeaders(deps, row));
      target = catalogTarget(
        entry,
        patch.token ?? current.token,
        patch.options ?? current.options,
        oauth,
      );
    }
  } else if (oauth) {
    if (patch.options !== undefined)
      throw new HttpError(400, 'a custom connector takes a url, not options');
    if (patch.url !== undefined) {
      target = { url: patch.url, headers: {} };
      dropTokens = new URL(patch.url).origin !== new URL(row.url).origin;
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
        ? {
            url: target.url,
            ...sealHeaders(deps, target.headers),
            ...(oauth ? {} : { authKind: staticAuthKind(target.headers) }),
            ...UNCHECKED,
          }
        : {}),
      ...(dropTokens
        ? { oauthMeta: null, oauthCipher: null, authRevision: row.authRevision + 1 }
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

interface OAuthSecrets {
  client: OAuthClientInformationFull;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number | null;
}

function openOAuth(deps: McpConnectorDeps, row: ConnectorRow): OAuthSecrets | null {
  return row.oauthCipher === null
    ? null
    : (JSON.parse(deps.box.open(row.oauthCipher)) as OAuthSecrets);
}

function sealOAuth(
  deps: McpConnectorDeps,
  client: OAuthClientInformationFull,
  tokens: OAuthTokens,
  previousRefresh: string | null,
): string {
  const secrets: OAuthSecrets = {
    client,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? previousRefresh,
    expiresAt: tokens.expires_in === undefined ? null : nowMs() + tokens.expires_in * 1000,
  };
  return deps.box.seal(JSON.stringify(secrets));
}

export async function checkMcpConnector(
  deps: McpConnectorDeps,
  teamId: string,
  id: string,
): Promise<McpConnectorRecord> {
  let row = connectorRow(deps, teamId, id);
  let result: ProbeResult;
  if (row.authKind === 'oauth') {
    const before = openOAuth(deps, row);
    if (before?.expiresAt != null && before.expiresAt <= nowMs()) {
      await refreshMcpConnectorToken(deps, teamId, id);
      row = connectorRow(deps, teamId, id);
    }
    const secrets = openOAuth(deps, row);
    if (secrets === null) {
      result = { status: 'needs_auth', statusReason: 'reconnect', toolCount: null };
    } else if (secrets.expiresAt !== null && secrets.expiresAt <= nowMs()) {
      return toConnectorRecord(row);
    } else {
      result = await probeMcpServer(deps, row.url, {
        ...openHeaders(deps, row),
        Authorization: `Bearer ${secrets.accessToken}`,
      });
    }
  } else {
    result = await probeMcpServer(deps, row.url, openHeaders(deps, row));
  }
  deps.db
    .update(mcpConnector)
    .set({ ...result, checkedAt: nowMs() })
    .where(
      and(
        eq(mcpConnector.id, row.id),
        eq(mcpConnector.updatedAt, row.updatedAt),
        eq(mcpConnector.authRevision, row.authRevision),
        eq(mcpConnector.tokenGeneration, row.tokenGeneration),
      ),
    )
    .run();
  return toConnectorRecord(connectorRow(deps, teamId, id));
}

const OAUTH_TIMEOUT_MS = 10_000;

function publicLookup(
  hostname: string,
  options: LookupOptions,
  callback: (
    err: NodeJS.ErrnoException | null,
    address: string | LookupAddress[],
    family?: number,
  ) => void,
): void {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, []);
    const first = addresses[0];
    if (first === undefined || addresses.some((a) => isPrivateAddress(a.address)))
      return callback(new Error(`${hostname} resolves to a non-public address`), []);
    if (options.all) return callback(null, addresses);
    return callback(null, first.address, first.family);
  });
}

const publicAgent = new Agent({ connect: { lookup: publicLookup } });

export const publicOAuthFetch = ((input: string | URL, init?: RequestInit) =>
  undiciFetch(input, {
    ...(init as Parameters<typeof undiciFetch>[1]),
    dispatcher: publicAgent,
  })) as unknown as typeof fetch;

function guardedOAuthFetch(deps: McpConnectorDeps): typeof fetch {
  return (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.protocol !== 'https:')
      return Promise.reject(new Error('oauth endpoints must be https'));
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (isIP(host) !== 0 && isPrivateAddress(host))
      return Promise.reject(new Error('oauth endpoints must be public'));
    const deadline = AbortSignal.timeout(deps.checkTimeoutMs ?? OAUTH_TIMEOUT_MS);
    return deps.oauthFetch(url, {
      ...init,
      redirect: 'manual',
      signal: init?.signal ? AbortSignal.any([init.signal, deadline]) : deadline,
    });
  };
}

export type McpOAuthTarget =
  | {
      kind: 'new';
      slug: string;
      label: string;
      catalogId: string | null;
      url: string;
      headers: Record<string, string>;
    }
  | { kind: 'reconnect'; connectorId: string; authRevision: number };

export interface McpOAuthPending {
  target: McpOAuthTarget;
  meta: McpConnectorOAuthMeta;
  metadata: AuthorizationServerMetadata;
  client: OAuthClientInformationFull;
  codeVerifier: string;
  issRequired: boolean;
}

export class McpOAuthError extends Error {
  constructor(readonly reason: 'issuer' | 'exchange' | 'conflict') {
    super(`mcp connector oauth ${reason}`);
    this.name = 'McpOAuthError';
  }
}

function oauthTarget(
  deps: McpConnectorDeps,
  teamId: string,
  body: StartMcpConnectorOAuthBody,
): { target: McpOAuthTarget; url: string } {
  if (body.kind === 'reconnect') {
    const row = connectorRow(deps, teamId, body.connectorId);
    if (row.authKind !== 'oauth')
      throw new HttpError(400, 'only a browser sign-in connector can reconnect');
    return {
      target: { kind: 'reconnect', connectorId: row.id, authRevision: row.authRevision },
      url: row.url,
    };
  }
  assertSlugFree(deps, teamId, body.slug);
  if (body.kind === 'custom')
    return {
      target: {
        kind: 'new',
        slug: body.slug,
        label: body.label,
        catalogId: null,
        url: body.url,
        headers: {},
      },
      url: body.url,
    };
  const entry = mcpCatalogEntry(body.catalogId);
  if (!entry) throw notFound(`catalog entry ${body.catalogId}`);
  const built = catalogTarget(entry, undefined, body.options ?? {}, true);
  return {
    target: {
      kind: 'new',
      slug: body.slug,
      label: entry.name,
      catalogId: entry.id,
      url: built.url,
      headers: built.headers,
    },
    url: built.url,
  };
}

function redirectFor(origin: string): { redirectUri: string; applicationType: 'native' | 'web' } {
  if (!URL.canParse(origin)) throw new HttpError(400, 'the request has no usable origin');
  const url = new URL(origin);
  const loopback =
    url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !loopback)
    throw new HttpError(400, 'browser sign-in needs an https or loopback address; use a token');
  return {
    redirectUri: `${url.origin}/api/oauth/callback`,
    applicationType: loopback ? 'native' : 'web',
  };
}

async function discoverAuthServer(
  fetchFn: typeof fetch,
  serverUrl: string,
): Promise<{ asUrl: string; resource: URL; scope: string | null }> {
  const server = new URL(serverUrl);
  try {
    const prm = await discoverOAuthProtectedResourceMetadata(serverUrl, {}, fetchFn);
    if (!checkResourceAllowed({ requestedResource: server, configuredResource: prm.resource }))
      throw new HttpError(400, 'the server names a resource that does not match its url');
    const asUrl = prm.authorization_servers?.[0];
    return {
      asUrl: asUrl ?? server.origin,
      resource: new URL(prm.resource),
      scope: prm.scopes_supported?.join(' ') || null,
    };
  } catch (err) {
    if (err instanceof HttpError) throw err;
    return {
      asUrl: server.origin,
      resource: new URL(`${server.origin}${server.pathname}`),
      scope: null,
    };
  }
}

function registrationKey(issuer: string, redirectUri: string): string {
  return `${issuer}\n${redirectUri}`;
}

function forgetClient(deps: McpConnectorDeps, key: string, clientId: string): void {
  if (deps.oauthState.registrations.get(key)?.client_id === clientId)
    deps.oauthState.registrations.delete(key);
}

function usableClient(client: OAuthClientInformationFull | undefined) {
  const expires = client?.client_secret_expires_at;
  return expires === undefined || expires === 0 || expires * 1000 > nowMs() ? client : undefined;
}

async function oauthClient(
  deps: McpConnectorDeps,
  fetchFn: typeof fetch,
  input: {
    asUrl: string;
    metadata: AuthorizationServerMetadata;
    redirectUri: string;
    applicationType: 'native' | 'web';
  },
): Promise<OAuthClientInformationFull> {
  const key = registrationKey(input.metadata.issuer, input.redirectUri);
  const cached = usableClient(deps.oauthState.registrations.get(key));
  if (cached) return cached;
  const clientMetadata = {
    client_name: BRAND.manifestName,
    redirect_uris: [input.redirectUri],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    application_type: input.applicationType,
  } satisfies OAuthClientMetadata & { application_type: string };
  let client: OAuthClientInformationFull;
  try {
    client = await registerClient(input.asUrl, {
      metadata: input.metadata,
      clientMetadata,
      fetchFn,
    });
  } catch {
    throw new HttpError(502, 'the authorization server refused to register Cairn');
  }
  deps.oauthState.registrations.set(key, client);
  return client;
}

export async function prepareMcpConnectorOAuth(
  deps: McpConnectorDeps,
  teamId: string,
  input: { body: StartMcpConnectorOAuthBody; origin: string; state: string },
): Promise<{ authorizationUrl: string; pending: McpOAuthPending }> {
  const { target, url } = oauthTarget(deps, teamId, input.body);
  const { redirectUri, applicationType } = redirectFor(input.origin);
  const fetchFn = guardedOAuthFetch(deps);
  const { asUrl, resource, scope } = await discoverAuthServer(fetchFn, url);
  let issAdvertised = false;
  const metadataFetch: typeof fetch = async (request, init) => {
    const res = await fetchFn(request, init);
    if (res.ok) {
      const raw: unknown = await res
        .clone()
        .json()
        .catch(() => null);
      issAdvertised =
        typeof raw === 'object' &&
        raw !== null &&
        'authorization_response_iss_parameter_supported' in raw &&
        raw.authorization_response_iss_parameter_supported === true;
    }
    return res;
  };
  let metadata: AuthorizationServerMetadata | undefined;
  try {
    metadata = await discoverAuthorizationServerMetadata(asUrl, { fetchFn: metadataFetch });
  } catch {
    metadata = undefined;
  }
  if (metadata === undefined)
    throw new HttpError(400, 'this server does not offer browser sign-in; use a token');
  if (!metadata.code_challenge_methods_supported?.includes('S256'))
    throw new HttpError(400, 'the authorization server does not support PKCE S256');
  if (metadata.registration_endpoint === undefined)
    throw new HttpError(400, 'the authorization server needs your own OAuth app');
  if (!URL.canParse(metadata.issuer) || new URL(metadata.issuer).origin !== new URL(asUrl).origin)
    throw new HttpError(400, 'the authorization server metadata names another issuer');
  if (
    !URL.canParse(metadata.authorization_endpoint) ||
    new URL(metadata.authorization_endpoint).protocol !== 'https:'
  )
    throw new HttpError(400, 'the authorization endpoint must be https');
  const client = await oauthClient(deps, fetchFn, {
    asUrl,
    metadata,
    redirectUri,
    applicationType,
  });
  const { authorizationUrl, codeVerifier } = await startAuthorization(asUrl, {
    metadata,
    clientInformation: client,
    redirectUrl: redirectUri,
    ...(scope === null ? {} : { scope }),
    state: input.state,
    resource,
  });
  return {
    authorizationUrl: authorizationUrl.toString(),
    pending: {
      target,
      meta: {
        issuer: metadata.issuer,
        authorizationServerUrl: asUrl,
        authorizationEndpoint: metadata.authorization_endpoint,
        tokenEndpoint: metadata.token_endpoint,
        tokenAuthMethods: metadata.token_endpoint_auth_methods_supported ?? [],
        resource: resource.href,
        redirectUri,
        scope,
      },
      metadata,
      client,
      codeVerifier,
      issRequired: issAdvertised,
    },
  };
}

export async function completeMcpConnectorOAuth(
  deps: McpConnectorDeps,
  teamId: string,
  pending: McpOAuthPending,
  input: { code: string; iss: string | undefined },
): Promise<string> {
  if (input.iss === undefined ? pending.issRequired : input.iss !== pending.meta.issuer)
    throw new McpOAuthError('issuer');
  let tokens: OAuthTokens;
  try {
    tokens = await exchangeAuthorization(pending.meta.authorizationServerUrl, {
      metadata: pending.metadata,
      clientInformation: pending.client,
      authorizationCode: input.code,
      codeVerifier: pending.codeVerifier,
      redirectUri: pending.meta.redirectUri,
      resource: new URL(pending.meta.resource),
      fetchFn: guardedOAuthFetch(deps),
    });
  } catch (err) {
    if (err instanceof InvalidClientError)
      forgetClient(
        deps,
        registrationKey(pending.meta.issuer, pending.meta.redirectUri),
        pending.client.client_id,
      );
    throw new McpOAuthError('exchange');
  }
  const meta = { ...pending.meta, scope: tokens.scope ?? pending.meta.scope };
  const oauthCipher = sealOAuth(deps, pending.client, tokens, null);
  const now = nowMs();
  const { target } = pending;
  let id: string;
  if (target.kind === 'new') {
    try {
      assertSlugFree(deps, teamId, target.slug);
    } catch {
      throw new McpOAuthError('conflict');
    }
    id = newRecordId();
    deps.db
      .insert(mcpConnector)
      .values({
        id,
        teamId,
        slug: target.slug,
        label: target.label,
        catalogId: target.catalogId,
        url: target.url,
        ...sealHeaders(deps, target.headers),
        authKind: 'oauth',
        oauthMeta: meta,
        oauthCipher,
        authRevision: 1,
        tokenGeneration: 1,
        ...UNCHECKED,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  } else {
    id = target.connectorId;
    const row = deps.db
      .select()
      .from(mcpConnector)
      .where(and(eq(mcpConnector.id, id), eq(mcpConnector.teamId, teamId)))
      .get();
    const changed =
      row !== undefined &&
      deps.db
        .update(mcpConnector)
        .set({
          oauthMeta: meta,
          oauthCipher,
          authRevision: target.authRevision + 1,
          tokenGeneration: sql`${mcpConnector.tokenGeneration} + 1`,
          ...UNCHECKED,
          updatedAt: Math.max(now, row.updatedAt + 1),
        })
        .where(
          and(
            eq(mcpConnector.id, id),
            eq(mcpConnector.authKind, 'oauth'),
            eq(mcpConnector.authRevision, target.authRevision),
          ),
        )
        .run().changes > 0;
    if (!changed) throw new McpOAuthError('conflict');
  }
  try {
    await checkMcpConnector(deps, teamId, id);
  } catch (err) {
    if (!(err instanceof HttpError)) throw err;
  }
  return id;
}

export function refreshMcpConnectorToken(
  deps: McpConnectorDeps,
  teamId: string,
  id: string,
): Promise<void> {
  const running = deps.oauthState.refreshes.get(id);
  if (running) return running;
  const run = runRefresh(deps, teamId, id).finally(() => deps.oauthState.refreshes.delete(id));
  deps.oauthState.refreshes.set(id, run);
  return run;
}

async function runRefresh(deps: McpConnectorDeps, teamId: string, id: string): Promise<void> {
  const row = connectorRow(deps, teamId, id);
  const secrets = openOAuth(deps, row);
  const meta = row.oauthMeta;
  if (row.authKind !== 'oauth' || secrets === null || meta === null) return;
  const unchanged = and(
    eq(mcpConnector.id, row.id),
    eq(mcpConnector.authRevision, row.authRevision),
    eq(mcpConnector.tokenGeneration, row.tokenGeneration),
  );
  if (secrets.refreshToken === null) {
    deps.db
      .update(mcpConnector)
      .set({ status: 'needs_auth', statusReason: 'expired', toolCount: null })
      .where(unchanged)
      .run();
    return;
  }
  let tokens: OAuthTokens;
  try {
    tokens = await refreshAuthorization(meta.authorizationServerUrl, {
      metadata: {
        issuer: meta.issuer,
        authorization_endpoint: meta.authorizationEndpoint,
        token_endpoint: meta.tokenEndpoint,
        response_types_supported: ['code'],
        token_endpoint_auth_methods_supported: meta.tokenAuthMethods,
      },
      clientInformation: secrets.client,
      refreshToken: secrets.refreshToken,
      resource: new URL(meta.resource),
      fetchFn: guardedOAuthFetch(deps),
    });
  } catch (err) {
    const rejected = err instanceof InvalidGrantError || err instanceof InvalidClientError;
    if (err instanceof InvalidClientError)
      forgetClient(deps, registrationKey(meta.issuer, meta.redirectUri), secrets.client.client_id);
    deps.db
      .update(mcpConnector)
      .set(
        rejected
          ? { status: 'needs_auth', statusReason: 'refresh_rejected', toolCount: null }
          : { status: 'error', statusReason: 'refresh_failed', toolCount: null },
      )
      .where(unchanged)
      .run();
    return;
  }
  deps.db
    .update(mcpConnector)
    .set({
      oauthCipher: sealOAuth(deps, secrets.client, tokens, secrets.refreshToken),
      tokenGeneration: row.tokenGeneration + 1,
      ...(row.statusReason === 'refresh_failed' ? { status: 'connected', statusReason: null } : {}),
    })
    .where(unchanged)
    .run();
}
