import type { GateGithubPort, GateRaw, GateRawFailure } from './github-port.js';
import { RULESETS_NOT_ON_PLAN } from './github-rules.js';
import { type GateCheckRun, isFullSha, type RequiredChecks } from './readiness.js';

const PER_PAGE = 100;
const RUN_PAGES = 10;
const STATUS_PAGES = 5;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isCount = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const isId = (v: unknown): v is number => Number.isSafeInteger(v);

interface Reader {
  port: GateGithubPort;
  failure: GateRawFailure | null;
}

async function readBody(r: Reader, request: () => Promise<GateRaw>): Promise<unknown> {
  if (r.failure?.kind === 'rate-limited') return null;
  let result: GateRaw;
  try {
    result = await request();
  } catch {
    result = { kind: 'failed', failure: { kind: 'network' } };
  }
  if (result.kind === 'failed') r.failure = result.failure;
  return result.kind === 'ok' ? result.body : null;
}

interface Binding {
  context: string;
  appId: number | null;
}

const binding = (context: unknown, appId: unknown): Binding | null =>
  typeof context === 'string' && context !== '' && (appId == null || isId(appId))
    ? { context, appId: appId ?? null }
    : null;

function classicBindings(body: unknown): Binding[] | null {
  if (!isObj(body)) return null;
  if (body.protected === false) return [];
  if (body.protected !== true || !isObj(body.protection)) return null;
  const rsc = body.protection.required_status_checks;
  if (rsc == null) return [];
  if (!isObj(rsc)) return null;
  if (rsc.enforcement_level === 'off') return [];
  const list: unknown[] | null = Array.isArray(rsc.checks)
    ? rsc.checks.map((c) => (isObj(c) ? binding(c.context, c.app_id) : null))
    : Array.isArray(rsc.contexts)
      ? rsc.contexts.map((c) => binding(c, null))
      : null;
  if (list === null || list.some((b) => b === null)) return null;
  return list as Binding[];
}

async function readRules(r: Reader, branch: string): Promise<Binding[] | null> {
  const out: Binding[] = [];
  for (let page = 1; ; page += 1) {
    const body = await readBody(r, () =>
      r.port.branchRules(branch, { page, perPage: PER_PAGE, etag: null }),
    );
    if (body === null) {
      const failure = r.failure;
      if (
        page === 1 &&
        failure?.kind === 'status' &&
        (failure.status === 404 ||
          (failure.status === 403 && RULESETS_NOT_ON_PLAN.test(failure.message ?? '')))
      ) {
        return [];
      }
      return null;
    }
    if (!Array.isArray(body)) return null;
    for (const rule of body as unknown[]) {
      if (!isObj(rule) || typeof rule.type !== 'string') return null;
      if (rule.type !== 'required_status_checks') continue;
      const list = isObj(rule.parameters) ? rule.parameters.required_status_checks : undefined;
      if (!Array.isArray(list)) return null;
      for (const c of list as unknown[]) {
        const b = isObj(c) ? binding(c.context, c.integration_id) : null;
        if (b === null) return null;
        out.push(b);
      }
    }
    if (body.length < PER_PAGE) return out;
  }
}

interface RunRow {
  id: number;
  appId: number | null;
  run: GateCheckRun;
}

function runOf(v: unknown): RunRow | null {
  if (!isObj(v)) return null;
  const { id, name, status, head_sha: headSha, conclusion, app } = v;
  if (!isId(id) || typeof name !== 'string' || typeof status !== 'string') return null;
  if (typeof headSha !== 'string' || !(conclusion === null || typeof conclusion === 'string')) {
    return null;
  }
  if (!(app === null || (isObj(app) && isId(app.id)))) return null;
  return {
    id,
    appId: isObj(app) ? (app.id as number) : null,
    run: { name, headSha, status, conclusion },
  };
}

interface StatusRow {
  context: string;
  state: string;
  at: number;
}

