import { COMPOSIO_API_KEY_SECRET, type SecretBox } from '@cairn/shared';
import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { secret } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { createSecret, deleteSecret, updateSecret } from './secrets.js';

export interface ComposioDeps {
  db: Db;
  box: SecretBox;
  fetch: typeof fetch;
  apiBase?: string;
  timeoutMs?: number;
}

const COMPOSIO_API_BASE = 'https://backend.composio.dev/api/v3.1';
const COMPOSIO_TIMEOUT_MS = 15_000;
const MAX_CATALOG_PAGES = 10;

export function readComposioKey(
  deps: Pick<ComposioDeps, 'db' | 'box'>,
  teamId: string,
): string | null {
  const row = deps.db
    .select({ valueCipher: secret.valueCipher })
    .from(secret)
    .where(
      and(
        eq(secret.teamId, teamId),
        eq(secret.name, COMPOSIO_API_KEY_SECRET),
        isNull(secret.projectId),
      ),
    )
    .get();
  if (row?.valueCipher == null) return null;
  return deps.box.open(row.valueCipher);
}

export function saveComposioKey(
  deps: Pick<ComposioDeps, 'db' | 'box'>,
  teamId: string,
  key: string,
): void {
  const row = deps.db
    .select({ id: secret.id })
    .from(secret)
    .where(
      and(
        eq(secret.teamId, teamId),
        eq(secret.name, COMPOSIO_API_KEY_SECRET),
        isNull(secret.projectId),
      ),
    )
    .get();
  if (row === undefined) {
    createSecret(deps, {
      teamId,
      name: COMPOSIO_API_KEY_SECRET,
      description: 'Composio API key for app connectors',
      value: key,
    });
    return;
  }
  updateSecret(deps, teamId, row.id, { value: key });
}

export function deleteComposioKey(deps: Pick<ComposioDeps, 'db' | 'box'>, teamId: string): boolean {
  const row = deps.db
    .select({ id: secret.id })
    .from(secret)
    .where(
      and(
        eq(secret.teamId, teamId),
        eq(secret.name, COMPOSIO_API_KEY_SECRET),
        isNull(secret.projectId),
      ),
    )
    .get();
  return row !== undefined && deleteSecret(deps, teamId, row.id);
}

