import { lookup as dnsLookup } from 'node:dns/promises';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { dirname, join } from 'node:path';
import {
  type LocalToolDef,
  WEB_BRAVE_KEY_SECRET,
  WEB_EXA_KEY_SECRET,
  WEB_FETCH_TOOL_NAME,
  WEB_SEARCH_BUDGET_EXHAUSTED,
  WEB_SEARCH_TOOL_NAME,
  type WebProvider,
  type WebResult,
  type WebToolOutput,
} from '@cairn/shared';
import type { SecretVault, StepCredentials } from '../credentials.js';

export interface ProviderKeys {
  exa?: string;
  brave?: string;
}

export interface WebToolsOpts {
  keys: ProviderKeys;
  stepId: string;
  home: string;
  log: (line: string) => void;
  fetch?: typeof fetch;
  now?: () => Date;
  env?: Record<string, string | undefined>;
  lookup?: (host: string) => Promise<string[]>;
}

export interface PrepareWebToolsOpts extends Omit<WebToolsOpts, 'keys'> {
  enabled: boolean;
  creds: StepCredentials;
}

export interface PreparedWebTools {
  tools: LocalToolDef[];
  secretCreds: StepCredentials;
}

const DEFAULT_MONTHLY_CAP_USD = 20;
const CAP_ENV = 'CAIRN_WEB_SEARCH_MONTHLY_CAP_USD';
export const EXA_DEFAULT_BASE_URL = 'https://api.exa.ai';
export const EXA_BASE_URL_ENV = 'CAIRN_WEB_SEARCH_EXA_BASE_URL';
const LEDGER_FILE = 'web-search-spend.json';
const EXA_SEARCH_ESTIMATE_USD = 0.005;
const EXA_CONTENTS_ESTIMATE_USD = 0.001;
const BRAVE_SEARCH_ESTIMATE_USD = 0.005;
const SEARCH_RESULT_COUNT = 5;
const RESULT_TEXT_CHARS = 4_000;
const TOTAL_TEXT_CHARS = 20_000;
const FETCH_TIMEOUT_MS = 15_000;
const PROVIDER_TIMEOUT_MS = 30_000;
const FETCH_MAX_BYTES = 2_000_000;
const MAX_REDIRECTS = 5;
const QUERY_LOG_CHARS = 120;

class ProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

export function takeProviderKeys(vault: SecretVault): ProviderKeys {
  const exa = vault.take(WEB_EXA_KEY_SECRET);
  const brave = vault.take(WEB_BRAVE_KEY_SECRET);
  return {
    ...(exa !== null && exa !== '' ? { exa } : {}),
    ...(brave !== null && brave !== '' ? { brave } : {}),
  };
}

const HIDDEN_SECRETS: readonly string[] = [WEB_EXA_KEY_SECRET, WEB_BRAVE_KEY_SECRET];

function hideProviderKeys(vault: SecretVault): SecretVault {
  return {
    names: vault.names.filter((name) => !HIDDEN_SECRETS.includes(name)),
    take: (name) => (HIDDEN_SECRETS.includes(name) ? null : vault.take(name)),
  };
}

export function prepareWebTools(opts: PrepareWebToolsOpts): PreparedWebTools {
  if (!opts.enabled) return { tools: [], secretCreds: opts.creds };
  const { enabled: _enabled, creds, ...rest } = opts;
  const tools = buildWebTools({ ...rest, keys: takeProviderKeys(creds.secrets) });
  const secretCreds: StepCredentials = Object.create(creds, {
    secrets: { get: () => hideProviderKeys(creds.secrets), enumerable: true },
  });
  return { tools, secretCreds };
}

function redactor(keys: ProviderKeys): (text: string) => string {
  const values = [keys.exa, keys.brave].filter((k): k is string => k !== undefined);
  return (text) => values.reduce((out, key) => out.split(key).join('[redacted]'), text);
}

const spendQueues = new Map<string, Promise<unknown>>();

function monthKey(at: Date): string {
  return at.toISOString().slice(0, 7);
}

function readSpend(path: string, month: string): number {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null) return 0;
    const value = (parsed as Record<string, unknown>)[month];
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
  } catch {
    return 0;
  }
}

