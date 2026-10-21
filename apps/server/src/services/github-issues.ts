// GitHub issue 读面服务（#446 / ADR 0005 读向 + #452 / ADR 0006 回显/护栏）：
// 项目页「从 GitHub issue 建任务」的两个消费位——issue 列表代理 + 导入建
// 任务；#452 追加导入去重护栏（D4）与详情页来源 issue 只读回显（D5/D6）。
// 纪律：
// - 本模块只读，不在 GitHub 留任何痕迹（写向出站 = services/todos.ts 收口）；
// - token 唯一读出点 = openGithubToken（github-connection.ts），仅经
//   lib/github.ts 出站边界进 Authorization 头（never URL/日志/wire）；
// - 导入面每次现拉 issue 详情与仓库 label 集，不缓存第二真值（ADR 0005
//   premortem 护栏：两个真值源漂移——「仓库改了，pacman 至少不变得更错」）；
// - 先 fetch 后建：上游 404（issue 不存在）直透，不留半成品任务。

import {
  type GithubIssueEcho,
  type GithubIssueState,
  type GithubIssuesResponse,
  githubIssueSourceRef,
  parseGithubIssueSourceRef,
  type SecretBox,
  type TodoRecord,
} from '@pacman/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { type project as projectTable, todo as todoTable } from '../db/schema.js';
import { HttpError, notFound } from '../lib/errors.js';
import type { FetchLike } from '../lib/github.js';
import { githubRepoIssue, githubRepoIssues, githubRepoLabels } from '../lib/github.js';
import { openGithubToken } from './github-connection.js';
import { normalizeGithubLabelColor, resolveProjectTagIds, syncGithubLabels } from './tags.js';
import { createTodo, type TodoDeps } from './todos.js';

type ProjectRow = typeof projectTable.$inferSelect;

export interface GithubIssueFaceDeps {
  db: Db;
  box: SecretBox;
  /** GitHub 出站注入位（AppContext.githubFetch 同族；缺省 globalThis.fetch，
   * 测试注入 mock——零真实出站）。 */
  githubFetch?: FetchLike;
}

/** 形态闸：仅 github 形态项目有 issue 读面；其余形态一律 404（不 500、
 * 不出站）。owner/repo 拆自 githubRepo 列（建项目时已过 isGithubRepoRef
 * 400 闸，lib 层出站再 encodeURIComponent 双保险）。 */
function requireGithubRepo(row: ProjectRow): { owner: string; repo: string } {
  if (row.repoKind !== 'github' || row.githubRepo === null) {
    throw notFound('github issues');
  }
  const slash = row.githubRepo.indexOf('/');
  return { owner: row.githubRepo.slice(0, slash), repo: row.githubRepo.slice(slash + 1) };
}

/** 连接闸：未连接 = 404 `github connection not found`（GET /api/github/repos
 * 代理同语义——web 面据 404 不亮入口，不报错不空白）。 */
function requireToken(deps: GithubIssueFaceDeps, teamId: string): string {
  const token = openGithubToken({ db: deps.db, box: deps.box }, teamId);
  if (token === null) throw notFound('github connection');
  return token;
}

/** 已占用来源引用集（ADR 0006 D4 导入护栏，pacman 侧反查）：本团队已落库
 * 的 sourceRef 全集——「一条 issue 至多一个任务」同时盖住自建的 issue 与
 * 导入过的 issue，不在 GitHub 侧打标记 label。#1406：按小写比、回小写集
 * （GitHub 的 owner / repo 不分大小写，两个项目把同一仓写成不同大小写时，
 * github:Acme/App#5 与 github:acme/app#5 是同一条 issue；调用方按
 * ref.toLowerCase() 查）。 */
function claimedSourceRefs(db: Db, teamId: string, refs: string[]): Set<string> {
  if (refs.length === 0) return new Set();
  const rows = db
    .select({ sourceRef: todoTable.sourceRef })
    .from(todoTable)
    .where(
      and(
        eq(todoTable.teamId, teamId),
        inArray(
          sql`lower(${todoTable.sourceRef})`,
          refs.map((r) => r.toLowerCase()),
        ),
      ),
    )
    .all();
  return new Set(
    rows.map((r) => r.sourceRef?.toLowerCase()).filter((v): v is string => v !== undefined),
  );
}

