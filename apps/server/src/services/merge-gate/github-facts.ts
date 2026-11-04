import {
  EVIDENCE_PREFIX,
  HARNESS_REGRESSION_RESULT_NAME,
  MERGE_GATE_STATUS_CONTEXT,
  RECORDING_EXTENSION,
  RECORDING_MAX_BYTES,
} from '@cairn/shared/merge-gate';
import type { HarnessEvalAttempt } from '../harness-eval-coordinator.js';
import { compareFilesFromResponse } from './digest.js';
import { qualifyingEvidenceLinks } from './evidence-link.js';
import type { GateGithubPort, GateRaw, GateRawFailure } from './github-port.js';
import { harnessNeedFromInputs } from './harness-eval-judge.js';
import {
  type HarnessEvalCoordinatorPort,
  prepareHarnessEvalRouting,
} from './harness-eval-route.js';
import { touchesHarness } from './paths.js';
import {
  type GateCheckRun,
  type GateCompareCommit,
  type GateInputs,
  isFullSha,
} from './readiness.js';

const PER_PAGE = 100;
const COMPARE_PAGES = 10;
const RUN_PAGES = 10;
const STATUS_PAGES = 5;
const RULE_PAGES = 5;
const EVIDENCE_PROBES = 5;
const DIRECTORY_CAP = 1000;

export interface GateReadRequest {
  owner: string;
  repo: string;
  prNumber: number;
  ticketRef: string;
  now: number;
  harnessEval?: {
    coordinator: HarnessEvalCoordinatorPort;
    dispatchAuthorized: boolean;
  };
}

export interface GateReadCache {
  autonomyPause: Map<string, { at: number; paused: boolean }>;
  bodies: Map<string, { etag: string; body: unknown }>;
  present: Set<string>;
}

export const newGateReadCache = (): GateReadCache => ({
  bodies: new Map(),
  present: new Set(),
  autonomyPause: new Map(),
});

export interface GateEvidencePresence {
  sha: string;
  path: string;
  present: boolean | null;
}

export interface GateGithubFacts {
  pr: GateInputs['pr'];
  defaultBranch: string | null;
  checks: GateInputs['checks'];
  compare: GateInputs['compare'];
  evidence: GateEvidencePresence[];
  harnessEvalText: string | null;
  harnessEval: { attempt: HarnessEvalAttempt | null; now: number } | null;
  baseBehindBy: number | null;
  ownStatus: { state: string; description: string | null } | null | 'unreadable';
  rateLimited: { retryAt: number | null } | null;
  notes: string[];
}