function addSpend(path: string, month: string, amount: number): Promise<unknown> {
  const run = (spendQueues.get(path) ?? Promise.resolve()).then(() => {
    const next = readSpend(path, month) + amount;
    const temp = `${path}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(temp, JSON.stringify({ [month]: next }));
    renameSync(temp, path);
  });
  const settled = run.catch(() => undefined);
  spendQueues.set(path, settled);
  return settled;
}

function capUsd(env: Record<string, string | undefined>): number {
  const raw = env[CAP_ENV];
  const parsed = raw === undefined ? Number.NaN : Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_MONTHLY_CAP_USD;
}

function ipv4Private(a: number, b: number): boolean {
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 192 && b === 0)
  );
}

function expandIpv6(address: string): number[] | null {
  let text = address.split('%')[0] ?? address;
  const tail = text.match(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (tail !== null) {
    const [, a, b, c, d] = tail.map(Number);
    text = `${text.slice(0, text.length - (tail[0]?.length ?? 0))}${(((a ?? 0) << 8) | (b ?? 0)).toString(16)}:${(((c ?? 0) << 8) | (d ?? 0)).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] === '' || halves[0] === undefined ? [] : halves[0].split(':');
  const rest = halves[1] === '' || halves[1] === undefined ? [] : halves[1].split(':');
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0;
  if (fill < 0) return null;
  const groups = [...head, ...Array<string>(fill).fill('0'), ...rest].map((g) =>
    Number.parseInt(g, 16),
  );
  return groups.length === 8 && groups.every((g) => Number.isFinite(g)) ? groups : null;
}

export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const [a = 0, b = 0] = address.split('.').map(Number);
    return ipv4Private(a, b);
  }
  if (family === 6) {
    const g = expandIpv6(address);
    if (g === null) return true;
    const embedded = (hi: number): boolean => ipv4Private(hi >> 8, hi & 0xff);
    const leadingZero = g.slice(0, 5).every((x) => x === 0);
    if (leadingZero && g[5] === 0xffff) return embedded(g[6] ?? 0);
    if (g.slice(0, 6).every((x) => x === 0))
      return embedded(g[6] ?? 0) || (g[6] === 0 && g[7] === 0);
    if (g[0] === 0x64 && g[1] === 0xff9b) return embedded(g[6] ?? 0);
    const first = g[0] ?? 0;
    return (
      (first & 0xffc0) === 0xfe80 || (first & 0xfe00) === 0xfc00 || (first & 0xff00) === 0xff00
    );
  }
  return true;
}

async function defaultLookup(host: string): Promise<string[]> {
  const records = await dnsLookup(host, { all: true });
  return records.map((r) => r.address);
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function htmlToText(source: string): { title: string; text: string } {
  const title = source.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '';
  const text = source
    .replace(/<(script|style|noscript|template)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]*>/g, ' ');
  return {
    title: decodeEntities(title).replace(/\s+/g, ' ').trim(),
    text: decodeEntities(text).replace(/\s+/g, ' ').trim(),
  };
}