async function callComposio(
  deps: ComposioDeps,
  teamId: string,
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body?: Record<string, unknown>,
  query?: Record<string, string>,
): Promise<unknown> {
  const key = readComposioKey(deps, teamId);
  if (key === null)
    throw new HttpError(400, 'no Composio API key is saved; add one under MCP servers');
  const base = deps.apiBase ?? COMPOSIO_API_BASE;
  const url = new URL(`${base}${path}`);
  for (const [name, value] of Object.entries(query ?? {})) url.searchParams.set(name, value);
  let response: Response;
  try {
    response = await deps.fetch(url, {
      method,
      redirect: 'manual',
      headers: {
        'x-api-key': key,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(deps.timeoutMs ?? COMPOSIO_TIMEOUT_MS),
    });
  } catch {
    throw new HttpError(502, 'Composio is unreachable');
  }
  if (!response.ok) {
    const detail = await response
      .json()
      .then((body: unknown) => {
        const message = (body as { error?: { message?: unknown }; message?: unknown })?.error
          ?.message;
        const plain = (body as { message?: unknown })?.message;
        const text = message ?? plain;
        return typeof text === 'string' && text.length <= 200 ? ` (${text})` : '';
      })
      .catch(() => '');
    if (response.status === 401 || response.status === 403)
      throw new HttpError(400, `Composio rejected the saved API key${detail}`);
    if (response.status === 404) throw new HttpError(404, `Composio object not found${detail}`);
    if (response.status === 429 || response.status >= 500)
      throw new HttpError(502, `Composio is unreachable${detail}`);
    throw new HttpError(502, `Composio answered http_${response.status}${detail}`);
  }
  return response.json();
}

export interface ComposioToolkit {
  slug: string;
  name: string;
  description: string | null;
  logoUrl: string | null;
  noAuth: boolean;
  toolsCount: number | null;
}

interface ComposioToolkitItem {
  slug?: unknown;
  name?: unknown;
  meta?: { description?: unknown; logo?: unknown; tools_count?: unknown };
  no_auth?: unknown;
  is_no_auth?: unknown;
  auth_schemes?: unknown;
}

function toolkitOf(item: ComposioToolkitItem): ComposioToolkit | null {
  if (typeof item.slug !== 'string' || typeof item.name !== 'string') return null;
  const meta = item.meta ?? {};
  return {
    slug: item.slug,
    name: item.name,
    description: typeof meta.description === 'string' ? meta.description : null,
    logoUrl: typeof meta.logo === 'string' ? meta.logo : null,
    noAuth:
      item.no_auth === true ||
      item.is_no_auth === true ||
      (Array.isArray(item.auth_schemes) && item.auth_schemes.length === 0),
    toolsCount: typeof meta.tools_count === 'number' ? meta.tools_count : null,
  };
}

interface ComposioPage {
  items?: unknown;
  next_cursor?: unknown;
}

function pageItems(page: ComposioPage): unknown[] {
  return Array.isArray(page.items) ? page.items : [];
}

export async function listComposioToolkits(
  deps: ComposioDeps,
  teamId: string,
): Promise<ComposioToolkit[]> {
  const toolkits: ComposioToolkit[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_CATALOG_PAGES; page += 1) {
    const result = (await callComposio(deps, teamId, 'GET', '/toolkits', undefined, {
      limit: '200',
      ...(cursor === undefined ? {} : { cursor }),
    })) as ComposioPage;
    for (const item of pageItems(result)) {
      const toolkit = toolkitOf(item as ComposioToolkitItem);
      if (toolkit !== null) toolkits.push(toolkit);
    }
    cursor = typeof result.next_cursor === 'string' ? result.next_cursor : undefined;
    if (cursor === undefined) break;
  }
  return toolkits;
}

export interface ComposioSession {
  sessionId: string;
  mcpUrl: string;
}

export async function createComposioSession(
  deps: ComposioDeps,
  teamId: string,
  toolkit: string,
): Promise<ComposioSession> {
  const result = (await callComposio(deps, teamId, 'POST', '/tool_router/session', {
    user_id: teamId,
    toolkits: { enable: [toolkit] },
    manage_connections: { enable: false },
    workbench: { enable: false },
    preload: { tools: 'all' },
    search: { enable: false },
    execute: { enable_multi_execute: false },
  })) as { session_id?: unknown; mcp?: { url?: unknown } };
  if (typeof result.session_id !== 'string' || typeof result.mcp?.url !== 'string')
    throw new HttpError(502, 'Composio answered without a session url');
  return { sessionId: result.session_id, mcpUrl: result.mcp.url };
}

export interface ComposioLink {
  redirectUrl: string;
  connectedAccountId: string;
}

export async function createComposioLink(
  deps: ComposioDeps,
  teamId: string,
  sessionId: string,
  toolkit: string,
): Promise<ComposioLink> {
  const result = (await callComposio(
    deps,
    teamId,
    'POST',
    `/tool_router/session/${encodeURIComponent(sessionId)}/link`,
    { toolkit },
  )) as { redirect_url?: unknown; connected_account_id?: unknown };
  if (typeof result.redirect_url !== 'string' || typeof result.connected_account_id !== 'string')
    throw new HttpError(502, 'Composio answered without a redirect url');
  return { redirectUrl: result.redirect_url, connectedAccountId: result.connected_account_id };
}

export type ComposioAccountStatus =
  | 'INITIALIZING'
  | 'INITIATED'
  | 'ACTIVE'
  | 'FAILED'
  | 'EXPIRED'
  | 'INACTIVE'
  | string;

export interface ComposioAccount {
  id: string;
  status: ComposioAccountStatus;
  statusReason: string | null;
  isDisabled: boolean;
}

function accountOf(item: unknown): ComposioAccount | null {
  const raw = item as {
    id?: unknown;
    nanoid?: unknown;
    status?: unknown;
    status_reason?: unknown;
    is_disabled?: unknown;
  };
  const id = typeof raw.id === 'string' ? raw.id : raw.nanoid;
  if (typeof id !== 'string' || typeof raw.status !== 'string') return null;
  return {
    id,
    status: raw.status,
    statusReason: typeof raw.status_reason === 'string' ? raw.status_reason : null,
    isDisabled: raw.is_disabled === true,
  };
}

export async function getComposioAccount(
  deps: ComposioDeps,
  teamId: string,
  accountId: string,
): Promise<ComposioAccount | null> {
  try {
    const result = await callComposio(
      deps,
      teamId,
      'GET',
      `/connected_accounts/${encodeURIComponent(accountId)}`,
    );
    return accountOf(result);
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) return null;
    throw err;
  }
}

export async function findActiveComposioAccount(
  deps: ComposioDeps,
  teamId: string,
  toolkit: string,
): Promise<string | null> {
  const result = (await callComposio(deps, teamId, 'GET', '/connected_accounts', undefined, {
    toolkit_slugs: toolkit,
    user_ids: teamId,
    statuses: 'ACTIVE',
    limit: '10',
  })) as ComposioPage;
  const account = pageItems(result)
    .map(accountOf)
    .find((item) => item !== null);
  return account?.id ?? null;
}

export async function revokeComposioAccount(
  deps: ComposioDeps,
  teamId: string,
  accountId: string,
): Promise<void> {
  try {
    await callComposio(
      deps,
      teamId,
      'DELETE',
      `/connected_accounts/${encodeURIComponent(accountId)}`,
    );
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) return;
    throw err;
  }
}
