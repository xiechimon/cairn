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
// 写面（#452 / ADR 0006——server 唯二的 api.github.com 写入点，穷举律：
// grep `api.github.com` 的 POST/PATCH 只此两处；不改 scope、不新增凭证面）：
// - POST repos/{o}/{r}/issues → 自派任务建时建 issue（关键路径之外触发）
// - PATCH repos/{o}/{r}/issues/{n} → agent 回填标题写进 issue
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
 * SHA、base 分支与仓库默认分支。 */
export interface GithubPull extends GithubPullState {
  /** merged 时 = squash/merge 落在 base 上的提交；未合并恒 null。 */
  mergeCommitSha: string | null;
  /** merged 时合并者的 login；未合并或响应缺失 = null。 */
  mergedBy: string | null;
  /** PR head 分支当前的提交（合并后 = 合并时的 head）；响应缺失 = null。 */
  headSha: string | null;
  /** PR 的目标分支（base.ref）与仓库默认分支（base.repo.default_branch）；缺失 = null。 */
  baseRef: string | null;
  defaultBranch: string | null;
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
    head?: { sha?: unknown } | null;
    base?: { ref?: unknown; repo?: { default_branch?: unknown } | null } | null;
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
      baseRef: typeof raw.base?.ref === 'string' ? raw.base.ref : null,
      defaultBranch:
        typeof raw.base?.repo?.default_branch === 'string' ? raw.base.repo.default_branch : null,
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
  if (
    res.status === 429 ||
    (res.status === 403 &&
      (res.headers.get('x-ratelimit-remaining') === '0' ||
        // 二级限流（abuse/secondary）：403 无 remaining 头、带 retry-after。
        res.headers.get('retry-after') !== null))
  ) {
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