function clipResults(results: WebResult[]): { results: WebResult[]; truncated: boolean } {
  let budget = TOTAL_TEXT_CHARS;
  let truncated = false;
  const clipped: WebResult[] = [];
  for (const result of results) {
    const limit = Math.min(RESULT_TEXT_CHARS, budget);
    if (result.text.length > limit) truncated = true;
    clipped.push({ ...result, text: result.text.slice(0, Math.max(limit, 0)) });
    budget -= Math.min(result.text.length, limit);
  }
  return { results: clipped, truncated };
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function arrayOf(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((v): v is Record<string, unknown> => typeof v === 'object' && v !== null)
    : [];
}

function reportedCost(body: Record<string, unknown>, estimate: number): number {
  const total = (body.costDollars as { total?: unknown } | undefined)?.total;
  return typeof total === 'number' && Number.isFinite(total) && total >= 0 ? total : estimate;
}

export function buildWebTools(opts: WebToolsOpts): LocalToolDef[] {
  const doFetch = opts.fetch ?? fetch;
  const now = opts.now ?? (() => new Date());
  const env = opts.env ?? process.env;
  const lookup = opts.lookup ?? defaultLookup;
  const redact = redactor(opts.keys);
  const ledgerPath = join(opts.home, LEDGER_FILE);
  const exaBaseUrl = (env[EXA_BASE_URL_ENV] ?? '') || EXA_DEFAULT_BASE_URL;

  const logCall = (tool: string, provider: string, count: number, cost: number, query: string) =>
    opts.log(
      redact(
        `web tool step=${opts.stepId} tool=${tool} provider=${provider} results=${count} cost=${cost} query=${JSON.stringify(query.slice(0, QUERY_LOG_CHARS))}`,
      ),
    );

  const budgetMessage = (): string | null => {
    const spent = readSpend(ledgerPath, monthKey(now()));
    const cap = capUsd(env);
    return spent >= cap
      ? `${WEB_SEARCH_BUDGET_EXHAUSTED} (spent $${spent.toFixed(4)} of $${cap.toFixed(2)} this month)`
      : null;
  };

  const request = async (url: string, init: RequestInit): Promise<Record<string, unknown>> => {
    let response: Response;
    try {
      response = await doFetch(url, { ...init, signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) });
    } catch (err) {
      throw new ProviderError(
        `request failed: ${err instanceof Error ? err.message : String(err)}`,
        true,
      );
    }
    if (!response.ok) {
      throw new ProviderError(`provider returned HTTP ${response.status}`, response.status >= 500);
    }
    try {
      return (await response.json()) as Record<string, unknown>;
    } catch {
      throw new ProviderError('provider returned an unreadable response', true);
    }
  };

  const exaHeaders = (key: string) => ({ 'content-type': 'application/json', 'x-api-key': key });

  const exaSearch = async (key: string, query: string) => {
    const body = await request(`${exaBaseUrl}/search`, {
      method: 'POST',
      headers: exaHeaders(key),
      body: JSON.stringify({
        query,
        numResults: SEARCH_RESULT_COUNT,
        contents: { text: { maxCharacters: RESULT_TEXT_CHARS } },
      }),
    });
    const fetchedAt = now().toISOString();
    return {
      results: arrayOf(body.results).map((r) => ({
        url: str(r.url),
        title: str(r.title),
        text: str(r.text),
        fetchedAt,
      })),
      cost: reportedCost(body, EXA_SEARCH_ESTIMATE_USD),
    };
  };

  const braveSearch = async (key: string, query: string) => {
    const url = new URL('https://api.search.brave.com/res/v1/web/search');
    url.searchParams.set('q', query);
    url.searchParams.set('count', String(SEARCH_RESULT_COUNT));
    const body = await request(url.toString(), {
      headers: { Accept: 'application/json', 'X-Subscription-Token': key },
    });
    const fetchedAt = now().toISOString();
    const web = (body.web ?? {}) as Record<string, unknown>;
    return {
      results: arrayOf(web.results).map((r) => ({
        url: str(r.url),
        title: decodeEntities(str(r.title).replace(/<[^>]*>/g, '')),
        text: decodeEntities(str(r.description).replace(/<[^>]*>/g, '')),
        fetchedAt,
      })),
      cost: BRAVE_SEARCH_ESTIMATE_USD,
    };
  };

  const exaContents = async (key: string, url: string) => {
    const body = await request(`${exaBaseUrl}/contents`, {
      method: 'POST',
      headers: exaHeaders(key),
      body: JSON.stringify({ urls: [url], text: { maxCharacters: TOTAL_TEXT_CHARS } }),
    });
    const fetchedAt = now().toISOString();
    return {
      results: arrayOf(body.results).map((r) => ({
        url: str(r.url) || url,
        title: str(r.title),
        text: str(r.text),
        fetchedAt,
      })),
      cost: reportedCost(body, EXA_CONTENTS_ESTIMATE_USD),
    };
  };

  const render = (provider: WebProvider, results: WebResult[], capped = false): string => {
    const clipped = clipResults(results);
    const output: WebToolOutput = {
      provider,
      results: clipped.results,
      truncated: clipped.truncated || capped,
    };
    return JSON.stringify(output);
  };

  const search = async (params: Record<string, unknown>): Promise<string> => {
    const query = typeof params.query === 'string' ? params.query.trim() : '';
    if (query === '') return 'web_search needs a non-empty "query".';
    const exhausted = budgetMessage();
    if (exhausted !== null) return exhausted;
    const attempts: { provider: 'exa' | 'brave'; run: () => ReturnType<typeof exaSearch> }[] = [];
    const { exa, brave } = opts.keys;
    if (exa !== undefined) attempts.push({ provider: 'exa', run: () => exaSearch(exa, query) });
    if (brave !== undefined) {
      attempts.push({ provider: 'brave', run: () => braveSearch(brave, query) });
    }
    let failure = 'no search provider is configured';
    for (const attempt of attempts) {
      try {
        const done = await attempt.run();
        await addSpend(ledgerPath, monthKey(now()), done.cost);
        logCall(WEB_SEARCH_TOOL_NAME, attempt.provider, done.results.length, done.cost, query);
        return render(attempt.provider, done.results);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        failure = `${attempt.provider}: ${message}`;
        logCall(WEB_SEARCH_TOOL_NAME, attempt.provider, 0, 0, query);
        if (!(err instanceof ProviderError && err.retryable)) break;
      }
    }
    return redact(`web_search failed (${failure}).`);
  };

  const refused = (reason: string): Error => new Error(`web_fetch refused: ${reason}`);

  const assertPublicHost = async (url: URL): Promise<void> => {
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw refused('only http and https URLs are allowed');
    }
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const addresses = isIP(host) !== 0 ? [host] : await lookup(host);
    if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
      throw refused('the host is not a public address');
    }
  };

  const readCapped = async (response: Response): Promise<{ body: string; capped: boolean }> => {
    const reader = response.body?.getReader();
    if (reader === undefined) return { body: '', capped: false };
    const decoder = new TextDecoder();
    let body = '';
    let bytes = 0;
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) return { body: body + decoder.decode(), capped: false };
      bytes += chunk.value.byteLength;
      body += decoder.decode(chunk.value, { stream: true });
      if (bytes >= FETCH_MAX_BYTES) {
        await reader.cancel();
        return { body, capped: true };
      }
    }
  };

  const plainGet = async (start: URL): Promise<string> => {
    let current = start;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      await assertPublicHost(current);
      const response = await doFetch(current.toString(), {
        redirect: 'manual',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { Accept: 'text/html,text/plain;q=0.9,*/*;q=0.5' },
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (location === null) throw new Error(`web_fetch failed: HTTP ${response.status}`);
        current = new URL(location, current);
        continue;
      }
      if (!response.ok) throw new Error(`web_fetch failed: HTTP ${response.status}`);
      const { body, capped } = await readCapped(response);
      const isHtml = (response.headers.get('content-type') ?? '').includes('html');
      const page = isHtml ? htmlToText(body) : { title: '', text: body.trim() };
      return render(
        'plain',
        [
          {
            url: current.toString(),
            title: page.title,
            text: page.text.slice(0, TOTAL_TEXT_CHARS + 1),
            fetchedAt: now().toISOString(),
          },
        ],
        capped,
      );
    }
    throw new Error('web_fetch failed: too many redirects');
  };

  const fetchPage = async (params: Record<string, unknown>): Promise<string> => {
    const raw = typeof params.url === 'string' ? params.url.trim() : '';
    if (raw === '') return 'web_fetch needs a non-empty "url".';
    let target: URL;
    try {
      target = new URL(raw);
    } catch {
      return 'web_fetch refused: not a valid URL.';
    }
    const exaKey = opts.keys.exa;
    if (exaKey !== undefined && budgetMessage() === null) {
      try {
        const done = await exaContents(exaKey, target.toString());
        await addSpend(ledgerPath, monthKey(now()), done.cost);
        logCall(WEB_FETCH_TOOL_NAME, 'exa', done.results.length, done.cost, target.toString());
        if (done.results.length > 0) return render('exa', done.results);
      } catch {
        logCall(WEB_FETCH_TOOL_NAME, 'exa', 0, 0, target.toString());
      }
    }
    try {
      const out = await plainGet(target);
      logCall(WEB_FETCH_TOOL_NAME, 'plain', 1, 0, target.toString());
      return out;
    } catch (err) {
      logCall(WEB_FETCH_TOOL_NAME, 'plain', 0, 0, target.toString());
      return redact(err instanceof Error ? err.message : String(err));
    }
  };

  const searchTool: LocalToolDef = {
    name: WEB_SEARCH_TOOL_NAME,
    label: WEB_SEARCH_TOOL_NAME,
    description:
      'Search the web. Returns a few results, each with URL, title, text excerpt and the ' +
      'fetch date. Metered: calls stop when the monthly search budget is used up.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: 'What to search for.' } },
      required: ['query'],
    },
    execute: search,
  };

  const fetchTool: LocalToolDef = {
    name: WEB_FETCH_TOOL_NAME,
    label: WEB_FETCH_TOOL_NAME,
    description:
      'Fetch one public http(s) page and return its text, clipped, with the fetch date. ' +
      'Private, loopback and link-local hosts are refused.',
    parameters: {
      type: 'object',
      properties: { url: { type: 'string', description: 'Absolute http(s) URL.' } },
      required: ['url'],
    },
    execute: fetchPage,
  };

  return opts.keys.exa !== undefined || opts.keys.brave !== undefined
    ? [searchTool, fetchTool]
    : [fetchTool];
}