/** issue 列表（项目页选择器数据面）：state/page 直透上游同名参数，
 * hasMore = Link 头 rel="next"（lib 层判定）。封套 = shared
 * githubIssuesResponseSchema 单源（routes 层 parse 后出线）。
 * #452：出线前按已落库来源反查滤除——已有任务的 issue 不入导入列表
 * （AC5；hasMore 仍取上游值，滤除只收窄本页条目，翻页语义不变）。 */
export async function listProjectGithubIssues(
  deps: GithubIssueFaceDeps,
  row: ProjectRow,
  opts: { state: GithubIssueState; page: number },
): Promise<GithubIssuesResponse> {
  const { owner, repo } = requireGithubRepo(row);
  const token = requireToken(deps, row.teamId);
  const fetchImpl = deps.githubFetch ?? fetch;
  const { issues, hasMore } = await githubRepoIssues(fetchImpl, token, owner, repo, opts);
  const claimed = claimedSourceRefs(
    deps.db,
    row.teamId,
    issues.map((issue) => githubIssueSourceRef(owner, repo, issue.number)),
  );
  // 颜色归一在出线前单点做（与 tag 表镜像同源规则）：wire 面恒 #rrggbb，
  // 消费端不再各自补 #。
  return {
    issues: issues
      .filter(
        (issue) => !claimed.has(githubIssueSourceRef(owner, repo, issue.number).toLowerCase()),
      )
      .map((issue) => ({
        ...issue,
        labels: issue.labels.map((label) => ({
          name: label.name,
          color: normalizeGithubLabelColor(label.color),
        })),
      })),
    page: opts.page,
    hasMore,
  };
}

/** 导入面 deps = 读面（box 必携）∪ todo 面（box 位由读面收编——可选位与
 * 必携位同名冲突，Omit 后交集成立）。 */
export type ImportGithubIssueDeps = GithubIssueFaceDeps & Omit<TodoDeps, 'box'>;

/** #1406 进程内导入占位（团队 × 小写 sourceRef → 项目 id；同 claimedSourceRefs
 * 按小写认同一条 issue）。claimedSourceRefs 是应用层检查、todo.sourceRef 无唯一
 * 约束，导入在检查与 createTodo 之间要等两次 GitHub 读：webhook 与 issue 轮询器
 * 同时导入同一 issue 时两路都能过检查、各建一张卡。
 * 占位在第一次 await 之前落下、finally 里释放（建成后由 DB 行接手去重）。
 * 只管单进程（server 单实例；多实例同库不在本闸内）。#1459：占位带项目 id，
 * 在飞上限把还在等 GitHub 读的导入也算进去（importsInFlightFor）。 */
const importsInFlight = new Map<string, string>();

/** 项目里正在导入、还没落行的 issue 数（#1459 在飞上限现数用：检查与占位之间
 * 没有 await，同时到的几路导入合起来不超上限）。 */
export function importsInFlightFor(projectId: string): number {
  let n = 0;
  for (const p of importsInFlight.values()) if (p === projectId) n += 1;
  return n;
}

/** 从 issue 建任务（ADR 0005 D3/D5/D6 落地）：
 * - 标题 = issue 标题原样（不走占位→回填两段式；createTodo 的派生仅对
 *   空白标题兜底，issue 标题非空即原样落库，>50 字符不截断）；
 * - 正文 = issue body（null → 空串）；
 * - 标签 = issue label 全集（「至多 1 个」github 侧作废）：先镜像同步仓库
 *   label 集（缺行建行、色随 GitHub 真值、永不删行），再按 name 解析进
 *   todo_tag——不变式「贴的标签必在本项目标签集内」由同步先行保证；
 * - 来源两列 = 'github-issue' + `github:owner/repo#N`（溯源家族位）；
 * - createdBy 缺省 = seed 用户（人工触发导入 / webhook）；#1406 issue 轮询器
 *   传 chief 绑定的 Agent id（chief 自建卡同一律），关闭对账凭它认自己领的卡。 */
