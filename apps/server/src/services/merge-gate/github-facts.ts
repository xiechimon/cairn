// 合并就绪闸的 GitHub 外壳（#1404 S4b，计划 docs/verify/1404/s4-plan.md §4.3–§4.5）：经注入的
// 端口读 GitHub，把应答变成 GateInputs 里 GitHub 那一半（pr、repo.defaultBranch、checks、
// compare、evidence），照 readiness.ts 里 GateInputs 的外壳契约（#1479）：
// - 先读 PR；它不说自己是这张 PR（号或目标仓不对）、字段缺或类型不对，pr = null，其余不读。
//   head 不是 40 位小写 SHA，PR 照报，按 head 读的都不读（没有 SHA 可按，不拿分支名代替）。
// - 目标分支：头提交（compare 的 base）与分支保护的必需检查；再读规则集的必需检查，两份
//   合起来。哪一份读不到，必需清单就是 null（不是 []）。
// - compare 按 SHA 读 {目标分支头}...{PR head}，每页同一对 SHA、不发条件读；files 只取第 1
//   页；commits 照读到的原样传（不去重、不排序）；各页的 total_commits 要一致。
// - check runs 与 combined status 都按 PR head 的 SHA 读；check run 按 (app, 名字) 只留 id 最大
//   的一条，必需检查绑了 app 的，那个 app 的那条排在前面（readiness 按名字取第一条）；status
//   按 context（不分大小写）只留最新的一条，自家 cairn/merge-gate 那条另给状态写入用。
// - 证据链：合格的链接（qualifyingEvidenceLinks）逐条按 contents 列它所在的目录，看文件在那个
//   提交上在不在；一个在就停，至多探 5 个 (提交, 目录)。
// 读全部串行；任何一次读被限流，本次求值停读，余下的按读不到处理。端口抛错按网络错。
// 不读库、不取时钟（now 由调用方给）、不 import 闸外的东西（测试 merge-gate-imports）。

import {
  EVIDENCE_PREFIX,
  HARNESS_REGRESSION_RESULT_NAME,
  MERGE_GATE_STATUS_CONTEXT,
} from '@cairn/shared/merge-gate';
import { compareFilesFromResponse } from './digest.js';
import { qualifyingEvidenceLinks } from './evidence-link.js';
import type { GateGithubPort, GateRaw, GateRawFailure } from './github-port.js';
import { touchesHarness } from './paths.js';
import {
  type GateCheckRun,
  type GateCompareCommit,
  type GateInputs,
  isFullSha,
} from './readiness.js';

const PER_PAGE = 100;
/** 每样分页读的页数上限：compare 1,000 个提交、check runs 1,000 条、status 500 个 context、
 * 规则集 500 条。到了上限还没读全 = 没读全。 */
const COMPARE_PAGES = 10;
const RUN_PAGES = 10;
const STATUS_PAGES = 5;
const RULE_PAGES = 5;
/** 每次求值至多探几个 (提交, 目录)。 */
const EVIDENCE_PROBES = 5;
/** contents 列目录的上限（GitHub 文档：目录至多给 1,000 个文件）。 */
const DIRECTORY_CAP = 1000;

export interface GateReadRequest {
  owner: string;
  repo: string;
  prNumber: number;
  ticketRef: string;
  /** 毫秒时间戳，只用来换算 retry-after。 */
  now: number;
}

/** 调用方持有、跨求值复用的缓存：bodies = 条件读的上次应答（etag 与原样的应答体；304 时拿
 * 原样的体重新投影，投影本身不缓存）；present = 已查到存在的 (仓库, 提交, 路径)（提交里的
 * 文件不会变，只记存在，不记不存在）。 */
export interface GateReadCache {
  bodies: Map<string, { etag: string; body: unknown }>;
  present: Set<string>;
}

export const newGateReadCache = (): GateReadCache => ({ bodies: new Map(), present: new Set() });

export interface GateEvidencePresence {
  sha: string;
  path: string;
  present: boolean | null;
}

export interface GateGithubFacts {
  pr: GateInputs['pr'];
  /** → GateInputs.repo.defaultBranch。 */
  defaultBranch: string | null;
  checks: GateInputs['checks'];
  compare: GateInputs['compare'];
  evidence: GateEvidencePresence[];
  harnessEvalText: string | null;
  /** compare 的 behind_by（目标分支领先 PR 几个提交）；P4-0 的 GateInputs.pr.baseBehindBy。 */
  baseBehindBy: number | null;
  /** head 上自家 cairn/merge-gate 的当前值（状态写入只在值变化时写）；没有 = null，
   * combined status 读不到 = 'unreadable'。 */
  ownStatus: { state: string; description: string | null } | null | 'unreadable';
  /** 本次求值被限流：retryAt = 可再读的时刻（retry-after 优先，否则 x-ratelimit-reset）。 */
  rateLimited: { retryAt: number | null } | null;
  /** 哪样读不到、为什么（日志用，不进 GateInputs）。 */
  notes: string[];
}

