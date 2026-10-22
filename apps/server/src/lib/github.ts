// GitHub 出站薄桥（#231 OAuth token 交换面 + spec 12/#359 repo picker 认证
// 面）——server 唯一 github.com 出站消费位（对照既有缝：lib/git.ts = 系统
// git spawn 桥、services/mcp-face.ts = MCP sdk 桥）；业务语义（OAuth state
// 与建行）归 services/oauth.ts，本模块只做 HTTP + 错误映射。
//
// 认证 API 面（spec 12 / #359 repo picker 代理 + #446 issue 读面）：
// - GET api.github.com/user/repos → 连接用户仓库列表（Authorization: Bearer
//   <github_connection token>——token 只进头不进 URL，错误 message 只带 URL）
// - GET repos/{o}/{r}/issues(/n) + labels → issue 列表/单条/label 集（#446
//   读向，token 纪律同上位）
// - GET repos/{o}/{r} → #1242 local→github 转换面可达性判定（token 纪律
//   同上位；匿名梯 = 无连接时公开仓可达）
// - 合并就绪闸的原样读（#1404 S4a：PR、分支、规则集、compare、check runs、
//   combined status、contents；应答原样交回，清单见「合并就绪闸的 GitHub 传输」一节）
// 写面（#452 / ADR 0006，#1404 / ADR 0021——server 的 api.github.com 写入点，穷举律：
// grep `api.github.com` 的 POST/PATCH 只此三处；不改 scope（commit status 在团队连接
// 已有的 `repo` scope 内）、不新增凭证面）：
// - POST repos/{o}/{r}/issues → 自派任务建时建 issue（关键路径之外触发）
// - PATCH repos/{o}/{r}/issues/{n} → agent 回填标题写进 issue
// - POST repos/{o}/{r}/statuses/{sha} → 合并就绪闸的 commit status `pacman/merge-gate`
//   （githubCreateCommitStatus；S4a 只有传输，调用方是 S7，`human` 策略下不写）
// OAuth 面（#231 握手）：
// - POST github.com/login/oauth/access_token（form-encoded：client_id/
//   client_secret/code/redirect_uri，Accept: json）→ access_token
// （旧 #223 skills GitHub 扫描面已随 spec 13 #367 退役——技能改本地目录
// 现扫，repo info/tree/raw 三函数一并出账。）
// 代理注记：Node fetch 默认不吃 http_proxy/https_proxy 环境变量——部署面需
// 代理出站时以 `NODE_USE_ENV_PROXY=1` 启动 server（Node ≥24.5）。

import { HttpError } from './errors.js';

/** fetch 结构子集（测试注入 mock；globalThis.fetch 天然满足）。method/body
 * 位 = #231 OAuth form POST 所需。 */
