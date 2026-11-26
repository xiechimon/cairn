import type { ProviderApi, ProviderFailure } from '@cairn/shared';

const ANTHROPIC_VERSION = '2023-06-01';
const MAX_MODELS = 2000;

export type UpstreamModelList =
  | { ok: true; models: { id: string; name: string }[] }
  | { ok: false; failure: ProviderFailure; httpStatus: number | null };

export function failureForStatus(status: number): ProviderFailure {
  if (status === 401 || status === 403) return 'auth';
  if (status === 404) return 'not-found';
  if (status === 429) return 'rate-limit';
  return 'upstream';
}

function modelsUrl(baseUrl: string, api: ProviderApi): string {
  const root = baseUrl.replace(/(?<!\/)\/+$/, '');
  const url = /\/v\d+$/.test(root) ? `${root}/models` : `${root}/v1/models`;
  return api === 'anthropic-messages' ? `${url}?limit=1000` : url;
}

function authHeaders(input: {
  api: ProviderApi;
  authHeader: boolean;
  apiKey: string | null;
}): Record<string, string> {
  const headers: Record<string, string> =
    input.api === 'anthropic-messages' ? { 'anthropic-version': ANTHROPIC_VERSION } : {};
  if (input.apiKey === null) return headers;
  if (input.api === 'anthropic-messages' && !input.authHeader) {
    return { ...headers, 'x-api-key': input.apiKey };
  }
  return { ...headers, Authorization: `Bearer ${input.apiKey}` };
}

function parseModels(raw: unknown): { id: string; name: string }[] | null {
  const data =
    typeof raw === 'object' && raw !== null && 'data' in raw
      ? (raw as { data: unknown }).data
      : raw;
  if (!Array.isArray(data)) return null;
  const byId = new Map<string, string>();
  for (const item of data) {
    if (typeof item !== 'object' || item === null) continue;
    const { id, display_name: displayName, name } = item as Record<string, unknown>;
    if (typeof id !== 'string' || id.trim() === '' || byId.has(id)) continue;
    const label = [displayName, name].find((v) => typeof v === 'string' && v.trim() !== '');
    byId.set(id, typeof label === 'string' ? label : id);
  }
  return [...byId]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.id.localeCompare(b.id))
    .slice(0, MAX_MODELS);
}

export async function fetchUpstreamModels(input: {
  baseUrl: string;
  api: ProviderApi;
  authHeader: boolean;
  apiKey: string | null;
  fetch: typeof globalThis.fetch;
  timeoutMs: number;
}): Promise<UpstreamModelList> {
  const signal = AbortSignal.timeout(input.timeoutMs);
  let response: Response;
  try {
    response = await input.fetch(modelsUrl(input.baseUrl, input.api), {
      headers: { accept: 'application/json', ...authHeaders(input) },
      signal,
    });
  } catch {
    return { ok: false, failure: signal.aborted ? 'timeout' : 'network', httpStatus: null };
  }
  if (!response.ok) {
    return { ok: false, failure: failureForStatus(response.status), httpStatus: response.status };
  }
  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    return { ok: false, failure: signal.aborted ? 'timeout' : 'invalid', httpStatus: null };
  }
  const models = parseModels(raw);
  if (models === null) return { ok: false, failure: 'invalid', httpStatus: null };
  return { ok: true, models };
}

const ANTHROPIC_MODELS_URL = 'https://api.anthropic.com/v1/models';
const ANTHROPIC_OAUTH_BETA = 'oauth-2025-04-20';
const ANTHROPIC_PAGE_LIMIT = 1000;
const ANTHROPIC_MAX_PAGES = 5;

function parseAnthropicPage(
  raw: unknown,
): { models: { id: string; name: string }[]; nextAfter: string | null } | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { data, has_more: hasMore, last_id: lastId } = raw as Record<string, unknown>;
  if (!Array.isArray(data)) return null;
  const models: { id: string; name: string }[] = [];
  for (const item of data) {
    if (typeof item !== 'object' || item === null) continue;
    const { id, display_name: displayName } = item as Record<string, unknown>;
    if (typeof id !== 'string' || id.trim() === '') continue;
    models.push({
      id,
      name: typeof displayName === 'string' && displayName.trim() !== '' ? displayName : id,
    });
  }
  return {
    models,
    nextAfter: hasMore === true && typeof lastId === 'string' && lastId !== '' ? lastId : null,
  };
}

export async function fetchAnthropicOAuthModels(input: {
  oauthToken: string;
  fetch: typeof globalThis.fetch;
  timeoutMs: number;
}): Promise<UpstreamModelList> {
  const signal = AbortSignal.timeout(input.timeoutMs);
  const byId = new Map<string, { id: string; name: string }>();
  let after: string | null = null;
  for (let page = 0; page < ANTHROPIC_MAX_PAGES; page += 1) {
    const url = new URL(ANTHROPIC_MODELS_URL);
    url.searchParams.set('limit', String(ANTHROPIC_PAGE_LIMIT));
    if (after !== null) url.searchParams.set('after_id', after);
    let response: Response;
    try {
      response = await input.fetch(url, {
        headers: {
          accept: 'application/json',
          'anthropic-version': ANTHROPIC_VERSION,
          'anthropic-beta': ANTHROPIC_OAUTH_BETA,
          Authorization: `Bearer ${input.oauthToken}`,
        },
        signal,
      });
    } catch {
      return { ok: false, failure: signal.aborted ? 'timeout' : 'network', httpStatus: null };
    }
    if (!response.ok) {
      return { ok: false, failure: failureForStatus(response.status), httpStatus: response.status };
    }
    let parsed: ReturnType<typeof parseAnthropicPage>;
    try {
      parsed = parseAnthropicPage(await response.json());
    } catch {
      return { ok: false, failure: signal.aborted ? 'timeout' : 'invalid', httpStatus: null };
    }
    if (parsed === null) return { ok: false, failure: 'invalid', httpStatus: null };
    for (const model of parsed.models) {
      if (!byId.has(model.id) && byId.size < MAX_MODELS) byId.set(model.id, model);
    }
    if (parsed.nextAfter === null) break;
    after = parsed.nextAfter;
  }
  return { ok: true, models: [...byId.values()] };
}