export interface GateCompareRead {
  compare: GateInputs['compare'];
  behindBy: number | null;
  /** 读不到时最后的那个失败；读到了（哪怕形状不对）= null。 */
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

/** 发一个请求：已被限流就不发（null）；端口抛错按网络错；限流记下可再读的时刻。 */
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

/** 读一个应答体。key 非 null = 条件读：缓存里有、且 reuse(上次的体) 为真时发 etag，304 拿缓存的
 * 原样体；应答带 etag 才进缓存。 */
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

// —— PR ——

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

// —— 目标分支与必需检查 ——

interface Binding {
  context: string;
  appId: number | null;
}

const binding = (context: unknown, appId: unknown): Binding | null =>
  typeof context === 'string' && context !== '' && (appId == null || isId(appId))
    ? { context, appId: appId ?? null }
    : null;

/** 分支应答 → 头提交与分支保护的必需检查。protected 为 false = 没有；为 true 却没有
 * protection 对象 = 读不到（null）。 */
function projectBranch(body: unknown): { tip: string | null; classic: Binding[] | null } {
  if (!isObj(body)) return { tip: null, classic: null };
  const tip = isObj(body.commit) && isSha(body.commit.sha) ? body.commit.sha : null;
  if (body.protected === false) return { tip, classic: [] };
  if (body.protected !== true || !isObj(body.protection)) return { tip, classic: null };
  const rsc = body.protection.required_status_checks;
  if (rsc == null) return { tip, classic: [] };
  if (!isObj(rsc)) return { tip, classic: null };
  // enforcement_level off：GitHub 不要求这些检查，闸也不要求（code review 第 7 条）。
  if (rsc.enforcement_level === 'off') return { tip, classic: [] };
  const list: unknown[] | null = Array.isArray(rsc.checks)
    ? rsc.checks.map((c) => (isObj(c) ? binding(c.context, c.app_id) : null))
    : Array.isArray(rsc.contexts)
      ? rsc.contexts.map((c) => binding(c, null))
      : null;
  if (list === null || list.some((b) => b === null)) return { tip, classic: null };
  return { tip, classic: list as Binding[] };
}

/** 规则集里 required_status_checks 规则的必需检查（逐页读到不满一页为止）；读不到、形状不对
 * 或到了页数上限 = null。 */
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

// —— compare ——

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
  // failure 只报 compare 自己的请求（共用的 Reader 上可能还留着别的读的失败）。
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

/** compare {baseSha}...{headSha}（S5a 按判定自报的 head 现算摘要用）。 */
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

// —— head 上的检查 ——

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

/** 分页读一个列表（check runs 或 statuses）：读到 total_count 条、或一页为空、或到页数上限。
 * 第 1 页只在上次的第 1 页就是全部时才发 etag。complete = 读够了第 1 页说的条数（某页的
 * total_count 与第 1 页不同时就停，条数到不了）。
 * 任何一条形状不对、或 accept(第 1 页的体, 这一页的体) 为假 = null。 */
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
    // 各页的 total_count 不一致 = 不是同一次读：停下，条数对不上就不算读全。
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

/** (app, 名字) 去重留 id 最大的一条，保持首次出现的位置；必需检查绑了 app 的排前面。 */
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

/** context 不分大小写去重（GitHub：context 不分大小写），留 updated_at 最新的一条；时刻相同时
 * 留不是 success 的那条。保持首次出现的位置。 */
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

// —— 证据链 ——

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
  if (found) return true;
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
  for (const { sha, path } of links) {
    const memo = `${repoKey}@${sha}:${path}`;
    if (r.cache.present.has(memo)) {
      out.push({ sha, path, present: true });
      break;
    }
    const slash = path.lastIndexOf('/');
    const dir = path.slice(0, slash);
    const dirKey = `${sha}:${dir}`;
    let listing = listings.get(dirKey);
    if (listing === undefined) {
      // 探测数到了上限：余下的链接记为读不到（null），不当成不存在（code review 第 4 条）。
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
      r.cache.present.add(memo);
      break;
    }
  }
  return out;
}

// —— 求值 ——

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

  // 条件读的缓存键带 head 的 SHA：推送之后旧 head 的 ETag 不会拿去问新 head 的 URL（#1525 pr-gate
  // 第 1 轮建议 2）。
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
    // 没读全时自家 status 可能在没读的那页：按读不到算，状态写入不盲写（code review 第 2 条）。
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
  return done();
}