function statusOf(v: unknown): StatusRow | null {
  if (!isObj(v)) return null;
  const { context, state, description } = v;
  const at = typeof v.updated_at === 'string' ? Date.parse(v.updated_at) : Number.NaN;
  if (typeof context !== 'string' || typeof state !== 'string' || !Number.isFinite(at)) return null;
  if (!(description === null || typeof description === 'string')) return null;
  return { context, state, at };
}

async function readPaged<T>(
  r: Reader,
  maxPages: number,
  field: string,
  parse: (v: unknown) => T | null,
  request: (page: number) => Promise<GateRaw>,
  accept: (first: Obj, page: Obj) => boolean,
): Promise<{ rows: T[]; complete: boolean; first: Obj } | null> {
  const rows: T[] = [];
  let first: Obj | null = null;
  for (let page = 1; page <= maxPages; page += 1) {
    const body = await readBody(r, () => request(page));
    if (!isObj(body) || !isCount(body.total_count)) return null;
    const list = body[field];
    if (!Array.isArray(list)) return null;
    first ??= body;
    if (!accept(first, body)) return null;
    if (body.total_count !== first.total_count) break;
    for (const v of list as unknown[]) {
      const row = parse(v);
      if (row === null) return null;
      rows.push(row);
    }
    if (list.length === 0 || rows.length >= (first.total_count as number)) break;
  }
  if (first === null) return null;
  return { rows, complete: rows.length === first.total_count, first };
}

function pickRuns(rows: RunRow[], bound: Binding[]): GateCheckRun[] {
  const key = (appId: number | null, name: string) => JSON.stringify([appId, name]);
  const latest = new Map<string, RunRow>();
  for (const row of rows) {
    const k = key(row.appId, row.run.name);
    const seen = latest.get(k);
    if (seen === undefined || row.id > seen.id) latest.set(k, row);
  }
  const boundKeys = new Set(
    bound.filter((b) => b.appId !== null).map((b) => key(b.appId, b.context)),
  );
  const picked = [...latest.entries()];
  return [
    ...picked.filter(([k]) => boundKeys.has(k)),
    ...picked.filter(([k]) => !boundKeys.has(k)),
  ].map(([, row]) => row.run);
}

function pickStatuses(rows: StatusRow[]): StatusRow[] {
  const latest = new Map<string, StatusRow>();
  for (const row of rows) {
    const k = row.context.toLowerCase();
    const seen = latest.get(k);
    if (
      seen === undefined ||
      row.at > seen.at ||
      (row.at === seen.at && seen.state === 'success' && row.state !== 'success')
    ) {
      latest.set(k, row);
    }
  }
  return [...latest.values()];
}

export async function readRequiredChecksAt(
  port: GateGithubPort,
  branchName: string,
  head: string,
): Promise<RequiredChecks | null> {
  if (!isFullSha(head)) return null;
  const r: Reader = { port, failure: null };
  const branch = await readBody(r, () => port.branch(branchName, { etag: null }));
  const classic = classicBindings(branch);
  const rules = classic === null ? null : await readRules(r, branchName);
  const bindings = [...(classic ?? []), ...(rules ?? [])];
  const required =
    classic === null || rules === null ? null : [...new Set(bindings.map((b) => b.context))];
  const runs = await readPaged(
    r,
    RUN_PAGES,
    'check_runs',
    runOf,
    (page) => port.checkRuns(head, { filter: 'latest', page, perPage: PER_PAGE, etag: null }),
    () => true,
  );
  const statuses = await readPaged(
    r,
    STATUS_PAGES,
    'statuses',
    statusOf,
    (page) => port.combinedStatus(head, { page, perPage: PER_PAGE, etag: null }),
    (first, page) => typeof page.sha === 'string' && page.sha === first.sha,
  );
  if (runs === null || statuses === null) return null;
  return {
    headSha: head,
    statusSha: statuses.first.sha as string,
    required,
    runs: pickRuns(runs.rows, bindings),
    statuses: pickStatuses(statuses.rows).map((s) => ({ context: s.context, state: s.state })),
    complete: runs.complete && statuses.complete,
  };
}