export interface GateCompareRead {
  compare: GateInputs['compare'];
  behindBy: number | null;
  failure: GateRawFailure | null;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isCount = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const isId = (v: unknown): v is number => Number.isSafeInteger(v);
const isSha = (v: unknown): v is string => typeof v === 'string' && isFullSha(v);

interface Reader {
  port: GateGithubPort;
  cache: GateReadCache;
  now: number;
  limited: { retryAt: number | null } | null;
  failure: GateRawFailure | null;
}

type Read = { ok: true; body: unknown } | { ok: false; status: number | null };

async function send(r: Reader, request: () => Promise<GateRaw>): Promise<GateRaw | null> {
  if (r.limited !== null) return null;
  let res: GateRaw;
  try {
    res = await request();
  } catch {
    res = { kind: 'failed', failure: { kind: 'network' } };
  }
  if (res.kind === 'failed') {
    r.failure = res.failure;
    if (res.failure.kind === 'rate-limited') {
      const after = res.failure.retryAfterSeconds;
      r.limited = { retryAt: after !== null ? r.now + after * 1000 : res.failure.resetAt };
    }
  }
  return res;
}

async function readBody(
  r: Reader,
  key: string | null,
  reuse: (body: unknown) => boolean,
  request: (etag: string | null) => Promise<GateRaw>,
): Promise<Read> {
  const cached = key === null ? undefined : r.cache.bodies.get(key);
  const etag = cached !== undefined && reuse(cached.body) ? cached.etag : null;
  const res = await send(r, () => request(etag));
  if (res === null) return { ok: false, status: null };
  if (res.kind === 'not-modified') {
    return etag !== null && cached !== undefined
      ? { ok: true, body: cached.body }
      : { ok: false, status: null };
  }
  if (res.kind === 'failed') {
    return { ok: false, status: res.failure.kind === 'status' ? res.failure.status : null };
  }
  if (key !== null) {
    if (res.etag !== null) r.cache.bodies.set(key, { etag: res.etag, body: res.body });
    else r.cache.bodies.delete(key);
  }
  return { ok: true, body: res.body };
}

const always = () => true;

function projectPull(
  body: unknown,
  req: GateReadRequest,
): { pr: NonNullable<GateInputs['pr']>; defaultBranch: string | null } | string {
  if (!isObj(body)) return 'pull request response is not an object';
  if (body.number !== req.prNumber) return `pull request response is not #${req.prNumber}`;
  const { head, base } = body;
  if (body.state !== 'open' && body.state !== 'closed') return 'pull request state unreadable';
  if (typeof body.merged !== 'boolean' || typeof body.draft !== 'boolean') {
    return 'pull request merged/draft unreadable';
  }
  if (!isCount(body.changed_files)) return 'pull request changed_files unreadable';
  if (!isObj(head) || typeof head.sha !== 'string' || typeof head.ref !== 'string') {
    return 'pull request head unreadable';
  }
  if (head.repo !== null && !(isObj(head.repo) && typeof head.repo.full_name === 'string')) {
    return 'pull request head repository unreadable';
  }
  if (!isObj(base) || typeof base.ref !== 'string' || !isObj(base.repo)) {
    return 'pull request base unreadable';
  }
  const baseName = base.repo.full_name;
  if (typeof baseName !== 'string') return 'pull request base repository unreadable';
  if (baseName.toLowerCase() !== `${req.owner}/${req.repo}`.toLowerCase()) {
    return 'pull request base repository is not the project repository';
  }
  if (body.body !== null && typeof body.body !== 'string') return 'pull request body unreadable';
  return {
    pr: {
      state: body.state,
      merged: body.merged,
      draft: body.draft,
      mergeableState: typeof body.mergeable_state === 'string' ? body.mergeable_state : null,
      headSha: head.sha,
      baseRef: base.ref,
      baseRepoFullName: baseName,
      headRepoFullName: isObj(head.repo) ? (head.repo.full_name as string) : null,
      body: body.body ?? '',
      changedFiles: body.changed_files,
      baseBehindBy: null,
    },
    defaultBranch: typeof base.repo.default_branch === 'string' ? base.repo.default_branch : null,
  };
}

interface Binding {
  context: string;
  appId: number | null;
}

const binding = (context: unknown, appId: unknown): Binding | null =>
  typeof context === 'string' && context !== '' && (appId == null || isId(appId))
    ? { context, appId: appId ?? null }
    : null;

function projectBranch(body: unknown): { tip: string | null; classic: Binding[] | null } {
  if (!isObj(body)) return { tip: null, classic: null };
  const tip = isObj(body.commit) && isSha(body.commit.sha) ? body.commit.sha : null;
  if (body.protected === false) return { tip, classic: [] };
  if (body.protected !== true || !isObj(body.protection)) return { tip, classic: null };
  const rsc = body.protection.required_status_checks;
  if (rsc == null) return { tip, classic: [] };
  if (!isObj(rsc)) return { tip, classic: null };
  if (rsc.enforcement_level === 'off') return { tip, classic: [] };
  const list: unknown[] | null = Array.isArray(rsc.checks)
    ? rsc.checks.map((c) => (isObj(c) ? binding(c.context, c.app_id) : null))
    : Array.isArray(rsc.contexts)
      ? rsc.contexts.map((c) => binding(c, null))
      : null;
  if (list === null || list.some((b) => b === null)) return { tip, classic: null };
  return { tip, classic: list as Binding[] };
}

async function readRules(
  r: Reader,
  req: GateReadRequest,
  branch: string,
): Promise<Binding[] | null> {
  const out: Binding[] = [];
  for (let page = 1; page <= RULE_PAGES; page += 1) {
    const got = await readBody(
      r,
      page === 1 ? `rules:${req.owner}/${req.repo}:${branch}`.toLowerCase() : null,
      (b) => Array.isArray(b) && b.length < PER_PAGE,
      (etag) => r.port.branchRules(branch, { page, perPage: PER_PAGE, etag }),
    );
    if (!got.ok || !Array.isArray(got.body)) return null;
    for (const rule of got.body as unknown[]) {
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
    if (got.body.length < PER_PAGE) return out;
  }
  return null;
}

function commitsOf(v: unknown): GateCompareCommit[] | null {
  if (!Array.isArray(v)) return null;
  const out: GateCompareCommit[] = [];
  for (const c of v as unknown[]) {
    if (!isObj(c) || typeof c.sha !== 'string' || !Array.isArray(c.parents)) return null;
    const parents: string[] = [];
    for (const p of c.parents as unknown[]) {
      if (!isObj(p) || typeof p.sha !== 'string') return null;
      parents.push(p.sha);
    }
    out.push({ sha: c.sha, parents });
  }
  return out;
}

async function readCompare(r: Reader, baseSha: string, headSha: string): Promise<GateCompareRead> {
  r.failure = null;
  const unreadable = (): GateCompareRead => ({
    compare: 'unreadable',
    behindBy: null,
    failure: r.failure,
  });
  const malformed: GateCompareRead = { compare: 'malformed', behindBy: null, failure: null };
  if (!isSha(baseSha) || !isSha(headSha)) return unreadable();
  const page = (n: number) =>
    readBody(r, null, always, () =>
      r.port.compare(baseSha, headSha, { page: n, perPage: PER_PAGE }),
    );
  const first = await page(1);
  if (!first.ok) return unreadable();
  const body = first.body;
  if (!isObj(body)) return malformed;
  const files = compareFilesFromResponse(body);
  const total = body.total_commits;
  const commits = commitsOf(body.commits);
  if (files === null || !isCount(total) || commits === null) return malformed;
  for (let n = 2; commits.length < total && n <= COMPARE_PAGES; n += 1) {
    const next = await page(n);
    if (!next.ok) return unreadable();
    if (!isObj(next.body)) return malformed;
    if (next.body.total_commits !== total) return unreadable();
    const more = commitsOf(next.body.commits);
    if (more === null) return malformed;
    if (more.length === 0) break;
    commits.push(...more);
  }
  return {
    compare: { headSha, files, commits, totalCommits: total },
    behindBy: isCount(body.behind_by) ? body.behind_by : null,
    failure: null,
  };
}

export function readCompareAt(
  port: GateGithubPort,
  baseSha: string,
  headSha: string,
): Promise<GateCompareRead> {
  return readCompare(
    { port, cache: newGateReadCache(), now: 0, limited: null, failure: null },
    baseSha,
    headSha,
  );
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
  description: string | null;
  at: number;
}

function statusOf(v: unknown): StatusRow | null {
  if (!isObj(v)) return null;
  const { context, state, description } = v;
  const at = typeof v.updated_at === 'string' ? Date.parse(v.updated_at) : Number.NaN;
  if (typeof context !== 'string' || typeof state !== 'string' || !Number.isFinite(at)) return null;
  if (!(description === null || typeof description === 'string')) return null;
  return { context, state, description, at };
}

async function readPaged<T>(
  r: Reader,
  key: string,
  maxPages: number,
  field: string,
  parse: (v: unknown) => T | null,
  request: (page: number, etag: string | null) => Promise<GateRaw>,
  accept: (first: Obj, page: Obj) => boolean,
): Promise<{ rows: T[]; complete: boolean; first: Obj } | null> {
  const rows: T[] = [];
  let first: Obj | null = null;
  for (let page = 1; page <= maxPages; page += 1) {
    const got = await readBody(
      r,
      page === 1 ? key : null,
      (b) =>
        isObj(b) && Array.isArray(b[field]) && (b[field] as unknown[]).length === b.total_count,
      (etag) => request(page, etag),
    );
    if (!got.ok || !isObj(got.body) || !isCount(got.body.total_count)) return null;
    const list = got.body[field];
    if (!Array.isArray(list)) return null;
    first ??= got.body;
    if (!accept(first, got.body)) return null;
    if (got.body.total_count !== first.total_count) break;
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

type Listing = { kind: 'list'; entries: unknown[] } | { kind: 'absent' } | { kind: 'unknown' };

async function listDirectory(r: Reader, dir: string, sha: string): Promise<Listing> {
  const res = await send(r, () => r.port.contents(dir, sha));
  if (res === null || res.kind === 'not-modified') return { kind: 'unknown' };
  if (res.kind === 'failed') {
    return res.failure.kind === 'status' && res.failure.status === 404
      ? { kind: 'absent' }
      : { kind: 'unknown' };
  }
  return Array.isArray(res.body) ? { kind: 'list', entries: res.body } : { kind: 'unknown' };
}

function presentIn(listing: Listing, name: string, path: string): boolean | null {
  if (listing.kind === 'absent') return false;
  if (listing.kind === 'unknown') return null;
  const found = listing.entries.some(
    (e) => isObj(e) && e.type === 'file' && e.name === name && e.path === path,
  );
  if (found) {
    if (RECORDING_EXTENSION.test(path)) {
      const entry = listing.entries.find(
        (e) => isObj(e) && e.type === 'file' && e.name === name && e.path === path,
      );
      return (
        isObj(entry) && isCount(entry.size) && entry.size > 0 && entry.size <= RECORDING_MAX_BYTES
      );
    }
    return true;
  }
  return listing.entries.length >= DIRECTORY_CAP ? null : false;
}

async function probeEvidence(
  r: Reader,
  req: GateReadRequest,
  pr: NonNullable<GateInputs['pr']>,
  compare: Exclude<GateInputs['compare'], string>,
): Promise<GateEvidencePresence[]> {
  const links = qualifyingEvidenceLinks(
    pr.body,
    { owner: req.owner, repo: req.repo, ticketRef: req.ticketRef },
    compare,
  );
  const out: GateEvidencePresence[] = [];
  const listings = new Map<string, Listing>();
  const repoKey = `${req.owner}/${req.repo}`.toLowerCase();
  const recordingRequired = compare.files.some((f) => f.recordingRequired);
  for (const { sha, path } of links) {
    const memo = `${repoKey}@${sha}:${path}`;
    if (!RECORDING_EXTENSION.test(path) && r.cache.present.has(memo)) {
      out.push({ sha, path, present: true });
      if (!recordingRequired) break;
      continue;
    }
    const slash = path.lastIndexOf('/');
    const dir = path.slice(0, slash);
    const dirKey = `${sha}:${dir}`;
    let listing = listings.get(dirKey);
    if (listing === undefined) {
      if (listings.size >= EVIDENCE_PROBES) {
        out.push({ sha, path, present: null });
        continue;
      }
      listing = await listDirectory(r, dir, sha);
      listings.set(dirKey, listing);
    }
    const present = presentIn(listing, path.slice(slash + 1), path);
    out.push({ sha, path, present });
    if (present === true) {
      if (!RECORDING_EXTENSION.test(path)) r.cache.present.add(memo);
      if (!recordingRequired || RECORDING_EXTENSION.test(path)) break;
    }
  }
  return out;
}

export async function readGateGithubFacts(
  port: GateGithubPort,
  req: GateReadRequest,
  cache: GateReadCache,
): Promise<GateGithubFacts> {
  const r: Reader = { port, cache, now: req.now, limited: null, failure: null };
  const facts: GateGithubFacts = {
    pr: null,
    defaultBranch: null,
    checks: null,
    compare: 'unreadable',
    evidence: [],
    harnessEvalText: null,
    harnessEval: null,
    baseBehindBy: null,
    ownStatus: 'unreadable',
    rateLimited: null,
    notes: [],
  };
  const repoKey = `${req.owner}/${req.repo}`.toLowerCase();
  const done = () => ({ ...facts, rateLimited: r.limited });

  const pull = await readBody(r, `pull:${repoKey}#${req.prNumber}`, always, (etag) =>
    port.pull(req.prNumber, { etag }),
  );
  if (!pull.ok) {
    facts.notes.push('pull request unreadable');
    return done();
  }
  const projected = projectPull(pull.body, req);
  if (typeof projected === 'string') {
    facts.notes.push(projected);
    return done();
  }
  const pr = projected.pr;
  facts.pr = pr;
  facts.defaultBranch = projected.defaultBranch;
  if (!isSha(pr.headSha)) {
    facts.notes.push('pull request head SHA is not 40 lowercase hex; nothing read at the head');
    return done();
  }
  const head = pr.headSha;

  const branch = await readBody(r, `branch:${repoKey}:${pr.baseRef}`, always, (etag) =>
    port.branch(pr.baseRef, { etag }),
  );
  const projectedBranch = branch.ok ? projectBranch(branch.body) : { tip: null, classic: null };
  let bindings: Binding[] = [];
  let required: string[] | null = null;
  if (projectedBranch.classic !== null) {
    const rules = await readRules(r, req, pr.baseRef);
    if (rules !== null) {
      bindings = [...projectedBranch.classic, ...rules];
      required = [...new Set(bindings.map((b) => b.context))];
    }
  }
  if (required === null) facts.notes.push('required checks unreadable');

  if (projectedBranch.tip === null) {
    facts.notes.push('base branch tip unreadable; compare not read');
  } else {
    const c = await readCompare(r, projectedBranch.tip, head);
    facts.compare = c.compare;
    facts.baseBehindBy = c.behindBy;
    pr.baseBehindBy = c.behindBy;
  }

  const runs = await readPaged(
    r,
    `runs:${repoKey}@${head}`,
    RUN_PAGES,
    'check_runs',
    runOf,
    (page, etag) => port.checkRuns(head, { filter: 'latest', page, perPage: PER_PAGE, etag }),
    () => true,
  );
  const statuses = await readPaged(
    r,
    `status:${repoKey}@${head}`,
    STATUS_PAGES,
    'statuses',
    statusOf,
    (page, etag) => port.combinedStatus(head, { page, perPage: PER_PAGE, etag }),
    (first, page) => typeof page.sha === 'string' && page.sha === first.sha,
  );
  if (statuses !== null) {
    const picked = pickStatuses(statuses.rows);
    const own = picked.find((s) => s.context.toLowerCase() === MERGE_GATE_STATUS_CONTEXT);
    facts.ownStatus = !statuses.complete
      ? 'unreadable'
      : own === undefined
        ? null
        : { state: own.state, description: own.description };
    if (runs !== null) {
      facts.checks = {
        headSha: head,
        statusSha: statuses.first.sha as string,
        required,
        runs: pickRuns(runs.rows, bindings),
        statuses: picked.map((s) => ({ context: s.context, state: s.state })),
        complete: runs.complete && statuses.complete,
      };
    }
  }
  if (facts.checks === null) facts.notes.push('checks unreadable');

  if (typeof facts.compare !== 'string') {
    facts.evidence = await probeEvidence(r, req, pr, facts.compare);
    if (touchesHarness(facts.compare.files)) {
      const harnessPath = `${EVIDENCE_PREFIX}${req.ticketRef}/${HARNESS_REGRESSION_RESULT_NAME}`;
      const res = await send(r, () => r.port.contents(harnessPath, head));
      facts.harnessEvalText = null;
      if (
        res !== null &&
        res.kind === 'ok' &&
        isObj(res.body) &&
        res.body.type === 'file' &&
        typeof res.body.content === 'string' &&
        res.body.encoding === 'base64'
      ) {
        try {
          facts.harnessEvalText = Buffer.from(
            res.body.content.replace(/\s/g, ''),
            'base64',
          ).toString('utf8');
        } catch {
          facts.harnessEvalText = null;
        }
      }
    }
  }
  if (req.harnessEval !== undefined && typeof facts.compare !== 'string') {
    const { need, patchDigest } = harnessNeedFromInputs({
      compare: facts.compare,
      harnessEvalText: facts.harnessEvalText,
    });
    if (patchDigest !== null) {
      const routed = await prepareHarnessEvalRouting({
        coordinator: req.harnessEval.coordinator,
        repo: `${req.owner}/${req.repo}`,
        pr: req.prNumber,
        patchDigest,
        need,
        dispatchAuthorized: req.harnessEval.dispatchAuthorized,
        ticket: req.ticketRef,
        expectedHead: head,
      });
      facts.harnessEval = { attempt: routed.attempt, now: req.now };
    }
  }
  return done();
}