export async function importGithubIssue(
  deps: ImportGithubIssueDeps,
  row: ProjectRow,
  issueNumber: number,
  opts: { createdBy?: string } = {},
): Promise<TodoRecord> {
  const { owner, repo } = requireGithubRepo(row);
  const token = requireToken(deps, row.teamId);
  const fetchImpl = deps.githubFetch ?? fetch;
  // D4 第二道闸（列表滤除是第一道）：直 POST 已有任务的 issue → 409，
  // 「一条 issue 至多一个任务」不因列表竞态窗口破防。
  const ref = githubIssueSourceRef(owner, repo, issueNumber);
  if (claimedSourceRefs(deps.db, row.teamId, [ref]).has(ref.toLowerCase())) {
    throw new HttpError(409, `issue ${ref} already has a task`);
  }
  // #1406：另一路正在导入同一 issue（还在等 GitHub 读）→ 同 409。
  const claim = `${row.teamId}\u0000${ref.toLowerCase()}`;
  if (importsInFlight.has(claim)) {
    throw new HttpError(409, `issue ${ref} is being imported`);
  }
  importsInFlight.set(claim, row.id);
  try {
    const detail = await githubRepoIssue(fetchImpl, token, owner, repo, issueNumber);
    // label 面失败 = 整个导入失败（不落半成品词表）；同名条目 issue 集后置
    // 覆盖色（更新鲜）。
    const repoLabels = await githubRepoLabels(fetchImpl, token, owner, repo);
    syncGithubLabels(deps.db, row.id, [...repoLabels, ...detail.labels]);
    const names = [...new Set(detail.labels.map((l) => l.name))];
    const resolved = resolveProjectTagIds(deps.db, row.id, names);
    const tagIds = names
      .map((name) => resolved.get(name))
      .filter((id): id is string => id !== undefined);
    return createTodo(deps, {
      teamId: row.teamId,
      projectId: row.id,
      title: detail.title,
      spec: detail.body ?? '',
      tagIds,
      createdBy: opts.createdBy ?? deps.user.id, // 缺省 = seed 用户（REST 建任务面同律）
      ownerId: deps.user.id,
      sourceKind: 'github-issue',
      sourceRef: ref,
    });
  } finally {
    importsInFlight.delete(claim);
  }
}

/** 来源 issue 只读回显（#452 / ADR 0006 D5/D6）：任务详情页进入时拉一次，
 * 显示 issue 当前标题与状态。**任何拉不到都是非 200**（无来源/未建成 = 404、
 * 未连接 = 404、issue 被删 = 上游 404 直透、限流 = 429、网络 = 502）——web
 * 侧据非 200 整行隐藏，不显示陈旧值、不弹错。不一致的判定与「只提示不覆
 * 盖」在 web 消费面做，本函数只回上游现值。 */
export async function readSourceIssueEcho(
  deps: GithubIssueFaceDeps,
  todoId: string,
): Promise<GithubIssueEcho> {
  const row = deps.db
    .select({
      teamId: todoTable.teamId,
      sourceKind: todoTable.sourceKind,
      sourceRef: todoTable.sourceRef,
    })
    .from(todoTable)
    .where(eq(todoTable.id, todoId))
    .get();
  if (!row || row.sourceKind === null || row.sourceRef === null) {
    throw notFound('source issue');
  }
  const parsed = parseGithubIssueSourceRef(row.sourceRef);
  if (!parsed) throw notFound('source issue');
  const token = requireToken(deps, row.teamId);
  const detail = await githubRepoIssue(
    deps.githubFetch ?? fetch,
    token,
    parsed.owner,
    parsed.repo,
    parsed.issueNumber,
  );
  return { number: detail.number, title: detail.title, state: detail.state };
}