export type FetchLike = (
  input: string | URL,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

/** 单请求超时 [设计]（token 交换外挂起不拖死 callback 回跳）。 */
const FETCH_TIMEOUT_MS = 15_000;

const API_HEADERS = {
  accept: 'application/vnd.github+json',
  'x-github-api-version': '2022-11-28',
  // GitHub 要求 UA；品牌串不引 shared（lib 层零依赖纪律），字面量即可。
  'user-agent': 'pacman-server',
} as const;

// OAuth form POST 的 UA（与 API_HEADERS 字面量同值；form 面只吃 accept/
// content-type/user-agent，不挂 REST 版本头）。
const USER_AGENT = 'pacman-server';

/** 出站错误 → HttpError 单点映射（映射表见文件头注释）。headers 参数 =
 * 认证面扩展位（Authorization 头；错误路径只消费 url，token 永不进 message）。
 * 带响应头读出位（#446 issue 列表的 Link rel="next" 分页判定）。 */
async function readJsonFull(
  fetchImpl: FetchLike,
  url: string,
  headers: Record<string, string> = API_HEADERS,
): Promise<{ data: unknown; getHeader: (name: string) => string | null }> {
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await fetchImpl(url, {
      headers,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    throw mapFetchThrow(url, err);
  }
  if (!res.ok) throw mapUpstreamStatus(url, res);
  try {
    return { data: await res.json(), getHeader: (name) => res.headers.get(name) };
  } catch {
    throw new HttpError(502, `github response not json: ${url}`);
  }
}

async function readJson(
  fetchImpl: FetchLike,
  url: string,
  headers: Record<string, string> = API_HEADERS,
): Promise<unknown> {
  return (await readJsonFull(fetchImpl, url, headers)).data;
}

/** PR 状态探测结果（#931 restart 复用判定的 merged/closed 面）：
 * state = GitHub PR `state` 字段（open/closed）；merged = `merged` 布尔。 */
export interface GithubPullState {
  state: 'open' | 'closed';
  merged: boolean;
}

/** 单条 PR 状态只读探测（#931）：GET /repos/{o}/{r}/pulls/{n}。null = 未知
 * （网络/404/限流/响应形坏不区分——「查不到」不构成新分支的依据，fail-open
 * 语义归调用方）。token 可空（匿名梯，公开仓可达；私仓 404 = 未知）。单次
 * 尝试、不重试——上界缺省 FETCH_TIMEOUT_MS；claim 长轮询热路径（#1217 守卫
 * 探测）传更短的超时（daemon 侧 REQUEST_TIMEOUT_MS = HOLD_MS + 15s，一次
 * 5s 探测仍在预算内），readJsonFull 的 HttpError 映射在这里收敛为 null（探测
 * 是判定的辅助面，不是用户请求的主错误面）。 */
export async function githubPullState(
  fetchImpl: FetchLike,
  token: string | null,
  owner: string,
  repo: string,
  prNumber: number,
  timeoutMs: number = FETCH_TIMEOUT_MS,
): Promise<GithubPullState | null> {
  const page = await githubPull(fetchImpl, token, owner, repo, prNumber, { timeoutMs });
  return page?.pull ? { state: page.pull.state, merged: page.pull.merged } : null;
}

const FULL_SHA = /^[0-9a-f]{40}$/;

/** 40 位小写十六进制的提交 SHA（compare 只拿这种拼 URL）。 */
export function isFullSha(value: string): boolean {
  return FULL_SHA.test(value);
}

/** PR 对账读（#1403）：githubPullState 的两个字段 + 合并提交 SHA、合并者、head
 * SHA、head 分支与所在仓的 id、base 分支、base 仓的 id 与默认分支。 */
export interface GithubPull extends GithubPullState {
  /** merged 时 = squash/merge 落在 base 上的提交；未合并恒 null。 */
  mergeCommitSha: string | null;
  /** merged 时合并者的 login；未合并或响应缺失 = null。 */
  mergedBy: string | null;
  /** PR head 分支当前的提交（合并后 = 合并时的 head）；响应缺失 = null。 */
  headSha: string | null;
  /** PR head 的分支名（head.ref）；响应缺失 = null。 */
  headRef: string | null;
  /** head 所在仓的仓库 id（head.repo.id）：fork 被删时 GitHub 给 head.repo = null，这里
   * 同样是 null。仓库 id 不随改名或转移变。 */
  headRepoId: number | null;
  /** PR 的目标分支（base.ref）、目标仓的仓库 id（base.repo.id）与默认分支
   * （base.repo.default_branch）；缺失 = null。 */
  baseRef: string | null;
  baseRepoId: number | null;
  defaultBranch: string | null;
  /** 目标仓现在的 owner（base.repo.owner.login；仓库改名或转移后是新名字）；缺失 = null。 */
  baseOwner: string | null;
}

export interface GithubPullPage {
  /** true = 304 Not Modified（调用方复用缓存判据，同 check-runs 条件 GET）。 */
  notModified: boolean;
  etag: string | null;
  pull: GithubPull | null;
}

/** 条件 GET（ETag）：304 → notModified；非 2xx、网络错、响应体不是 JSON 对象
 * → null。githubPull 与 githubCommitCheckRuns 共用。 */
async function conditionalGetJson(
  fetchImpl: FetchLike,
  url: string,
  token: string | null,
  etag: string | null | undefined,
  timeoutMs: number,
): Promise<
  { notModified: true } | { notModified: false; etag: string | null; data: object } | null
> {
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await fetchImpl(url, {
      headers: {
        ...API_HEADERS,
        ...(token !== null ? { authorization: `Bearer ${token}` } : {}),
        ...(etag != null ? { 'if-none-match': etag } : {}),
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return null;
  }
  if (res.status === 304) return { notModified: true };
  if (!res.ok) return null;
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null) return null;
  return { notModified: false, etag: res.headers.get('etag'), data };
}

/** 单条 PR 条件读（#1403 review 关口对账：`GET /repos/{o}/{r}/pulls/{n}`，
 * If-None-Match 携带上轮 etag → 304 不计主限流）。null = 读不到（网络/404/
 * 限流/响应形坏不区分，fail-open 归调用方，同 githubCommitCheckRuns）。 */
export async function githubPull(
  fetchImpl: FetchLike,
  token: string | null,
  owner: string,
  repo: string,
  prNumber: number,
  opts: { etag?: string | null; timeoutMs?: number } = {},
): Promise<GithubPullPage | null> {
  const url = `https://api.github.com/${repoPath(owner, repo)}/pulls/${prNumber}`;
  const got = await conditionalGetJson(
    fetchImpl,
    url,
    token,
    opts.etag,
    opts.timeoutMs ?? FETCH_TIMEOUT_MS,
  );
  if (got === null) return null;
  if (got.notModified) return { notModified: true, etag: opts.etag ?? null, pull: null };
  const raw = got.data as {
    state?: unknown;
    merged?: unknown;
    merge_commit_sha?: unknown;
    merged_by?: { login?: unknown } | null;
    head?: { sha?: unknown; ref?: unknown; repo?: { id?: unknown } | null } | null;
    base?: {
      ref?: unknown;
      repo?: { id?: unknown; default_branch?: unknown; owner?: { login?: unknown } | null } | null;
    } | null;
  };
  // merged 缺失或不是布尔 → 读不到：不能把一次被裁掉的响应读成「关闭未合并」。
  if ((raw.state !== 'open' && raw.state !== 'closed') || typeof raw.merged !== 'boolean') {
    return null;
  }
  const merged = raw.merged;
  return {
    notModified: false,
    etag: got.etag,
    pull: {
      state: raw.state,
      merged,
      mergeCommitSha:
        merged && typeof raw.merge_commit_sha === 'string' ? raw.merge_commit_sha : null,
      mergedBy: merged && typeof raw.merged_by?.login === 'string' ? raw.merged_by.login : null,
      headSha: typeof raw.head?.sha === 'string' ? raw.head.sha : null,
      headRef: typeof raw.head?.ref === 'string' ? raw.head.ref : null,
      headRepoId: typeof raw.head?.repo?.id === 'number' ? raw.head.repo.id : null,
      baseRef: typeof raw.base?.ref === 'string' ? raw.base.ref : null,
      baseRepoId: typeof raw.base?.repo?.id === 'number' ? raw.base.repo.id : null,
      defaultBranch:
        typeof raw.base?.repo?.default_branch === 'string' ? raw.base.repo.default_branch : null,
      baseOwner: optString(raw.base?.repo?.owner?.login),
    },
  };
}

/** head 是否包含 base（`GET /repos/{o}/{r}/compare/{base}...{head}` 的 status：
 * ahead / identical = 包含，behind / diverged = 不包含）。'missing' = 404
 * （base 提交不在 GitHub 上，例如从没推送过）；'invalid' = 两个参数不都是 40
 * 位十六进制 SHA（机器回报的值，不拼进请求路径，不发请求）；null = 读不到。 */
export async function githubCompareStatus(
  fetchImpl: FetchLike,
  token: string | null,
  owner: string,
  repo: string,
  base: string,
  head: string,
): Promise<string | 'missing' | 'invalid' | null> {
  if (!isFullSha(base) || !isFullSha(head)) return 'invalid';
  // per_page=1：只要 status，不拉整页提交。
  const url = `https://api.github.com/${repoPath(owner, repo)}/compare/${base}...${head}?per_page=1`;
  try {
    const res = await fetchImpl(url, {
      headers: {
        ...API_HEADERS,
        ...(token !== null ? { authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (res.status === 404) return 'missing';
    if (!res.ok) return null;
    const data = (await res.json()) as { status?: unknown } | null;
    return typeof data?.status === 'string' ? data.status : null;
  } catch {
    return null;
  }
}

/** 工作分支上的一张 PR（#1403 段 2 PR 身份：`GET /repos/{o}/{r}/pulls` 的列表项投影）。
 * 列表项没有 merged 布尔，merged = merged_at 非空。head.repo 为 null（fork 已删）时
 * headRepoId 是 null。 */
export interface GithubBranchPull {
  number: number;
  state: 'open' | 'closed';
  merged: boolean;
  headRef: string | null;
  headRepoId: number | null;
  baseRef: string | null;
  baseRepoId: number | null;
}

/** 一个 head 分支往一个 base 分支的 PR（`GET /repos/{o}/{r}/pulls?state=all&head=
 * <owner>:<branch>&base=<base>&per_page=10`，GitHub 按创建时间倒序给）。同一个分支可以
 * 先后开过好几张 PR。token 可空（匿名梯，公开仓可达）。null = 读不到（网络、非 2xx、
 * 响应不是数组）；形状不对的项跳过。 */
export async function githubBranchPulls(
  fetchImpl: FetchLike,
  token: string | null,
  owner: string,
  repo: string,
  opts: { head: string; base: string },
): Promise<GithubBranchPull[] | null> {
  const url = listUrl(owner, repo, 'pulls', {
    state: 'all',
    head: opts.head,
    base: opts.base,
    per_page: 10,
  });
  const got = await conditionalGetJson(fetchImpl, url, token, null, FETCH_TIMEOUT_MS);
  if (got === null || got.notModified) return null;
  const page = projectArray<GithubBranchPull>(
    { ok: true, data: got.data, hasMore: false },
    (raw) => {
      const p = raw as {
        number?: unknown;
        state?: unknown;
        merged_at?: unknown;
        head?: { ref?: unknown; repo?: { id?: unknown } | null } | null;
        base?: { ref?: unknown; repo?: { id?: unknown } | null } | null;
      };
      if (typeof p.number !== 'number' || (p.state !== 'open' && p.state !== 'closed')) return null;
      return {
        number: p.number,
        state: p.state,
        merged: typeof p.merged_at === 'string',
        headRef: optString(p.head?.ref),
        headRepoId: typeof p.head?.repo?.id === 'number' ? p.head.repo.id : null,
        baseRef: optString(p.base?.ref),
        baseRepoId: typeof p.base?.repo?.id === 'number' ? p.base.repo.id : null,
      };
    },
  );
  return page.ok ? page.items : null;
}

/** #1242 转换面可达性判定：GET /repos/{o}/{r}。可达 = resolve（2xx）；
 *  404 = 不可达（含「私仓无 auth 与不存在同形」的 GitHub 防探测语义——
 *  mapUpstreamStatus 404 分支同文）；限流/网络/5xx 沿 readJson 的 HttpError
 *  映射上抛（502/429 面与 repos 代理同族）。token 可空（匿名梯：公开仓
 *  可达、私仓 404——与 githubPullState 的 token 纪律同律：仅进
 *  Authorization 头，never URL/错误 message）。 */
export async function githubRepoReachable(
  fetchImpl: FetchLike,
  token: string | null,
  owner: string,
  repo: string,
): Promise<boolean> {
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  try {
    await readJson(fetchImpl, url, {
      ...API_HEADERS,
      ...(token !== null ? { authorization: `Bearer ${token}` } : {}),
    });
    return true;
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) return false;
    throw err;
  }
}

function mapFetchThrow(url: string, err: unknown): HttpError {
  if (err instanceof DOMException && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
    return new HttpError(502, `github fetch timeout after ${FETCH_TIMEOUT_MS}ms: ${url}`);
  }
  if (err instanceof TypeError) {
    // undici 把底层原因挂 cause（ECONNRESET/ENOTFOUND…）——带上便于定位。
    const cause = (err as { cause?: { code?: string } }).cause?.code;
    return new HttpError(
      502,
      `github fetch network error: ${err.message}${cause ? ` (${cause})` : ''}: ${url}`,
    );
  }
  return new HttpError(502, `github fetch failed: ${String(err)}: ${url}`);
}

function mapUpstreamStatus(
  url: string,
  res: { status: number; headers: { get(n: string): string | null } },
): HttpError {
  if (res.status === 404) {
    // 私仓无 auth 与不存在同形（GitHub 防探测语义），不区分。
    return new HttpError(404, `github repo not found (or private without auth): ${url}`);
  }
  if (isRateLimited(res)) {
    return new HttpError(
      429,
      'github api rate limit exceeded (unauthenticated 60 req/h per IP); retry later',
    );
  }
  if (res.status === 409) {
    return new HttpError(502, `github repo is empty (no commits): ${url}`);
  }
  return new HttpError(502, `github api ${res.status}: ${url}`);
}

/** 限流判定（按响应头）：429，或 403 带 remaining=0 / retry-after。 */
function isRateLimited(res: { status: number; headers: { get(n: string): string | null } }) {
  return (
    res.status === 429 ||
    (res.status === 403 &&
      (res.headers.get('x-ratelimit-remaining') === '0' ||
        // 二级限流（abuse/secondary）：403 无 remaining 头、带 retry-after。
        res.headers.get('retry-after') !== null))
  );
}

/** 限流应答：isRateLimited 的头判据之外，403 没带限流头时再看一眼应答文本——
 * 二级限流可以不带 retry-after（上游文档「Exceeding the rate limit」：403 或
 * 429 + 说明超了二级限流的 message）。 */
async function isRateLimitedResponse(res: Awaited<ReturnType<FetchLike>>): Promise<boolean> {
  if (isRateLimited(res)) return true;
  return res.status === 403 && /rate limit/i.test(await res.text().catch(() => ''));
}

/** 头里的秒数：缺省、为空或不是非负整数 = null（Number('') 是 0，不能当「0 秒后」）。 */
function headerSeconds(headers: { get(name: string): string | null }, name: string): number | null {
  const v = headers.get(name)?.trim() ?? '';
  return /^\d+$/.test(v) ? Number(v) : null;
}

/** 进料读遇到限流（#1406：429，或带限流信号的 403）：调用方本轮停读——同一
 * token 再发读只会再被拒。resetAt = x-ratelimit-reset（UTC 秒）换成的毫秒；
 * retryAfterSeconds = retry-after 头；缺省或不是数 = null。 */
export class GithubRateLimitedError extends Error {
  constructor(
    url: string,
    readonly status: number,
    readonly resetAt: number | null,
    readonly retryAfterSeconds: number | null,
  ) {
    super(`github api rate limited (${status}): ${url}`);
    this.name = 'GithubRateLimitedError';
  }

  /** 限流解除的时刻：retry-after 优先（GitHub 文档「Exceeding the rate limit」：
   * 有 retry-after 就等它；二级限流常同时带主窗口的 x-ratelimit-reset，那个时刻
   * 可能远在之后），否则 x-ratelimit-reset；都没有 = null。 */
  retryAt(now: number): number | null {
    if (this.retryAfterSeconds !== null) return now + this.retryAfterSeconds * 1000;
    return this.resetAt;
  }
}

/** 认证面仓库条目（GitHub `GET /user/repos` 元素最小投影；camelCase =
 * lib 内部形，wire 封套（full_name/private snake_case）归 shared
 * githubReposResponseSchema，routes 层映射）。 */
export interface GithubUserRepo {
  id: number;
  /** owner login（上游 `owner.login` 平铺）。 */
  owner: string;
  name: string;
  fullName: string;
  isPrivate: boolean;
}

/** 认证面仓库列表单页条数 [设计]（GitHub per_page 上限即 100；picker 靠 q
 * 过滤收敛，分页归后续需要时再开）。 */
const USER_REPOS_PER_PAGE = 100;

/** 连接用户的仓库列表（spec 12 / #359 repo picker 数据源）。token 仅进
 * Authorization 头（never URL / 错误 message）；`sort=pushed` 近期活跃在前、
 * 单页 USER_REPOS_PER_PAGE——picker 的 q 过滤在 routes 层本地做
 * （上游 /user/repos 无查询参数面）。畸形条目（缺 id/name/full_name/
 * owner.login）跳过不入列。 */
export async function githubUserRepos(
  fetchImpl: FetchLike,
  token: string,
): Promise<GithubUserRepo[]> {
  const url = `https://api.github.com/user/repos?per_page=${USER_REPOS_PER_PAGE}&sort=pushed`;
  const data = await readJson(fetchImpl, url, {
    ...API_HEADERS,
    authorization: `Bearer ${token}`,
  });
  if (!Array.isArray(data)) {
    throw new HttpError(502, 'github user repos response not an array');
  }
  const repos: GithubUserRepo[] = [];
  for (const raw of data as Array<Record<string, unknown>>) {
    const owner = raw.owner as { login?: unknown } | null | undefined;
    if (
      typeof raw.id !== 'number' ||
      typeof raw.name !== 'string' ||
      typeof raw.full_name !== 'string' ||
      typeof owner?.login !== 'string'
    ) {
      continue;
    }
    repos.push({
      id: raw.id,
      owner: owner.login,
      name: raw.name,
      fullName: raw.full_name,
      isPrivate: raw.private === true,
    });
  }
  return repos;
}

/** 认证用户 login（`GET /user`；spec 12 / #361 connection 族 callback 的
 * github_connection.login 读面）。token 仅进 Authorization 头（never URL /
 * 错误 message）；应答缺 login → 502。 */
export async function githubUserLogin(fetchImpl: FetchLike, token: string): Promise<string> {
  const data = (await readJson(fetchImpl, 'https://api.github.com/user', {
    ...API_HEADERS,
    authorization: `Bearer ${token}`,
  })) as { login?: unknown };
  if (typeof data.login !== 'string' || data.login === '') {
    throw new HttpError(502, 'github user response missing login');
  }
  return data.login;
}

// —— issue 读面（#446 / ADR 0005 读向：只读，不在 GitHub 留痕迹）——————————
//
// 认证面三端点（token 仅进 Authorization 头，never URL / 错误 message）：
// - GET /repos/{owner}/{repo}/issues（列表；上游同径返回 PR——按条目
//   `pull_request` 键滤除）
// - GET /repos/{owner}/{repo}/issues/{n}（单条含 body；导入建任务的现拉面，
//   不缓存第二真值）
// - GET /repos/{owner}/{repo}/labels（仓库 label 集；镜像同步数据源）

/** GitHub label 最小投影（issue 上的 label 与仓库 label 集同形，一型两面；
 * description 不投影——tag 表无该列）。lib 内部形；color 上游 6-hex 无 #、
 * 偶缺 → null（归一归 services/tags.ts 消费面，wire 封套归 shared
 * githubIssueLabelSchema）。 */
export interface GithubLabel {
  name: string;
  color: string | null;
}

/** issue 列表条目（lib 内部形，snake→camel 不转——字段名皆单词无歧义；
 * wire 映射归 routes 层 githubIssuesResponseSchema）。 */
export interface GithubIssueSummary {
  number: number;
  title: string;
  /** 上游 issue state 二值（'all' 只是查询参数，不是条目态）。 */
  state: 'open' | 'closed';
  labels: GithubLabel[];
}

/** 单条 issue 详情（导入面：body 位在此，列表面不带）。 */
export interface GithubIssueDetail extends GithubIssueSummary {
  body: string | null;
}

/** issue 列表单页条数 [设计]（对话面 30 条足够翻页；上游上限 100）。 */
const ISSUES_PER_PAGE = 30;

/** label 单页上限 [设计]（真实仓库 label 罕见 >100；超限面归需要时再开）。 */
const LABELS_PER_PAGE = 100;

/** owner/repo 段出站编码（列值已过 isGithubRepoRef 闸，双保险）。 */
function repoPath(owner: string, repo: string): string {
  return `repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

function authHeaders(token: string): Record<string, string> {
  return { ...API_HEADERS, authorization: `Bearer ${token}` };
}

/** 上游 label 数组 → 最小投影（issue.labels 与 /labels 端点同形同律）：
 * 畸形条目（缺 name/空串）跳过；color 非串 → null。 */
function parseLabels(raw: unknown): GithubLabel[] {
  if (!Array.isArray(raw)) return [];
  const labels: GithubLabel[] = [];
  for (const entry of raw as Array<Record<string, unknown>>) {
    if (typeof entry?.name !== 'string' || entry.name === '') continue;
    labels.push({
      name: entry.name,
      color: typeof entry.color === 'string' ? entry.color : null,
    });
  }
  return labels;
}

/** 上游 issue 条目 → 最小投影；畸形（缺 number/title/state 值域外）返回
 * null 由调用面跳过（githubUserRepos 同律）。PR 条目（`pull_request` 键）
 * 同样 null——/issues 上游语义混发。 */
function projectIssue(raw: Record<string, unknown>): GithubIssueSummary | null {
  if (raw.pull_request !== undefined) return null;
  if (typeof raw.number !== 'number' || typeof raw.title !== 'string') return null;
  if (raw.state !== 'open' && raw.state !== 'closed') return null;
  return {
    number: raw.number,
    title: raw.title,
    state: raw.state,
    labels: parseLabels(raw.labels),
  };
}

/** 仓库 issue 列表（`GET /repos/{o}/{r}/issues`）。state = open|closed|all、
 * page 从 1 起（上游同名参数直透）；hasMore = Link 头 rel="next" 在否。
 * 应答非数组 → 502；畸形/PR 条目跳过。state 值域单源 = shared
 * GITHUB_ISSUE_STATES（service 层以 GithubIssueState 收口后传入；lib 层
 * 零依赖纪律不引 shared，此处字面量联合为同值投影）。 */
export async function githubRepoIssues(
  fetchImpl: FetchLike,
  token: string,
  owner: string,
  repo: string,
  opts: { state: 'open' | 'closed' | 'all'; page: number },
): Promise<{ issues: GithubIssueSummary[]; hasMore: boolean }> {
  const url =
    `https://api.github.com/${repoPath(owner, repo)}/issues` +
    `?state=${opts.state}&page=${opts.page}&per_page=${ISSUES_PER_PAGE}`;
  const { data, getHeader } = await readJsonFull(fetchImpl, url, authHeaders(token));
  if (!Array.isArray(data)) {
    throw new HttpError(502, 'github issues response not an array');
  }
  const issues: GithubIssueSummary[] = [];
  for (const raw of data as Array<Record<string, unknown>>) {
    const projected = projectIssue(raw);
    if (projected) issues.push(projected);
  }
  const link = getHeader('link');
  return { issues, hasMore: (link ?? '').includes('rel="next"') };
}

/** 单条 issue 详情（`GET /repos/{o}/{r}/issues/{n}`；导入面现拉）。畸形
 * 应答 → 502；上游 404（issue 不存在/私仓无权）经既有映射直透。 */
export async function githubRepoIssue(
  fetchImpl: FetchLike,
  token: string,
  owner: string,
  repo: string,
  issueNumber: number,
): Promise<GithubIssueDetail> {
  const url = `https://api.github.com/${repoPath(owner, repo)}/issues/${issueNumber}`;
  const data = (await readJson(fetchImpl, url, authHeaders(token))) as Record<string, unknown>;
  const projected = projectIssue(data);
  if (!projected) {
    throw new HttpError(502, `github issue response malformed: ${url}`);
  }
  return {
    ...projected,
    body: typeof data.body === 'string' ? data.body : null,
  };
}

// —— 工具读面（#1406 P5a-2：chief / MCP 的 issues / pull_requests /
// workflow_runs，只读）——————————————————————————————————————————————————
//
// - GET repos/{o}/{r}/issues?state=&page=&per_page=（PR 条目经 projectIssue 滤除）
// - GET repos/{o}/{r}/pulls?state=&page=&per_page=
// - GET repos/{o}/{r}/actions/runs?branch=&status=&exclude_pull_requests=true
//   &page=&per_page=
// 失败不抛：返回分类（超时 / 网络 / 限流 / 状态码 / 形坏），由调用方
// （services/github-reads.ts）写成给模型看的短原因——不带 URL、不带 token。
// 超时由调用方给（低于 daemon relay 的工具超时）。原始字符串在这里只做投影，
// 去控制字符与限长归调用方（那是模型面的规矩）。

export type GithubListFailure =
  | { kind: 'timeout' }
  | { kind: 'network' }
  | { kind: 'rate-limited'; status: number }
  | { kind: 'status'; status: number }
  | { kind: 'malformed' };

export type GithubListResult<T> =
  | { ok: true; items: T[]; hasMore: boolean }
  | { ok: false; failure: GithubListFailure };

export interface GithubIssueListEntry extends GithubIssueSummary {
  /** user.login；账号已删（user 为 null）→ null。 */
  author: string | null;
  authorAssociation: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface GithubPullListEntry {
  number: number;
  title: string;
  state: 'open' | 'closed';
  draft: boolean;
  mergedAt: string | null;
  headRef: string | null;
  baseRef: string | null;
  author: string | null;
}

export interface GithubWorkflowRunEntry {
  id: number;
  name: string | null;
  headBranch: string | null;
  headSha: string | null;
  status: string | null;
  conclusion: string | null;
  event: string | null;
  createdAt: string | null;
}

function isAbort(err: unknown): boolean {
  const name = (err as { name?: unknown } | null)?.name;
  return name === 'TimeoutError' || name === 'AbortError';
}

/** 单页 GET：成功给 JSON 体与 hasMore（Link rel="next"）；失败给分类（限流按
 * isRateLimitedResponse 判）。 */
async function getListPage(
  fetchImpl: FetchLike,
  url: string,
  token: string,
  timeoutMs: number,
): Promise<
  { ok: true; data: unknown; hasMore: boolean } | { ok: false; failure: GithubListFailure }
> {
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await fetchImpl(url, {
      headers: authHeaders(token),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    return { ok: false, failure: { kind: isAbort(err) ? 'timeout' : 'network' } };
  }
  if (!res.ok) {
    return {
      ok: false,
      failure: (await isRateLimitedResponse(res))
        ? { kind: 'rate-limited', status: res.status }
        : { kind: 'status', status: res.status },
    };
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch (err) {
    return { ok: false, failure: { kind: isAbort(err) ? 'timeout' : 'malformed' } };
  }
  return { ok: true, data, hasMore: (res.headers.get('link') ?? '').includes('rel="next"') };
}

function optString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function loginOf(user: unknown): string | null {
  return optString((user as { login?: unknown } | null | undefined)?.login);
}

/** 列表读 URL：值为 undefined 的查询参数不带。 */
function listUrl(
  owner: string,
  repo: string,
  path: string,
  params: Record<string, string | number | undefined>,
): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) query.set(key, String(value));
  }
  return `https://api.github.com/${repoPath(owner, repo)}/${path}?${query}`;
}

/** 数组体逐条投影：体不是数组 = 形坏；条目投影为 null 的跳过。 */
function projectArray<T>(
  page: Awaited<ReturnType<typeof getListPage>>,
  project: (raw: Record<string, unknown>) => T | null,
  container?: string,
): GithubListResult<T> {
  if (!page.ok) return page;
  let entries: unknown = page.data;
  if (container !== undefined) {
    entries =
      typeof entries === 'object' && entries !== null && !Array.isArray(entries)
        ? (entries as Record<string, unknown>)[container]
        : undefined;
  }
  if (!Array.isArray(entries)) return { ok: false, failure: { kind: 'malformed' } };
  const items: T[] = [];
  for (const raw of entries as unknown[]) {
    if (typeof raw !== 'object' || raw === null) continue;
    const projected = project(raw as Record<string, unknown>);
    if (projected !== null) items.push(projected);
  }
  return { ok: true, items, hasMore: page.hasMore };
}

/** 仓库 issue 列表一页（工具读面）。 */
export async function githubListIssues(
  fetchImpl: FetchLike,
  token: string,
  owner: string,
  repo: string,
  opts: { state: 'open' | 'closed' | 'all'; page: number; perPage: number; timeoutMs: number },
): Promise<GithubListResult<GithubIssueListEntry>> {
  const url = listUrl(owner, repo, 'issues', {
    state: opts.state,
    page: opts.page,
    per_page: opts.perPage,
  });
  return projectArray(await getListPage(fetchImpl, url, token, opts.timeoutMs), (raw) => {
    const issue = projectIssue(raw);
    if (issue === null) return null;
    return {
      ...issue,
      author: loginOf(raw.user),
      authorAssociation: optString(raw.author_association),
      createdAt: optString(raw.created_at),
      updatedAt: optString(raw.updated_at),
    };
  });
}

/** 仓库 PR 列表一页（工具读面）。 */
export async function githubListPulls(
  fetchImpl: FetchLike,
  token: string,
  owner: string,
  repo: string,
  opts: { state: 'open' | 'closed' | 'all'; page: number; perPage: number; timeoutMs: number },
): Promise<GithubListResult<GithubPullListEntry>> {
  const url = listUrl(owner, repo, 'pulls', {
    state: opts.state,
    page: opts.page,
    per_page: opts.perPage,
  });
  return projectArray(await getListPage(fetchImpl, url, token, opts.timeoutMs), (raw) => {
    if (typeof raw.number !== 'number' || typeof raw.title !== 'string') return null;
    if (raw.state !== 'open' && raw.state !== 'closed') return null;
    return {
      number: raw.number,
      title: raw.title,
      state: raw.state,
      draft: raw.draft === true,
      mergedAt: optString(raw.merged_at),
      headRef: optString((raw.head as { ref?: unknown } | null | undefined)?.ref),
      baseRef: optString((raw.base as { ref?: unknown } | null | undefined)?.ref),
      author: loginOf(raw.user),
    };
  });
}

/** 仓库 workflow runs 一页（工具读面）。exclude_pull_requests=true：每条 run
 * 的 pull_requests 数组置空，本面不用它，应答小一截。 */
export async function githubListWorkflowRuns(
  fetchImpl: FetchLike,
  token: string,
  owner: string,
  repo: string,
  opts: { branch?: string; status?: string; page: number; perPage: number; timeoutMs: number },
): Promise<GithubListResult<GithubWorkflowRunEntry>> {
  const url = listUrl(owner, repo, 'actions/runs', {
    branch: opts.branch,
    status: opts.status,
    exclude_pull_requests: 'true',
    page: opts.page,
    per_page: opts.perPage,
  });
  return projectArray(
    await getListPage(fetchImpl, url, token, opts.timeoutMs),
    (raw) => {
      if (typeof raw.id !== 'number') return null;
      return {
        id: raw.id,
        name: optString(raw.name),
        headBranch: optString(raw.head_branch),
        headSha: optString(raw.head_sha),
        status: optString(raw.status),
        conclusion: optString(raw.conclusion),
        event: optString(raw.event),
        createdAt: optString(raw.created_at),
      };
    },
    'workflow_runs',
  );
}

/** 仓库 label 集（`GET /repos/{o}/{r}/labels`，单页 LABELS_PER_PAGE
 * [设计]）。应答非数组 → 502；畸形条目跳过。 */
export async function githubRepoLabels(
  fetchImpl: FetchLike,
  token: string,
  owner: string,
  repo: string,
): Promise<GithubLabel[]> {
  const url = `https://api.github.com/${repoPath(owner, repo)}/labels?per_page=${LABELS_PER_PAGE}`;
  const data = await readJson(fetchImpl, url, authHeaders(token));
  if (!Array.isArray(data)) {
    throw new HttpError(502, 'github labels response not an array');
  }
  return parseLabels(data);
}

// —— issue 进料读面（#1406 P5a-1：issue 轮询器的出站读，只读）——————————————
//
// 四个读，全部 fail-open 返回 null（网络 / 超时 / 非 2xx / 形坏不区分：读不到
// = 本轮不领、下轮重读，同 githubCommitCheckRuns 律）；限流例外：429 或带限流
// 信号的 403 抛 GithubRateLimitedError，进料本队本轮停读（同一 token 再读只会
// 再被拒）。token 必携、只进 Authorization 头（进料面不走匿名梯）：
// - GET repos/{o}/{r}/issues?state=open&labels=&sort=created&direction=asc
//   &per_page=100（条件读；PR 条目经 projectIssue 滤除；下一页按 Link
//   rel="next" 的 URL 读，只跟 api.github.com 上的 URL）
// - GET repos/{o}/{r}/issues/{n}/events?per_page=100（条件读；上游按时间升序，
//   最新的在后面的页；下一页同样按 Link rel="next" 读，只跟 api.github.com；
//   投影 labeled / unlabeled / closed，带 performed_via_github_app 的 slug）
// - GET repos/{o}/{r}/collaborators/{login}/permission（permission = legacy
//   基础角色：maintain 映射为 write、triage 映射为 read；role_name = 实际角色）
// - GET repos/{o}/{r}/issues/{n}（条件读，只投影 state；body 不出本模块）
// 条件读 304 只在带了 If-None-Match 且带 Authorization 时不计主限流（GitHub
// REST 最佳实践「Use conditional requests」）。助手名刻意不与 #1414 的
// conditionalGetJson 重名（两 PR 并行合入）。

/** 条件读结果：notModified = 304（调用方复用上轮缓存）。 */
export type GithubConditionalRead<T> =
  | { notModified: true }
  | { notModified: false; etag: string | null; data: T };

/** 进料面单页条数（上游 per_page 上限 100）。 */
const INTAKE_PER_PAGE = 100;

/** 单次 GET（token 必携，etag 可选）。null = 网络 / 超时 / 2xx 体不是 JSON；
 * 限流抛 GithubRateLimitedError；其余非 2xx 回 status 不带 data（调用方按状态码
 * 定语义）。 */
async function intakeGet(
  fetchImpl: FetchLike,
  url: string,
  token: string,
  etag: string | null | undefined,
): Promise<{ status: number; etag: string | null; link: string | null; data: unknown } | null> {
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await fetchImpl(url, {
      headers: { ...authHeaders(token), ...(etag != null ? { 'if-none-match': etag } : {}) },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    return null;
  }
  const head = { status: res.status, etag: res.headers.get('etag'), link: res.headers.get('link') };
  if (!res.ok) {
    if (await isRateLimitedResponse(res)) {
      const reset = headerSeconds(res.headers, 'x-ratelimit-reset');
      throw new GithubRateLimitedError(
        url,
        res.status,
        reset === null ? null : reset * 1000,
        headerSeconds(res.headers, 'retry-after'),
      );
    }
    return { ...head, data: undefined };
  }
  try {
    return { ...head, data: await res.json() };
  } catch {
    return null;
  }
}

/** 条件读：304（且确实带了 etag）→ notModified；其余非 2xx → null。 */
async function intakeConditionalGet(
  fetchImpl: FetchLike,
  url: string,
  token: string,
  etag: string | null | undefined,
): Promise<GithubConditionalRead<{ link: string | null; body: unknown }> | null> {
  const got = await intakeGet(fetchImpl, url, token, etag);
  if (got === null) return null;
  if (got.status === 304) return etag != null ? { notModified: true } : null;
  if (got.status < 200 || got.status >= 300) return null;
  return { notModified: false, etag: got.etag, data: { link: got.link, body: got.data } };
}

/** Link 头里 rel="next" 的 URL；只认 api.github.com 上的（token 随请求走，
 * 不跟到别的主机）。 */
function nextPageUrl(link: string | null): string | null {
  for (const part of (link ?? '').split(',')) {
    const m = /<([^>]+)>\s*;\s*rel="next"/.exec(part);
    if (m?.[1]?.startsWith('https://api.github.com/')) return m[1];
  }
  return null;
}

/** 带标签的 open issue 一页（next = 下一页 URL，没有或不可跟 = null）。 */
export interface GithubLabeledIssuesPage {
  issues: GithubIssueSummary[];
  next: string | null;
  /** 这一页满了（上游条目数 = per_page，PR 也算）。满页之后再长出的下一页
   * 不改这一页的内容，ETag 不变、304 会带回过时的 next：调用方对满页不发
   * If-None-Match。 */
  full: boolean;
}

/** 带标签的 open issue 列表条件读（进料候选面）。sort=created + direction=asc
 * = 稳定排序（列表不因条目更新而重排，304 更常见），且第一页就是最旧的。
 * opts.url = 上一页给的 next（缺省 = 第一页）。 */
export async function githubOpenIssuesWithLabel(
  fetchImpl: FetchLike,
  token: string,
  owner: string,
  repo: string,
  label: string,
  opts: { url?: string | null; etag?: string | null } = {},
): Promise<GithubConditionalRead<GithubLabeledIssuesPage> | null> {
  const url =
    opts.url ??
    `https://api.github.com/${repoPath(owner, repo)}/issues?state=open` +
      `&labels=${encodeURIComponent(label)}&sort=created&direction=asc&per_page=${INTAKE_PER_PAGE}`;
  const got = await intakeConditionalGet(fetchImpl, url, token, opts.etag);
  if (got === null || got.notModified) return got;
  if (!Array.isArray(got.data.body)) return null;
  const issues: GithubIssueSummary[] = [];
  for (const raw of got.data.body as unknown[]) {
    if (typeof raw !== 'object' || raw === null) continue;
    const projected = projectIssue(raw as Record<string, unknown>);
    if (projected) issues.push(projected);
  }
  return {
    notModified: false,
    etag: got.etag,
    data: {
      issues,
      next: nextPageUrl(got.data.link),
      full: got.data.body.length >= INTAKE_PER_PAGE,
    },
  };
}

/** issue 上一条事件（events 端点 labeled / unlabeled / closed 的最小投影）。 */
export interface GithubIssueEvent {
  id: number;
  event: 'labeled' | 'unlabeled' | 'closed';
  /** labeled / unlabeled 的 label.name；closed 为 null。 */
  label: string | null;
  /** actor.login；账号已删（actor 为 null）→ null。 */
  actor: string | null;
  /** performed_via_github_app.slug：经 GitHub App 操作 → app 的 slug（用户
   * 授权的 app 令牌下 actor 是授权的人；app 安装令牌下 actor 是
   * `<slug>[bot]`）；经 app 却缺 slug（上游 integration 形里 slug 非必有）→
   * 'unknown'；不经 app → null。进料 D5 不认经 app 打的标。 */
  viaApp: string | null;
  /** created_at 的毫秒值。 */
  at: number;
}

/** issue 事件一页（升序，最新的在后面的页）。 */
export interface GithubIssueEventsPage {
  events: GithubIssueEvent[];
  /** 上游还有下一页（Link 有 rel="next"）。 */
  more: boolean;
  /** 下一页 URL；没有，或指到 api.github.com 之外（不可跟）= null。 */
  next: string | null;
  /** 这一页满了（上游条目数 = per_page）：同 GithubLabeledIssuesPage.full，
   * 调用方对满页不发 If-None-Match（新事件落到下一页时这一页 ETag 不变）。 */
  full: boolean;
}

/** issue 事件一页的条件读（D5 打标人核验 + 关闭人核验）。只投影 labeled /
 * unlabeled / closed；这几种事件缺 id / created_at（标签事件再加 label.name）=
 * 整读作废（null）——宁可本轮不动，不在缺字段的历史上判谁最后打的标、谁关的
 * issue。opts.url = 上一页给的 next（缺省 = 第一页）。 */
export async function githubIssueEvents(
  fetchImpl: FetchLike,
  token: string,
  owner: string,
  repo: string,
  issueNumber: number,
  opts: { url?: string | null; etag?: string | null } = {},
): Promise<GithubConditionalRead<GithubIssueEventsPage> | null> {
  const url =
    opts.url ??
    `https://api.github.com/${repoPath(owner, repo)}/issues/${issueNumber}/events` +
      `?per_page=${INTAKE_PER_PAGE}`;
  const got = await intakeConditionalGet(fetchImpl, url, token, opts.etag);
  if (got === null || got.notModified) return got;
  if (!Array.isArray(got.data.body)) return null;
  const events: GithubIssueEvent[] = [];
  for (const raw of got.data.body as unknown[]) {
    if (typeof raw !== 'object' || raw === null) return null;
    const entry = raw as Record<string, unknown>;
    const event = entry.event;
    if (event !== 'labeled' && event !== 'unlabeled' && event !== 'closed') continue;
    const label = entry.label as { name?: unknown } | null | undefined;
    const actor = entry.actor as { login?: unknown } | null | undefined;
    const app = entry.performed_via_github_app as { slug?: unknown } | null | undefined;
    const at = typeof entry.created_at === 'string' ? Date.parse(entry.created_at) : Number.NaN;
    const labelName = typeof label?.name === 'string' ? label.name : null;
    if (typeof entry.id !== 'number' || !Number.isFinite(at)) return null;
    if (event !== 'closed' && labelName === null) return null;
    events.push({
      id: entry.id,
      event,
      label: event === 'closed' ? null : labelName,
      actor: typeof actor?.login === 'string' ? actor.login : null,
      viaApp:
        typeof app !== 'object' || app === null
          ? null
          : typeof app.slug === 'string'
            ? app.slug
            : 'unknown',
      at,
    });
  }
  return {
    notModified: false,
    etag: got.etag,
    data: {
      events,
      more: (got.data.link ?? '').includes('rel="next"'),
      next: nextPageUrl(got.data.link),
      full: got.data.body.length >= INTAKE_PER_PAGE,
    },
  };
}

/** 用户在仓库上的权限（collaborators/{login}/permission 的投影）。 */
export interface GithubRepoPermission {
  /** legacy 基础角色：admin | write | read | none（maintain → write、triage →
   * read，上游文档原文）。 */
  permission: string;
  /** 实际角色名（含自定义角色）；缺省 null。 */
  roleName: string | null;
  /** user.permissions.triage（继承 triage 的自定义角色的判据位）；缺省 null。 */
  triage: boolean | null;
}

/** 用户在仓库上的权限读。404（非协作者，或 token 看不到该仓）投影为
 * permission 'none'——明确的否定答案；限流抛 GithubRateLimitedError；其余失败
 * （网络 / 超时 / 5xx / 形坏）= null（未知）。 */
export async function githubCollaboratorPermission(
  fetchImpl: FetchLike,
  token: string,
  owner: string,
  repo: string,
  login: string,
): Promise<GithubRepoPermission | null> {
  const url =
    `https://api.github.com/${repoPath(owner, repo)}/collaborators/` +
    `${encodeURIComponent(login)}/permission`;
  const got = await intakeGet(fetchImpl, url, token, null);
  if (got === null) return null;
  if (got.status === 404) return { permission: 'none', roleName: null, triage: false };
  if (got.status < 200 || got.status >= 300) return null;
  const body = got.data as
    | { permission?: unknown; role_name?: unknown; user?: { permissions?: { triage?: unknown } } }
    | null
    | undefined;
  if (typeof body?.permission !== 'string') return null;
  const triage = body.user?.permissions?.triage;
  return {
    permission: body.permission,
    roleName: typeof body.role_name === 'string' ? body.role_name : null,
    triage: typeof triage === 'boolean' ? triage : null,
  };
}

/** issue 状态条件读（关闭对账：issue 关了，任务跟着关）。只投影 state；
 * 404 / 410（转走、删除）与其它失败一样 = null，调用方不动卡。 */
export async function githubIssueState(
  fetchImpl: FetchLike,
  token: string,
  owner: string,
  repo: string,
  issueNumber: number,
  opts: { etag?: string | null } = {},
): Promise<GithubConditionalRead<{ state: 'open' | 'closed' }> | null> {
  const url = `https://api.github.com/${repoPath(owner, repo)}/issues/${issueNumber}`;
  const got = await intakeConditionalGet(fetchImpl, url, token, opts.etag);
  if (got === null || got.notModified) return got;
  const state = (got.data.body as { state?: unknown } | null | undefined)?.state;
  if (state !== 'open' && state !== 'closed') return null;
  return { notModified: false, etag: got.etag, data: { state } };
}

// —— issue 写面（#452 / ADR 0006 写向：server 唯二写入点，文件头穷举律）———

/** JSON 写请求单点（POST/PATCH 共用）：超时/网络/上游状态经既有映射
 * （mapFetchThrow / mapUpstreamStatus），token 只进 Authorization 头。 */
async function writeJson(
  fetchImpl: FetchLike,
  method: 'POST' | 'PATCH',
  url: string,
  token: string,
  payload: Record<string, unknown>,
): Promise<unknown> {
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await fetchImpl(url, {
      method,
      headers: { ...authHeaders(token), 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    throw mapFetchThrow(url, err);
  }
  if (!res.ok) throw mapUpstreamStatus(url, res);
  try {
    return await res.json();
  } catch {
    throw new HttpError(502, `github response not json: ${url}`);
  }
}

/** 建 issue（`POST /repos/{o}/{r}/issues`，ADR 0006 D1/D3：标题 = 占位标题
 * 单源派生、正文 = 任务正文，调用面组装）。应答缺 number → 502（畸形面同
 * githubRepoIssue 律）。 */
export async function githubCreateIssue(
  fetchImpl: FetchLike,
  token: string,
  owner: string,
  repo: string,
  input: { title: string; body: string },
): Promise<{ number: number }> {
  const url = `https://api.github.com/${repoPath(owner, repo)}/issues`;
  const data = (await writeJson(fetchImpl, 'POST', url, token, input)) as Record<string, unknown>;
  if (typeof data.number !== 'number') {
    throw new HttpError(502, `github create issue response missing number: ${url}`);
  }
  return { number: data.number };
}

/** 写 issue 标题（`PATCH /repos/{o}/{r}/issues/{n}`，ADR 0006 D3：agent
 * 回填标题时写进那枚 issue）。应答体不消费（本地标题已落库，回显面现拉）。 */
export async function githubUpdateIssueTitle(
  fetchImpl: FetchLike,
  token: string,
  owner: string,
  repo: string,
  issueNumber: number,
  title: string,
): Promise<void> {
  const url = `https://api.github.com/${repoPath(owner, repo)}/issues/${issueNumber}`;
  await writeJson(fetchImpl, 'PATCH', url, token, { title });
}

// —— PR checks 只读面（#1150 CI 磨绿环：轮询器的唯一出站读）———————————————————

/** check run 最小投影（#1150 fix prompt 材料位；畸形行跳过）。output.title/
 * output.summary = GitHub 在本端点给的「失败摘要」面（真实日志下载归
 * actions/jobs + 重定向，不属轮询面——每轮每 PR 一次条件 GET 是票面钉的
 * 扫描纪律，日志拉取会把「条件读」退化成全量拉）。 */
export interface GithubCheckRun {
  name: string;
  /** 上游 status：queued | in_progress | completed。 */
  status: string;
  /** completed 时：success | failure | neutral | cancelled | skipped | timed_out；
   * 未完成恒 null。 */
  conclusion: string | null;
  outputTitle: string | null;
  outputSummary: string | null;
}

export interface GithubCheckRunsPage {
  /** true = 304 Not Modified（条件 GET 命中 etag，调用方复用缓存判据）。 */
  notModified: boolean;
  etag: string | null;
  checkRuns: GithubCheckRun[];
}

/** 单页条数 [设计]：上游 per_page 上限 100，磨绿仓（门禁数个位数）远不满；
 * 超出部分丢尾——不在本端点翻页（丢的是常驻非门禁 check，不在「磨绿」面）。 */
const CHECK_RUNS_PER_PAGE = 100;

/** PR head 的 check-runs 只读（`GET /repos/{o}/{r}/commits/{ref}/check-runs`；
 * ref = conv 分支名，上游解析分支头——PR 的 head 即分支 tip，无需再拉
 * pulls/{n} 取 sha）。条件 GET（If-None-Match 携带上轮 etag → 304 → 调用方
 * 复用判据，不出全量体）。token 可空（匿名梯，公开仓可达）。null = 读不到
 * （网络/404 私仓/限流/响应形坏不区分——fail-open 语义归调用方，同
 * githubPullState）。单次尝试、FETCH_TIMEOUT_MS 上界，不重试。 */
export async function githubCommitCheckRuns(
  fetchImpl: FetchLike,
  token: string | null,
  owner: string,
  repo: string,
  ref: string,
  opts: { etag?: string | null } = {},
): Promise<GithubCheckRunsPage | null> {
  const url =
    `https://api.github.com/${repoPath(owner, repo)}/commits/${encodeURIComponent(ref)}` +
    `/check-runs?per_page=${CHECK_RUNS_PER_PAGE}`;
  const got = await conditionalGetJson(fetchImpl, url, token, opts.etag, FETCH_TIMEOUT_MS);
  if (got === null) return null;
  if (got.notModified) {
    // 304 无应答体：etag 回传（调用方缓存键不变），checkRuns 空（notModified 位承载语义）。
    return { notModified: true, etag: opts.etag ?? null, checkRuns: [] };
  }
  const raw = (got.data as { check_runs?: unknown }).check_runs;
  if (!Array.isArray(raw)) return null;
  const checkRuns: GithubCheckRun[] = [];
  for (const entry of raw as Array<Record<string, unknown>>) {
    if (typeof entry?.name !== 'string' || typeof entry.status !== 'string') continue;
    const output = (entry.output ?? null) as Record<string, unknown> | null;
    checkRuns.push({
      name: entry.name,
      status: entry.status,
      conclusion: typeof entry.conclusion === 'string' ? entry.conclusion : null,
      outputTitle: typeof output?.title === 'string' ? output.title : null,
      outputSummary: typeof output?.summary === 'string' ? output.summary : null,
    });
  }
  return { notModified: false, etag: got.etag, checkRuns };
}

// —— 合并就绪闸的 GitHub 传输（#1404 S4a；计划 docs/verify/1404/s4-plan.md §4.1）————————
//
// 闸（services/merge-gate/**，S4b）经注入的端口用这几个函数读写 GitHub（闸的源码不 import
// 本模块，ADR 0021 D4 ④）。这里只发一个请求、把应答原样交回：应答体不投影、不过滤、不补
// 缺省，应答说明什么一律由闸自己的源码判；改变闸看到什么的参数（per_page、page、filter、
// etag、超时）都由调用方给，这里不设缺省。token 必携（闸不走匿名梯），只进 Authorization
// 头；参数先在本地核，不合规返回 invalid，不发请求。单次尝试，不重试，不跟 Link。
// 端点（S4a 只有传输，调用方是 S4b 的闸外壳与 S7 的状态写入）：
// - GET repos/{o}/{r}/pulls/{n}（可条件读）
// - GET repos/{o}/{r}/branches/{branch}（可条件读；分支保护的必需检查在 protection 里，
//   不走要管理员权限的 branches/{branch}/protection）
// - GET repos/{o}/{r}/rules/branches/{branch}?per_page=&page=（可条件读）
// - GET repos/{o}/{r}/compare/{base}...{head}?per_page=&page=（两头都是 SHA；不发条件读）
// - GET repos/{o}/{r}/commits/{sha}/check-runs?filter=&per_page=&page=（可条件读）
// - GET repos/{o}/{r}/commits/{sha}/status?per_page=&page=（可条件读）
// - GET repos/{o}/{r}/contents/{path}?ref={sha}（不发条件读）
// - POST repos/{o}/{r}/statuses/{sha}（写面，见文件头清单）

/** 闸传输的失败分类。invalid = 参数在本地被拒、没发请求（field 指明哪一个参数）；
 * rate-limited = 429，或带限流信号的 403（resetAt = x-ratelimit-reset 换成的毫秒，
 * retryAfterSeconds = retry-after；头缺省、为空或不是非负整数 = null）；status = 其余非
 * 2xx（含没发 etag 却得到的 304），message = GitHub 应答体里的 message，去控制字符与格式
 * 字符、至多 200 个字符，没有则 null；not-json = 2xx 的应答体不是 JSON。 */
export type GithubRawFailure =
  | { kind: 'invalid'; field: string }
  | { kind: 'timeout' }
  | { kind: 'network' }
  | {
      kind: 'rate-limited';
      status: number;
      resetAt: number | null;
      retryAfterSeconds: number | null;
    }
  | { kind: 'status'; status: number; message: string | null }
  | { kind: 'not-json' };

/** 闸传输的结果。ok = 2xx，body 是原样解析出的 JSON（不论形状），etag 与 Link 头原样
 * 交回；not-modified = 发了 If-None-Match 且得到 304。 */
export type GithubRawResult =
  | { kind: 'ok'; status: number; etag: string | null; link: string | null; body: unknown }
  | { kind: 'not-modified' }
  | { kind: 'failed'; failure: GithubRawFailure };

export interface GithubRawOpts {
  /** 本次请求的超时（毫秒，正整数）。 */
  timeoutMs: number;
}

export interface GithubConditionalOpts extends GithubRawOpts {
  /** 上次应答的 ETag；null = 不发 If-None-Match。 */
  etag: string | null;
}

export interface GithubPageOpts {
  /** 从 1 起的页号。 */
  page: number;
  /** 每页条数，1 到 100（上游上限 100）。 */
  perPage: number;
}

/** commit status 的 state（GitHub REST「Create a commit status」的取值）。 */
export const GITHUB_COMMIT_STATUS_STATES = ['error', 'failure', 'pending', 'success'] as const;
export type GithubCommitStatusState = (typeof GITHUB_COMMIT_STATUS_STATES)[number];

const GATE_SHA = /^[0-9a-f]{40}$/;
/** token 与 ETag 都进请求头：只收可见 ASCII，CR/LF、空格与非 ASCII 进不了头。 */
const HEADER_TOKEN = /^[\x21-\x7e]+$/;
/** GitHub 的 owner / 仓库名：字母、数字、`-`、`_`、`.`。 */
const GITHUB_NAME = /^[A-Za-z0-9_.-]+$/;
/** 路径段里不收的字符：控制字符（含 NUL）、`?`、`#`。 */
const UNSAFE_SEGMENT = /[\p{Cc}?#]/u;
const UNSAFE_MESSAGE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu;
const MESSAGE_MAX = 200;

const invalidResult = (field: string): GithubRawResult => ({
  kind: 'failed',
  failure: { kind: 'invalid', field },
});
const failedResult = (failure: GithubRawFailure): GithubRawResult => ({ kind: 'failed', failure });

const isPositiveInt = (n: number) => Number.isSafeInteger(n) && n >= 1;

/** 分支名或仓内路径 → 逐段编码、段间留 `/`；有空段、`.`、`..` 或不收的字符 = null。 */
function encodedPath(path: string): string | null {
  if (typeof path !== 'string') return null;
  const segments = path.split('/');
  if (segments.some((s) => s === '' || s === '.' || s === '..' || UNSAFE_SEGMENT.test(s))) {
    return null;
  }
  try {
    return segments.map((s) => encodeURIComponent(s)).join('/');
  } catch {
    // 落单的代理项（lone surrogate）编码时抛 URIError。
    return null;
  }
}

/** 各函数共有的参数：token、owner、repo、超时、etag（只有条件读有）。不合规的那一个的名字，
 * 都合规 = null。 */
function commonInvalid(
  token: string,
  owner: string,
  repo: string,
  opts: { timeoutMs: number; etag?: string | null },
): string | null {
  if (typeof token !== 'string' || !HEADER_TOKEN.test(token)) return 'token';
  for (const [field, name] of [
    ['owner', owner],
    ['repo', repo],
  ] as const) {
    if (typeof name !== 'string' || !GITHUB_NAME.test(name) || name === '.' || name === '..') {
      return field;
    }
  }
  if (!isPositiveInt(opts.timeoutMs)) return 'timeoutMs';
  if (opts.etag !== undefined && opts.etag !== null && !HEADER_TOKEN.test(opts.etag)) return 'etag';
  return null;
}

function pageInvalid(opts: GithubPageOpts): string | null {
  if (!isPositiveInt(opts.page)) return 'page';
  if (!Number.isSafeInteger(opts.perPage) || opts.perPage < 1 || opts.perPage > 100) {
    return 'perPage';
  }
  return null;
}

/** 非 2xx 应答体里 GitHub 的 message：去控制字符与格式字符（换行、双向覆盖、零宽字符），
 * 至多 MESSAGE_MAX 个字符；体不是 JSON 对象、没有 message 或清理后为空 = null。 */
function githubMessage(text: string): string | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  const message = (data as { message?: unknown } | null)?.message;
  if (typeof message !== 'string') return null;
  const clean = Array.from(message.replace(UNSAFE_MESSAGE, ' ').trim())
    .slice(0, MESSAGE_MAX)
    .join('');
  return clean === '' ? null : clean;
}

/** 闸传输的单次请求。参数已核过；url 不含 token。 */
async function gateRequest(
  fetchImpl: FetchLike,
  token: string,
  url: string,
  req: {
    method: 'GET' | 'POST';
    etag: string | null;
    payload: Record<string, unknown> | null;
    timeoutMs: number;
  },
): Promise<GithubRawResult> {
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await fetchImpl(url, {
      method: req.method,
      headers: {
        ...authHeaders(token),
        ...(req.etag !== null ? { 'if-none-match': req.etag } : {}),
        ...(req.payload !== null ? { 'content-type': 'application/json' } : {}),
      },
      ...(req.payload !== null ? { body: JSON.stringify(req.payload) } : {}),
      signal: AbortSignal.timeout(req.timeoutMs),
    });
  } catch (err) {
    return failedResult({ kind: isAbort(err) ? 'timeout' : 'network' });
  }
  // 304 只在发了 If-None-Match 时是「与你手上的一样」；没发 etag 的 304 按其余状态码交回。
  if (res.status === 304 && req.etag !== null) return { kind: 'not-modified' };
  if (!res.ok) {
    // 应答体只读一次：限流的文本判据与 message 共用这一份；读不到按空文本。
    const text = await res.text().catch(() => '');
    if (isRateLimited(res) || (res.status === 403 && /rate limit/i.test(text))) {
      const reset = headerSeconds(res.headers, 'x-ratelimit-reset');
      return failedResult({
        kind: 'rate-limited',
        status: res.status,
        resetAt: reset === null ? null : reset * 1000,
        retryAfterSeconds: headerSeconds(res.headers, 'retry-after'),
      });
    }
    return failedResult({ kind: 'status', status: res.status, message: githubMessage(text) });
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch (err) {
    return failedResult({ kind: isAbort(err) ? 'timeout' : 'not-json' });
  }
  return {
    kind: 'ok',
    status: res.status,
    etag: res.headers.get('etag'),
    link: res.headers.get('link'),
    body,
  };
}

/** 闸传输的 URL。path 已逐段编码；query 的值都已核过（正整数、`latest`/`all`、40 位 SHA），
 * 不需再编码。 */
const gateUrl = (
  owner: string,
  repo: string,
  path: string,
  query?: Record<string, string | number>,
) =>
  `https://api.github.com/${repoPath(owner, repo)}/${path}` +
  (query === undefined
    ? ''
    : `?${Object.entries(query)
        .map(([k, v]) => `${k}=${v}`)
        .join('&')}`);

/** PR 原样读（`GET repos/{o}/{r}/pulls/{n}`）。 */
export async function githubPullRaw(
  fetchImpl: FetchLike,
  token: string,
  owner: string,
  repo: string,
  prNumber: number,
  opts: GithubConditionalOpts,
): Promise<GithubRawResult> {
  const bad =
    commonInvalid(token, owner, repo, opts) ?? (isPositiveInt(prNumber) ? null : 'prNumber');
  if (bad !== null) return invalidResult(bad);
  return gateRequest(fetchImpl, token, gateUrl(owner, repo, `pulls/${prNumber}`), {
    method: 'GET',
    etag: opts.etag,
    payload: null,
    timeoutMs: opts.timeoutMs,
  });
}

/** 分支原样读（`GET repos/{o}/{r}/branches/{branch}`：分支头提交与 protection 摘要）。 */
export async function githubBranchRaw(
  fetchImpl: FetchLike,
  token: string,
  owner: string,
  repo: string,
  branch: string,
  opts: GithubConditionalOpts,
): Promise<GithubRawResult> {
  const bad = commonInvalid(token, owner, repo, opts);
  if (bad !== null) return invalidResult(bad);
  const path = encodedPath(branch);
  if (path === null) return invalidResult('branch');
  return gateRequest(fetchImpl, token, gateUrl(owner, repo, `branches/${path}`), {
    method: 'GET',
    etag: opts.etag,
    payload: null,
    timeoutMs: opts.timeoutMs,
  });
}

/** 分支上生效的规则集规则原样读（`GET repos/{o}/{r}/rules/branches/{branch}`，一页）。 */
export async function githubBranchRulesRaw(
  fetchImpl: FetchLike,
  token: string,
  owner: string,
  repo: string,
  branch: string,
  opts: GithubConditionalOpts & GithubPageOpts,
): Promise<GithubRawResult> {
  const bad = commonInvalid(token, owner, repo, opts) ?? pageInvalid(opts);
  if (bad !== null) return invalidResult(bad);
  const path = encodedPath(branch);
  if (path === null) return invalidResult('branch');
  const url = gateUrl(owner, repo, `rules/branches/${path}`, {
    per_page: opts.perPage,
    page: opts.page,
  });
  return gateRequest(fetchImpl, token, url, {
    method: 'GET',
    etag: opts.etag,
    payload: null,
    timeoutMs: opts.timeoutMs,
  });
}

/** 三点 compare 的一页原样读（`GET repos/{o}/{r}/compare/{base}...{head}`），两头都按 SHA
 * 请求。不发条件读：闸要每一页都是按同一对 SHA 现读的（#1479 的外壳契约）。 */
export async function githubCompareRaw(
  fetchImpl: FetchLike,
  token: string,
  owner: string,
  repo: string,
  baseSha: string,
  headSha: string,
  opts: GithubRawOpts & GithubPageOpts,
): Promise<GithubRawResult> {
  const bad =
    commonInvalid(token, owner, repo, opts) ??
    (GATE_SHA.test(baseSha) ? null : 'base') ??
    (GATE_SHA.test(headSha) ? null : 'head') ??
    pageInvalid(opts);
  if (bad !== null) return invalidResult(bad);
  const url = gateUrl(owner, repo, `compare/${baseSha}...${headSha}`, {
    per_page: opts.perPage,
    page: opts.page,
  });
  return gateRequest(fetchImpl, token, url, {
    method: 'GET',
    etag: null,
    payload: null,
    timeoutMs: opts.timeoutMs,
  });
}

/** 一个提交上的 check runs 一页原样读（`GET repos/{o}/{r}/commits/{sha}/check-runs`），按
 * SHA 读，filter 由调用方给。 */
export async function githubCheckRunsRaw(
  fetchImpl: FetchLike,
  token: string,
  owner: string,
  repo: string,
  sha: string,
  opts: GithubConditionalOpts & GithubPageOpts & { filter: 'latest' | 'all' },
): Promise<GithubRawResult> {
  const bad =
    commonInvalid(token, owner, repo, opts) ??
    (GATE_SHA.test(sha) ? null : 'sha') ??
    pageInvalid(opts) ??
    (opts.filter === 'latest' || opts.filter === 'all' ? null : 'filter');
  if (bad !== null) return invalidResult(bad);
  const url = gateUrl(owner, repo, `commits/${sha}/check-runs`, {
    filter: opts.filter,
    per_page: opts.perPage,
    page: opts.page,
  });
  return gateRequest(fetchImpl, token, url, {
    method: 'GET',
    etag: opts.etag,
    payload: null,
    timeoutMs: opts.timeoutMs,
  });
}

/** 一个提交的 combined status 一页原样读（`GET repos/{o}/{r}/commits/{sha}/status`），按 SHA 读。 */
export async function githubCombinedStatusRaw(
  fetchImpl: FetchLike,
  token: string,
  owner: string,
  repo: string,
  sha: string,
  opts: GithubConditionalOpts & GithubPageOpts,
): Promise<GithubRawResult> {
  const bad =
    commonInvalid(token, owner, repo, opts) ??
    (GATE_SHA.test(sha) ? null : 'sha') ??
    pageInvalid(opts);
  if (bad !== null) return invalidResult(bad);
  const url = gateUrl(owner, repo, `commits/${sha}/status`, {
    per_page: opts.perPage,
    page: opts.page,
  });
  return gateRequest(fetchImpl, token, url, {
    method: 'GET',
    etag: opts.etag,
    payload: null,
    timeoutMs: opts.timeoutMs,
  });
}

/** 某提交上一个仓内路径的原样读（`GET repos/{o}/{r}/contents/{path}?ref={sha}`；目录给条目
 * 列表）。ref 只收 40 位 SHA。不发条件读。 */
export async function githubContentsRaw(
  fetchImpl: FetchLike,
  token: string,
  owner: string,
  repo: string,
  path: string,
  ref: string,
  opts: GithubRawOpts,
): Promise<GithubRawResult> {
  const bad = commonInvalid(token, owner, repo, opts) ?? (GATE_SHA.test(ref) ? null : 'ref');
  if (bad !== null) return invalidResult(bad);
  const encoded = encodedPath(path);
  if (encoded === null) return invalidResult('path');
  return gateRequest(fetchImpl, token, gateUrl(owner, repo, `contents/${encoded}`, { ref }), {
    method: 'GET',
    etag: null,
    payload: null,
    timeoutMs: opts.timeoutMs,
  });
}

/** 在提交上写一条 commit status（`POST repos/{o}/{r}/statuses/{sha}`）。请求体恰好是
 * {state, context, description}，不带 target_url；描述的长度与内容由调用方定。不重试，
 * 失败按分类交回（422 = GitHub 拒收，例如同一 SHA 与 context 已满 1000 条）。 */
export async function githubCreateCommitStatus(
  fetchImpl: FetchLike,
  token: string,
  owner: string,
  repo: string,
  sha: string,
  status: { state: GithubCommitStatusState; context: string; description: string },
  opts: GithubRawOpts,
): Promise<GithubRawResult> {
  const states: readonly string[] = GITHUB_COMMIT_STATUS_STATES;
  const bad =
    commonInvalid(token, owner, repo, opts) ??
    (GATE_SHA.test(sha) ? null : 'sha') ??
    (states.includes(status.state) ? null : 'state') ??
    (typeof status.context === 'string' && status.context !== '' ? null : 'context') ??
    (typeof status.description === 'string' ? null : 'description');
  if (bad !== null) return invalidResult(bad);
  return gateRequest(fetchImpl, token, gateUrl(owner, repo, `statuses/${sha}`), {
    method: 'POST',
    etag: null,
    payload: { state: status.state, context: status.context, description: status.description },
    timeoutMs: opts.timeoutMs,
  });
}

// —— OAuth token 交换面（#231 握手：callback 收码后唯一一次出站）———————————

export interface OAuthExchangeInput {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  code: string;
  /** 与 authorize 期发出的 redirect_uri 同值（GitHub 校验一致）。 */
  redirectUri: string;
}

/** token 交换应答（#361：granted scope 随 access_token 一并回——GitHub
 * OAuth App 的 token 应答带 scope 字段（逗号分隔 granted 面），订阅族不消费、
 * connection 族落 github_connection.scope 列）。 */
export interface OAuthTokenExchange {
  accessToken: string;
  /** 上游应答原样（缺字段 = ''）。 */
  scope: string;
}

/** 授权码 → access_token。错误映射（callback 路由把 502 族转译成 302 error
 * 回跳，services/oauth.ts）：fetch reject/超时 → 502 unreachable；上游非 ok
 * → 502 upstream <status>；200 缺 access_token → 502 no access_token。 */
export async function exchangeOAuthCode(
  fetchImpl: FetchLike,
  input: OAuthExchangeInput,
): Promise<OAuthTokenExchange> {
  const body = new URLSearchParams({
    client_id: input.clientId,
    client_secret: input.clientSecret,
    code: input.code,
    redirect_uri: input.redirectUri,
  }).toString();
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await fetchImpl(input.tokenUrl, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/x-www-form-urlencoded',
        'user-agent': USER_AGENT,
      },
      body,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    throw new HttpError(502, `oauth token exchange unreachable: ${why}`);
  }
  if (!res.ok) {
    throw new HttpError(502, `oauth token exchange upstream ${res.status}`);
  }
  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    throw new HttpError(502, 'oauth token exchange returned non-json');
  }
  const token = (payload as { access_token?: unknown }).access_token;
  if (typeof token !== 'string' || token === '') {
    throw new HttpError(502, 'oauth token exchange returned no access_token');
  }
  const scope = (payload as { scope?: unknown }).scope;
  return { accessToken: token, scope: typeof scope === 'string' ? scope : '' };
}
