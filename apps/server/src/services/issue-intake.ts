// #1406 P5a-1 issue 进料轮询器（spec 28 §4 P5a + D5）：scheduler 家族的第二个
// 网络循环（5 分钟一轮，与 ci-loop 的 60s 分道；tick 是同步契约，网络读不进
// tick）。只读 GitHub，不写。
//
// 每轮按团队走：
// 1. token：团队连接 token（无连接 / 密文坏 / box 缺席 = 整队跳过，零匿名读——
//    匿名 60/h 的 IP 预算归 ci-loop 与 #931，importGithubIssue 本就要 token）。
// 2. 关闭对账：本队轮询器领的 github-issue 卡（createdBy = 本队 chief 绑定的
//    Agent id，导入时写入；手工导入与 webhook 导入是 seed 用户，不碰；chief
//    没绑 Agent = 本队本轮不对账、不清「见过 open」，有可能是轮询器领的卡时
//    记一行），相位不在 done / closed / review、且没有哪个 build 交付过 PR
//    的，逐张条件读 issue state。只认本进程亲眼看到的 open → closed：导入
//    时、或某次读到 open，记为「见过 open」；之后读到 closed，且最新一条
//    closed 事件的 actor 在仓库上是 triage 及以上（与打标人同一判据、同一
//    缓存），才 transitionTodos(closed)——chief / MCP close_todos 的关闭路径
//    （#1445：写相位后停活动步）。首见即 closed 的卡（例：重启后才读到）永不
//    被对账关闭；关过一次即忘掉「见过 open」，有人把卡重开就不再关。外部
//    作者关自己的 issue、任一读失败 = 本轮不关。review 卡与 build 交付过 PR
//    的卡（building 磨绿中 / failed / 重跑中）不归这里关：合并带关闭引用关掉
//    issue 时，那张卡不该以 closed 收尾。眼下 PR 侧只有 ci-loop 的 review 期
//    对账（#1414，PR 合并 → done、未合并关闭 → failed）；其余相位的这类卡
//    由 ci-loop 的磨绿推进，或等人处理（spec 28 P2 的后续段）。拆卡父卡还有
//    子卡不在 done / closed 时也不碰（关了它，最后一张子卡 done 时的父卡收口会
//    撞 closed → done 非法边）。
//    写前重读相位、PR 与子卡，变了就不动。
// 3. chief 未绑定（orchestrateTodo 的前置）→ 本队不导入，不建无法编排的卡。
//    绑好的队先重试上几轮导入后编排失败的卡（进程内记次，连同导入那次至多
//    ISSUE_INTAKE_MAX_ORCHESTRATE_ATTEMPTS 次；卡已离开 todo 或导入后已开始
//    编排（编排线程里有 chief 步）= 有人接手，chief 换绑了别的 Agent = 卡已出
//    关闭对账范围，都不再试）。
// 4. 每个 github 项目（githubRepo 形好；同队同仓只取 id 最小的一个）：在飞
//    上限有余量才条件读 open + ready-for-agent 列表（304 复用上轮列表；按 Link
//    rel="next" 翻页，至多 ISSUE_INTAKE_MAX_LIST_PAGES 页），按号升序（最旧
//    先）；团队级已占用的号跳过（大小写不敏感）；D5 核打标人：该标签最新一条
//    labeled 之后没有 unlabeled、不是经 GitHub App 打的（performed_via_github_app
//    在位 = 不领，记一行带 app：经 GitHub App 打标的 agent 会话不能给进料喂它
//    自己开的 issue；OAuth App 令牌（gh auth login 的、团队 GitHub 连接令牌）
//    与 PAT 打的标不带这个字段，与本人亲手打的分不开，这一条拦不住——连接令
//    牌随步下发给 git 与仓内 .agents/setup / resume 钩子），且其 actor 在仓库
//    上是 triage 及以上（events 按 Link rel="next" 至多读
//    ISSUE_INTAKE_MAX_EVENT_PAGES 页，读满仍有下一页 = 读不全；读不全 / 任一
//    读失败 = 本轮不领）；importGithubIssue（409 = 别路已领；createdBy 记 chief
//    绑定的 Agent）→ orchestrateTodo；领到一条记一行日志（打标人）。
//
// 纪律：issue 正文只经 importGithubIssue 进 todo.spec，不进日志、不进系统行；
// 每轮一行对账日志（只有计数）；单卡 / 单项目 / 单队异常不杀整轮；本模块自己
// 的 GitHub 读（列表 / events / permission / issue 状态）遇限流（429 / 带限流
// 信号的 403）= 本队本轮停读、记一行（有重置时刻就带上；同一 token 再读只会
// 再被拒）——importGithubIssue 自己的读遇限流抛 HttpError，按导入失败记；
// 上一轮没跑完时新触发直接返回（不重叠）。
//
// #1459：webhook 的 `pacman` 触发按同一 D5 判据核打标人（事件的 sender）、
// 计入同一在飞上限。三样两路共用：团队 token（teamGithubToken，github-connection.ts）、
// 打标人权限读与缓存（hasRepoTriage，缓存是进程里唯一一份，轮询器开没开都在；
// 限流照常抛 GithubRateLimitedError，不进缓存，webhook 自己接住）、在飞现数
// （projectAtInFlightCap，含还在等 GitHub 读的导入）。

import {
  githubIssueSourceRef,
  orchestrateThreadTitle,
  type Phase,
  parseGithubIssueSourceRef,
  type SecretBox,
} from '@pacman/shared';
import {
  and,
  asc,
  eq,
  exists,
  gte,
  isNotNull,
  like,
  notExists,
  notInArray,
  or,
  sql,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import type { Db } from '../db/client.js';
import { build, chiefThread, project, step, todo } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import {
  type FetchLike,
  type GithubConditionalRead,
  type GithubIssueEvent,
  type GithubIssueEventsPage,
  type GithubLabeledIssuesPage,
  GithubRateLimitedError,
  type GithubRepoPermission,
  githubCollaboratorPermission,
  githubIssueEvents,
  githubIssueState,
  githubOpenIssuesWithLabel,
} from '../lib/github.js';
import { nowMs } from '../lib/ids.js';
import type { BuildDeps } from './builds.js';
import { chiefBinding } from './chief.js';
import { type TransitionActor, transitionTodos } from './chief-tools.js';
import { githubRepoOfProject } from './git.js';
import { teamGithubToken } from './github-connection.js';
import { importGithubIssue, importsInFlightFor } from './github-issues.js';
import { orchestrateTodo } from './orchestrate.js';

/** 轮询节奏（spec 28 §4 P5a：5 分钟）。 */
export const ISSUE_INTAKE_INTERVAL_MS = 300_000;

/** 领票标签（spec 28 D5）。 */
export const ISSUE_INTAKE_LABEL = 'ready-for-agent';

/** 项目级在飞上限（spec 28 §4 P5a 默认 3）。 */
export const ISSUE_INTAKE_IN_FLIGHT_CAP = 3;

/** 候选列表至多读几页（每页 100，按创建时间升序）：最旧的一批全被占用或不认
 * 时，后面的 issue 仍轮得到；再往后的记 listTruncated。 */
export const ISSUE_INTAKE_MAX_LIST_PAGES = 3;

/** issue 事件至多读几页（每页 100，升序）：引用多的长票（每个提到它的提交都
 * 是一条 referenced 事件）过百很常见；再往后仍有下一页 = 读不全，不动。 */
export const ISSUE_INTAKE_MAX_EVENT_PAGES = 5;

/** permission 答案缓存时长（按 团队 × 仓 × login）：3 轮内不重读；权限被收回
 * 最多晚这么久生效（webhook 同此）。 */
export const ISSUE_INTAKE_PERMISSION_TTL_MS = 15 * 60_000;

/** 导入后编排至多试几次（连同导入那一次）：之后记一行放弃，卡留在 todo、
 * 占着上限位，等人开始或关闭。次数记在进程内存，重启即忘。 */
export const ISSUE_INTAKE_MAX_ORCHESTRATE_ATTEMPTS = 3;

/** D5 认可的打标人：role_name 是这几个之一，或 legacy permission 是 write /
 * admin（maintain 映射为 write），或 user.permissions.triage 为真（继承 triage
 * 的自定义角色）。legacy permission 的 read 同时盖住 read 与 triage，所以
 * triage 只能从 role_name / user.permissions 认出来。 */
const LABELER_ROLES = new Set(['triage', 'write', 'maintain', 'admin']);
const LABELER_BASE_PERMISSIONS = new Set(['write', 'admin']);

/** 在飞上限不计的相位。failed 计入：失败卡仍挂在项目上等人处理，不再多领。 */
const NOT_IN_FLIGHT: Phase[] = ['done', 'closed'];

/** 关闭对账不碰的相位：done / closed 已终态；review 是人审关口，进料不关
 * （交付过 PR 的 review 卡由 #1414 的 PR 对账收尾，没 PR 的等人）。
 * 相位之外还有两条：任一 build 交付过 PR 的卡（见 noDeliveredPr）、还有子卡
 * 没收完的拆卡父卡（见 noOpenChildren）也不碰。 */
const CLOSE_RECONCILE_SKIPPED: Phase[] = ['done', 'closed', 'review'];

/** 拆卡子卡收完的相位（父卡在这之外有子卡 = 子卡还在跑）。 */
const CHILD_SETTLED: Phase[] = ['done', 'closed'];

/** 子卡表别名（父卡查询里的相关子查询：子卡 sourceTodo = 父卡 id）。 */
const childTodo = alias(todo, 'child_todo');

/** 关闭对账的流转主体（agent 档：不能自过 confirm / review 闸，关闭不受影响）。 */
const ISSUE_INTAKE_ACTOR: TransitionActor = { kind: 'agent', name: 'GitHub issue intake' };

export interface IssueIntakeLogger {
  info(obj: object, msg: string): void;
}

/** 每轮对账计数（日志行 'issue intake sweep'）。 */
export interface IssueIntakeTally {
  teams: number;
  /** 读过（或试读）候选列表的 github 项目数。 */
  projects: number;
  /** 跳过的项目：无 token / 密文坏 / chief 未绑定 / githubRepo 形坏 / 同仓重复 /
   * 列表读不到。 */
  skipped: number;
  /** 列表 304，复用上轮列表（按页计）。 */
  listNotModified: number;
  /** 读满 ISSUE_INTAKE_MAX_LIST_PAGES 页仍有下一页的项目数。 */
  listTruncated: number;
  candidates: number;
  /** 已被占用（团队里已有这条 issue 的卡，或导入时 409）。 */
  claimed: number;
  /** 上限已满，留到下一轮的候选。 */
  atCap: number;
  /** D5 不认（打标人权限不足 / 最新标签事件是摘标 / 读不全 / 账号已删）。 */
  notEligible: number;
  /** events 或 permission 读不到：本轮不领，下轮重读。 */
  unverifiable: number;
  imported: number;
  /** 编排成功的卡（导入时那次，加上重试上几轮编排失败的卡）。 */
  orchestrated: number;
  /** issue 已关 → 卡已关。 */
  closed: number;
  /** 对账本轮不动：issue 状态读不到；或见过 open 的 issue 读到 closed，但
   * events / permission 读不到、events 读不全、关闭人不到 triage 或账号已删、
   * 写前相位变了、build 交付了 PR 或有了没收完的子卡。 */
  closeSkipped: number;
  /** 本轮遇限流停读的团队。 */
  rateLimited: number;
  errors: number;
}

export interface IssueIntake {
  /** 单轮。上一轮还在跑时返回 null（不重叠）。 */
  sweep(now?: number): Promise<IssueIntakeTally | null>;
}

type ProjectRow = typeof project.$inferSelect;

/** 该标签最新一条 labeled 经 GitHub App 打的：不领，打标人与 app 记进日志。 */
interface AppLabel {
  reason: 'label-via-app';
  labeler: string | null;
  viaApp: string;
}

/** D5 判定：可领时即打标人；不领时带理由。 */
type Verdict =
  | { labeler: string }
  | ({ notTaken: 'not-eligible' } & AppLabel)
  | { notTaken: 'not-eligible' | 'unverifiable'; reason: string };

/** 关闭对账的一张卡（轮询器领的、相位与 PR 都还在对账范围内）。 */
interface ReconcileRow {
  id: string;
  phase: Phase;
  sourceRef: string;
}

/** 本队一张可能要对账的 github-issue 卡，带 createdBy（认是不是轮询器领的）。 */
interface IssueTaskRow extends ReconcileRow {
  createdBy: string | null;
}

/** 团队这一轮的读权与导入署名：连接 token、密文 box、导入卡的 createdBy
 * （chief 绑定的 Agent id——关闭对账凭它认轮询器领的卡）。 */
interface TeamAccess {
  token: string;
  box: SecretBox;
  createdBy: string;
}

/** 导入后编排的一次尝试：团队、导入时刻（认「导入之后建的编排线程」）、
 * 连同这次已试的次数。 */
interface OrchestrateAttempt {
  teamId: string;
  importedAt: number;
  attempts: number;
}

function emptyTally(): IssueIntakeTally {
  return {
    teams: 0,
    projects: 0,
    skipped: 0,
    listNotModified: 0,
    listTruncated: 0,
    candidates: 0,
    claimed: 0,
    atCap: 0,
    notEligible: 0,
    unverifiable: 0,
    imported: 0,
    orchestrated: 0,
    closed: 0,
    closeSkipped: 0,
    rateLimited: 0,
    errors: 0,
  };
}

/** ETag 缓存（进程内存；重启失缓存 = 下轮多一次全量读，无害）。 */
type EtagCache<T> = Map<string, { etag: string | null; data: T }>;

/** 条件读结果落缓存：304 复用缓存，新内容写进缓存；读不到（或 304 却没有
 * 缓存）= null。 */
function settle<T>(cache: EtagCache<T>, key: string, page: GithubConditionalRead<T> | null) {
  if (page === null) return null;
  if (page.notModified) return cache.get(key)?.data ?? null;
  cache.set(key, { etag: page.etag, data: page.data });
  return page.data;
}

/** 条件读要带的 ETag：满页不带（满页之后长出的下一页不改它的内容，304 会
 * 带回过时的 next / complete）。 */
function etagFor<T extends { full: boolean }>(cache: EtagCache<T>, key: string): string | null {
  const hit = cache.get(key);
  return hit !== undefined && !hit.data.full ? hit.etag : null;
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** 事件先后：created_at，同刻按 id（不信数组位置）。 */
function later(a: GithubIssueEvent, b: GithubIssueEvent): boolean {
  return a.at > b.at || (a.at === b.at && a.id > b.id);
}

/** 读到的事件历史（多页拼起来）；complete = 读到了最后一页。 */
interface IssueHistory {
  events: GithubIssueEvent[];
  complete: boolean;
}

/** 满足条件的事件里最新的一条。 */
function newestOf(
  events: GithubIssueEvent[],
  match: (e: GithubIssueEvent) => boolean,
): GithubIssueEvent | null {
  let newest: GithubIssueEvent | null = null;
  for (const e of events) if (match(e) && (newest === null || later(e, newest))) newest = e;
  return newest;
}

/** D5 第一半：该标签最新一条 labeled 的 actor（之后有 unlabeled / 读不全 /
 * 没有 labeled / 经 app 打的 / 账号已删 → 不领的理由）。经 app 打的标不算人
 * 打的：用户授权的 app 令牌下 actor 是授权的人，只看 actor 分不开 app 与本人。
 * OAuth App 令牌与 PAT 不填 performed_via_github_app（gh 用哪种令牌就是哪种），
 * 经它们打的标与本人打的一样，这里拦不住。顺序按 created_at，同刻按 id，不信
 * 数组位置。 */
function newestLabeler(data: IssueHistory): { labeler: string } | AppLabel | { reason: string } {
  if (!data.complete) return { reason: 'events-incomplete' };
  const forLabel = (kind: 'labeled' | 'unlabeled') => (e: GithubIssueEvent) =>
    e.event === kind && e.label?.toLowerCase() === ISSUE_INTAKE_LABEL;
  const labeled = newestOf(data.events, forLabel('labeled'));
  const unlabeled = newestOf(data.events, forLabel('unlabeled'));
  if (labeled === null) return { reason: 'no-labeled-event' };
  if (unlabeled !== null && later(unlabeled, labeled)) return { reason: 'label-removed' };
  if (labeled.viaApp !== null) {
    return { reason: 'label-via-app', labeler: labeled.actor, viaApp: labeled.viaApp };
  }
  if (labeled.actor === null) return { reason: 'labeler-deleted' };
  return { labeler: labeled.actor };
}

/** 项目在飞已满：库里不在 done / closed 的 github-issue 卡，加上正在导入、还在
 * 等 GitHub 读的（importGithubIssue 的占位），到了 ISSUE_INTAKE_IN_FLIGHT_CAP。
 * 每次导入前现数：现数与 importGithubIssue 落占位之间不隔 await，同时到的几路
 * 导入（webhook 批量投递、轮询器）合起来不超上限。 */
export function projectAtInFlightCap(db: Db, projectId: string): boolean {
  const inFlight =
    db
      .select({ n: sql<number>`count(*)` })
      .from(todo)
      .where(
        and(
          eq(todo.projectId, projectId),
          eq(todo.sourceKind, 'github-issue'),
          notInArray(todo.phase, NOT_IN_FLIGHT),
        ),
      )
      .get()?.n ?? 0;
  return inFlight + importsInFlightFor(projectId) >= ISSUE_INTAKE_IN_FLIGHT_CAP;
}

/** permission 答案缓存（按 团队 × 仓 × login，小写）：模块级，进程里唯一一份，
 * 轮询器与 webhook 共用（一路读到的答案另一路 TTL 内直接用）。读不到不进缓存
 * （下次重读）；404 是明确的否定答案，照常缓存。过期项每次读时顺手清。 */
const permissionCache = new Map<string, { at: number; permission: GithubRepoPermission }>();

/** login 在仓库上是不是 triage 及以上（D5 打标人、关闭人、webhook sender 同一
 * 判据）；null = 读不到。 */
export async function hasRepoTriage(
  githubFetch: FetchLike,
  teamId: string,
  token: string,
  owner: string,
  repo: string,
  login: string,
  now: number,
): Promise<boolean | null> {
  for (const [key, hit] of permissionCache) {
    if (now - hit.at >= ISSUE_INTAKE_PERMISSION_TTL_MS) permissionCache.delete(key);
  }
  const key = `${teamId}\u0000${owner}/${repo}\u0000${login}`.toLowerCase();
  let p: GithubRepoPermission | null = permissionCache.get(key)?.permission ?? null;
  if (p === null) {
    p = await githubCollaboratorPermission(githubFetch, token, owner, repo, login);
    if (p === null) return null;
    permissionCache.set(key, { at: now, permission: p });
  }
  return (
    LABELER_BASE_PERMISSIONS.has(p.permission) ||
    (p.roleName !== null && LABELER_ROLES.has(p.roleName)) ||
    p.triage === true
  );
}

export function createIssueIntake(
  deps: BuildDeps,
  run: { githubFetch: FetchLike; logger?: IssueIntakeLogger },
): IssueIntake {
  const log = (obj: object, msg: string) => run.logger?.info(obj, msg);
  // 缓存键都带 teamId：不同团队的 token 看到的表示可能不同（应答 Vary:
  // Authorization）。
  const listCache: EtagCache<GithubLabeledIssuesPage> = new Map();
  // events 缓存按页：键 = issue 键 + \u0001 + 页 URL（第一页 'first'）。
  const eventsCache: EtagCache<GithubIssueEventsPage> = new Map();
  const stateCache: EtagCache<{ state: 'open' | 'closed' }> = new Map();
  // 关闭人核验的 events 缓存与打标人的分开：后者只留仍在 open 列表里的 issue。
  const closerEventsCache: EtagCache<GithubIssueEventsPage> = new Map();
  // 本进程见过 open 的 issue（团队 × sourceRef，小写）：关闭对账只认这些的
  // open → closed。进程内存，重启即空（重启后首见即 closed 的不关）。
  const seenOpen = new Set<string>();
  // 导入后编排失败、待重试的卡（todo id → 上一次尝试）。进程内存：重启即忘。
  // 不从库里按 createdBy 重建：todo 行没有导入时刻，只凭标记分不清「编排
  // 失败」与「有人把卡重开回 todo」，也认不出删卡后复用号留下的旧线程。
  const orchestrateRetries = new Map<string, OrchestrateAttempt>();
  let sweeping = false;
  const refKey = (teamId: string, sourceRef: string) => `${teamId}\u0000${sourceRef}`.toLowerCase();

  /** 卡没有任何 build 交付过 PR（prNumber 或 prUrl 在，builds.ts latestPrBuild
   * 同一判据；只看最新 build 不够：失败卡重跑出的新 build 还没 PR 时，旧 PR
   * 仍开着、仍可能被合并）。交付过的卡关闭对账不碰：合并带关闭引用关掉 issue
   * 时它不该以 closed 收尾（review 期的由 #1414 的 PR 对账收尾，其余相位见头注
   * 第 2 条）。用在以 todo 为主表的查询里（相关子查询）。 */
  function noDeliveredPr() {
    return notExists(
      deps.db
        .select({ id: build.id })
        .from(build)
        .where(
          and(eq(build.todoId, todo.id), or(isNotNull(build.prNumber), isNotNull(build.prUrl))),
        ),
    );
  }

  /** 卡没有还在跑的拆卡子卡（子卡全在 done / closed，或根本没拆）。父卡被关
   * 后，最后一张子卡 done 时 settleSplitOnDone 要把父卡推到 done，closed →
   * done 是非法边，会在子卡相位已落库之后抛错。同 noDeliveredPr，用在以 todo
   * 为主表的查询里。 */
  function noOpenChildren() {
    return notExists(
      deps.db
        .select({ id: childTodo.id })
        .from(childTodo)
        .where(and(eq(childTodo.sourceTodo, todo.id), notInArray(childTodo.phase, CHILD_SETTLED))),
    );
  }

  /** 团队已占用的 issue 引用（小写；导入的与自建的都算）。 */
  function claimedRefs(teamId: string): Set<string> {
    return new Set(
      deps.db
        .select({ sourceRef: todo.sourceRef })
        .from(todo)
        .where(and(eq(todo.teamId, teamId), like(todo.sourceRef, 'github:%')))
        .all()
        .map((r) => (r.sourceRef ?? '').toLowerCase()),
    );
  }

  /** issue 的事件历史：按 Link rel="next" 读，至多 ISSUE_INTAKE_MAX_EVENT_PAGES
   * 页；null = 某页读不到。下一页不可跟或超过页数 = complete false。 */
  async function readHistory(
    cache: EtagCache<GithubIssueEventsPage>,
    issueKey: string,
    token: string,
    ref: { owner: string; repo: string; issueNumber: number },
  ): Promise<IssueHistory | null> {
    const events: GithubIssueEvent[] = [];
    let url: string | null = null;
    for (let pageNo = 1; pageNo <= ISSUE_INTAKE_MAX_EVENT_PAGES; pageNo += 1) {
      const key: string = `${issueKey}\u0001${url ?? 'first'}`;
      const page = await githubIssueEvents(
        run.githubFetch,
        token,
        ref.owner,
        ref.repo,
        ref.issueNumber,
        { url, etag: etagFor(cache, key) },
      );
      const data: GithubIssueEventsPage | null = settle(cache, key, page);
      if (data === null) return null;
      events.push(...data.events);
      if (!data.more) return { events, complete: true };
      if (data.next === null) return { events, complete: false };
      url = data.next;
    }
    return { events, complete: false };
  }

  /** D5：谁最后打的 ready-for-agent，他在仓库上够不够 triage。 */
  async function labelerVerdict(
    teamId: string,
    token: string,
    owner: string,
    repo: string,
    issueNumber: number,
    now: number,
  ): Promise<Verdict> {
    const key = `${teamId}\u0000${owner}/${repo}#${issueNumber}`.toLowerCase();
    const history = await readHistory(eventsCache, key, token, { owner, repo, issueNumber });
    if (history === null) return { notTaken: 'unverifiable', reason: 'events-unreadable' };
    const found = newestLabeler(history);
    if ('reason' in found) return { notTaken: 'not-eligible', ...found };
    const trusted = await hasRepoTriage(
      run.githubFetch,
      teamId,
      token,
      owner,
      repo,
      found.labeler,
      now,
    );
    if (trusted === null) return { notTaken: 'unverifiable', reason: 'permission-unreadable' };
    return trusted ? found : { notTaken: 'not-eligible', reason: 'labeler-below-triage' };
  }

  /** 编排一张导入的卡；失败记次，没到上限留给后面几轮重试。 */
  function orchestrateImported(
    todoId: string,
    entry: OrchestrateAttempt,
    tally: IssueIntakeTally,
  ): void {
    try {
      orchestrateTodo(deps, todoId);
      orchestrateRetries.delete(todoId);
      tally.orchestrated += 1;
    } catch (err) {
      tally.errors += 1;
      log(
        { todoId, attempts: entry.attempts, err: errText(err) },
        'issue intake orchestrate failed',
      );
      if (entry.attempts < ISSUE_INTAKE_MAX_ORCHESTRATE_ATTEMPTS) {
        orchestrateRetries.set(todoId, entry);
      } else {
        orchestrateRetries.delete(todoId);
        log({ todoId, attempts: entry.attempts }, 'issue intake orchestrate given up');
      }
    }
  }

  /** 卡导入之后开始了编排（有人手动开始了）：按 orchestrateThreadTitle 认
   * 线程（web 的「在飞编排回合」判定同一标题），且线程里有 chief 步（回合
   * 入了队）。只认导入之后建的——seqNum 是团队内 max+1，删掉最大号的卡后
   * 下一张复用它的号，旧线程不算；没有 chief 步的线程是某次编排中途失败
   * 留下的（sendChiefMessage 先建线程、后入队步），也不算。 */
  function startedSince(teamId: string, seqNum: number, importedAt: number): boolean {
    const thread = deps.db
      .select({ id: chiefThread.id })
      .from(chiefThread)
      .where(
        and(
          eq(chiefThread.teamId, teamId),
          eq(chiefThread.title, orchestrateThreadTitle(seqNum)),
          gte(chiefThread.createdAt, importedAt),
          exists(
            deps.db
              .select({ id: step.id })
              .from(step)
              .where(and(eq(step.buildId, chiefThread.id), eq(step.kind, 'chief'))),
          ),
        ),
      )
      .get();
    return thread !== undefined;
  }

  /** 重试本队导入后编排失败的卡。卡没了、离开了 todo、或导入后已开始编排
   * = 有人接手；chief 换绑了别的 Agent（卡的 createdBy 不是现在的 Agent）=
   * 卡已出关闭对账范围，issue 被关也没人收尾——都不再试（记一行带原因）。
   * 读库失败只跳过这张卡，不计次。 */
  function retryOrchestration(teamId: string, agentId: string, tally: IssueIntakeTally): void {
    for (const [todoId, entry] of orchestrateRetries) {
      if (entry.teamId !== teamId) continue;
      let dropped: 'todo-gone' | 'left-todo' | 'chief-rebound' | 'thread-exists' | null;
      try {
        const row = deps.db
          .select({ phase: todo.phase, seqNum: todo.seqNum, createdBy: todo.createdBy })
          .from(todo)
          .where(eq(todo.id, todoId))
          .get();
        dropped =
          row === undefined
            ? 'todo-gone'
            : row.phase !== 'todo'
              ? 'left-todo'
              : row.createdBy !== agentId
                ? 'chief-rebound'
                : startedSince(teamId, row.seqNum, entry.importedAt)
                  ? 'thread-exists'
                  : null;
      } catch (err) {
        tally.errors += 1;
        log({ todoId, err: errText(err) }, 'issue intake orchestrate retry failed');
        continue;
      }
      if (dropped !== null) {
        orchestrateRetries.delete(todoId);
        log({ todoId, reason: dropped }, 'issue intake orchestrate retry dropped');
        continue;
      }
      orchestrateImported(todoId, { ...entry, attempts: entry.attempts + 1 }, tally);
    }
  }

  /** 一条候选：D5 → 导入前再数在飞 → 导入（409 = 别路已领）→ 编排。 */
  async function take(
    row: ProjectRow,
    owner: string,
    repo: string,
    access: TeamAccess,
    issueNumber: number,
    now: number,
    tally: IssueIntakeTally,
  ): Promise<'imported' | 'full' | 'not-taken'> {
    const verdict = await labelerVerdict(row.teamId, access.token, owner, repo, issueNumber, now);
    if ('notTaken' in verdict) {
      if (verdict.notTaken === 'unverifiable') tally.unverifiable += 1;
      else tally.notEligible += 1;
      const at = { projectId: row.id, issue: issueNumber, reason: verdict.reason };
      if ('viaApp' in verdict) {
        log(
          { ...at, labeler: verdict.labeler, viaApp: verdict.viaApp },
          `issue intake label applied through app ${verdict.viaApp}, not taken`,
        );
      } else log(at, 'issue intake candidate not taken');
      return 'not-taken';
    }
    // 读窗口里别处可能已占位（webhook 导入）：导入前再数一次。
    if (projectAtInFlightCap(deps.db, row.id)) {
      tally.atCap += 1;
      return 'full';
    }
    let todoId: string;
    try {
      const record = await importGithubIssue(
        { ...deps, box: access.box, githubFetch: run.githubFetch },
        row,
        issueNumber,
        { createdBy: access.createdBy },
      );
      todoId = record.id;
    } catch (err) {
      if (err instanceof HttpError && err.status === 409) {
        tally.claimed += 1;
        return 'not-taken';
      }
      tally.errors += 1;
      log(
        { projectId: row.id, issue: issueNumber, err: errText(err) },
        'issue intake import failed',
      );
      return 'not-taken';
    }
    tally.imported += 1;
    log(
      { projectId: row.id, issue: issueNumber, todoId, labeler: verdict.labeler },
      'issue intake candidate taken',
    );
    // 列表只给 open 的 issue：导入即「见过 open」（关闭对账的起点）。
    seenOpen.add(refKey(row.teamId, githubIssueSourceRef(owner, repo, issueNumber)));
    orchestrateImported(todoId, { teamId: row.teamId, importedAt: nowMs(), attempts: 1 }, tally);
    return 'imported';
  }

  async function intakeProject(
    row: ProjectRow,
    owner: string,
    repo: string,
    access: TeamAccess,
    now: number,
    tally: IssueIntakeTally,
  ): Promise<void> {
    // 满员不读列表（省一次读；下一轮有位再读）。
    if (projectAtInFlightCap(deps.db, row.id)) return;
    const listKey = `${row.teamId}\u0000${owner}/${repo}`.toLowerCase();
    const claimed = claimedRefs(row.teamId);
    const listed = new Set<string>();
    const visitedPages = new Set<string>();
    // 满员后余下的候选都等下一轮（不再逐条数库，也不再翻页）。
    let atCap = false;
    let url: string | null = null;
    for (let pageNo = 1; ; pageNo += 1) {
      if (pageNo > ISSUE_INTAKE_MAX_LIST_PAGES) {
        tally.listTruncated += 1;
        log(
          { projectId: row.id, pages: ISSUE_INTAKE_MAX_LIST_PAGES },
          'issue intake list truncated',
        );
        break;
      }
      const pageKey: string = `${listKey}\u0000${url ?? 'first'}`;
      visitedPages.add(pageKey);
      const page = await githubOpenIssuesWithLabel(
        run.githubFetch,
        access.token,
        owner,
        repo,
        ISSUE_INTAKE_LABEL,
        { url, etag: etagFor(listCache, pageKey) },
      );
      const data: GithubLabeledIssuesPage | null = settle(listCache, pageKey, page);
      if (data === null) {
        // 403 / 404（token 看不到该仓）、限流、网络：首页读不到 = 整项目本轮
        // 不领；后面的页读不到 = 本轮停在这一页。
        if (pageNo === 1) {
          tally.skipped += 1;
          log({ projectId: row.id, reason: 'list-unreadable' }, 'issue intake project skipped');
          return;
        }
        log({ projectId: row.id, page: pageNo }, 'issue intake list page unreadable');
        break;
      }
      if (page?.notModified === true) tally.listNotModified += 1;
      const candidates = [...data.issues].sort((a, b) => a.number - b.number);
      tally.candidates += candidates.length;
      for (const issue of candidates) {
        const ref = githubIssueSourceRef(owner, repo, issue.number);
        listed.add(`${listKey}#${issue.number}`);
        if (claimed.has(ref.toLowerCase())) {
          tally.claimed += 1;
          continue;
        }
        if (!atCap) atCap = projectAtInFlightCap(deps.db, row.id);
        if (atCap) {
          tally.atCap += 1;
          continue;
        }
        const outcome = await take(row, owner, repo, access, issue.number, now, tally);
        if (outcome === 'full') atCap = true;
        if (outcome === 'imported') claimed.add(ref.toLowerCase());
      }
      if (atCap || data.next === null) break;
      url = data.next;
    }
    // 缓存只留这一轮读过的页、仍在列表里的 issue。
    for (const key of listCache.keys()) {
      if (key.startsWith(`${listKey}\u0000`) && !visitedPages.has(key)) listCache.delete(key);
    }
    for (const key of eventsCache.keys()) {
      const issueKey = key.split('\u0001')[0] ?? '';
      if (key.startsWith(`${listKey}#`) && !listed.has(issueKey)) eventsCache.delete(key);
    }
  }

  /** 关闭人核验：最新一条 closed 事件的 actor 在仓库上是不是 triage 及以上。 */
  async function closerVerdict(
    teamId: string,
    token: string,
    ref: { owner: string; repo: string; issueNumber: number },
    key: string,
    now: number,
  ): Promise<'trusted' | { reason: string }> {
    const history = await readHistory(closerEventsCache, key, token, ref);
    if (history === null) return { reason: 'events-unreadable' };
    if (!history.complete) return { reason: 'events-incomplete' };
    const closed = newestOf(history.events, (e) => e.event === 'closed');
    if (closed === null) return { reason: 'no-closed-event' };
    if (closed.actor === null) return { reason: 'closer-deleted' };
    const trusted = await hasRepoTriage(
      run.githubFetch,
      teamId,
      token,
      ref.owner,
      ref.repo,
      closed.actor,
      now,
    );
    if (trusted === null) return { reason: 'permission-unreadable' };
    return trusted ? 'trusted' : { reason: 'closer-below-triage' };
  }

  /** issue 在 GitHub 上由可信的人从 open 关成 closed（本进程看到的变化）→ 卡
   * 经关闭路径落 closed（停活动步）。 */
  async function reconcileClosed(
    teamId: string,
    token: string,
    rows: ReconcileRow[],
    now: number,
    tally: IssueIntakeTally,
  ): Promise<void> {
    const keep = new Set<string>();
    for (const t of rows) {
      const ref = parseGithubIssueSourceRef(t.sourceRef);
      if (ref === null) continue;
      const key = refKey(teamId, t.sourceRef);
      keep.add(key);
      try {
        const page = await githubIssueState(
          run.githubFetch,
          token,
          ref.owner,
          ref.repo,
          ref.issueNumber,
          { etag: stateCache.get(key)?.etag ?? null },
        );
        const issue = settle(stateCache, key, page);
        if (issue === null) {
          tally.closeSkipped += 1;
          continue;
        }
        if (issue.state === 'open') {
          seenOpen.add(key);
          continue;
        }
        // 没见过它 open（首见即 closed、重启后、或关过一次后卡被重开）：不是
        // 本进程看到的 open → closed，不动。
        if (!seenOpen.has(key)) continue;
        const closer = await closerVerdict(teamId, token, ref, key, now);
        if (closer !== 'trusted') {
          tally.closeSkipped += 1;
          log(
            { todoId: t.id, issue: ref.issueNumber, reason: closer.reason },
            'issue intake close skipped',
          );
          continue;
        }
        // 写前重读相位、PR 与子卡：读窗口里被人推进（如进 review）/ 关闭 /
        // 完成，build 交付了 PR（不归这里关，见 noDeliveredPr），或有了还在跑
        // 的子卡 → 不动。
        const fresh = deps.db
          .select({ phase: todo.phase })
          .from(todo)
          .where(and(eq(todo.id, t.id), noDeliveredPr(), noOpenChildren()))
          .get();
        if (fresh === undefined || fresh.phase !== t.phase) {
          tally.closeSkipped += 1;
          continue;
        }
        const result = transitionTodos(deps, teamId, [t.id], 'closed', ISSUE_INTAKE_ACTOR);
        if (result.transitioned.includes(t.id)) {
          tally.closed += 1;
          // 关过即忘：有人把卡重开（issue 仍 closed）不再关第二次。
          seenOpen.delete(key);
        } else tally.closeSkipped += 1;
      } catch (err) {
        if (err instanceof GithubRateLimitedError) throw err;
        tally.errors += 1;
        log({ todoId: t.id, err: errText(err) }, 'issue intake close failed');
      }
    }
    // 只留本队仍在对账集里的卡。
    const teamPrefix = `${teamId}\u0000`.toLowerCase();
    for (const cache of [stateCache, closerEventsCache]) {
      for (const key of cache.keys()) {
        // closerEventsCache 的键带页后缀（\u0001…），按 issue 键比。
        if (key.startsWith(teamPrefix) && !keep.has(key.split('\u0001')[0] ?? '')) {
          cache.delete(key);
        }
      }
    }
    for (const key of seenOpen) {
      if (key.startsWith(teamPrefix) && !keep.has(key)) seenOpen.delete(key);
    }
  }

  async function sweepTeam(
    teamId: string,
    projects: ProjectRow[],
    issueTasks: IssueTaskRow[],
    now: number,
    tally: IssueIntakeTally,
  ): Promise<void> {
    const got = teamGithubToken(deps, teamId);
    if ('reason' in got) {
      tally.skipped += projects.length;
      log({ teamId, reason: got.reason }, 'issue intake team skipped');
      return;
    }
    // 关闭对账只碰轮询器领的卡：createdBy = 本队 chief 绑定的 Agent id（导入
    // 时写入；手工导入与 webhook 导入是 seed 用户）。认卡只看库里的列，重启后
    // 照样认得；chief 换绑 Agent 后，换绑前领的卡不再对账。
    const agentId = chiefBinding(deps, teamId).agentId;
    if (agentId === null) {
      // chief 没绑 Agent：本轮不对账，也不调 reconcileClosed——它的修剪会忘掉
      // 「见过 open」，换回同一 Agent 后，期间被关的就关不上了。只在本队有
      // 可能是轮询器领的卡（createdBy 不是 seed 用户）时记一行。
      if (issueTasks.some((t) => t.createdBy !== null && t.createdBy !== deps.user.id)) {
        log({ teamId, reason: 'chief-not-bound' }, 'issue intake close reconcile skipped');
      }
    } else {
      const taken = issueTasks.filter((t) => t.createdBy === agentId);
      await reconcileClosed(teamId, got.token, taken, now, tally);
    }
    if (projects.length === 0) return;
    // 导入卡的 createdBy = chief 绑定的 Agent（能编排才导入）。对账的 await
    // 之后重读：读窗口里换绑了，新卡记新的 Agent。
    const binding = chiefBinding(deps, teamId);
    const createdBy = binding.canOrchestrate ? binding.agentId : null;
    if (createdBy === null) {
      tally.skipped += projects.length;
      log({ teamId, reason: 'chief-not-bound' }, 'issue intake team skipped');
      return;
    }
    retryOrchestration(teamId, createdBy, tally);
    const seenRepos = new Set<string>();
    for (const row of projects) {
      // 拆段走 server 出站单口（#1466：`.` / `..` 段同按形坏跳过）。
      const repoRef = githubRepoOfProject(row);
      if (repoRef === null) {
        tally.skipped += 1;
        log({ projectId: row.id, reason: 'malformed-repo' }, 'issue intake project skipped');
        continue;
      }
      // 同队两个项目指同一仓（GitHub owner / repo 不分大小写）：只取 id 最小
      // 的一个，另一个跳过——同一条 issue 不会以两个大小写不同的引用各领一次。
      const githubRepo = `${repoRef.owner}/${repoRef.repo}`;
      if (seenRepos.has(githubRepo.toLowerCase())) {
        tally.skipped += 1;
        log({ projectId: row.id, reason: 'duplicate-repo' }, 'issue intake project skipped');
        continue;
      }
      seenRepos.add(githubRepo.toLowerCase());
      tally.projects += 1;
      try {
        await intakeProject(row, repoRef.owner, repoRef.repo, { ...got, createdBy }, now, tally);
      } catch (err) {
        if (err instanceof GithubRateLimitedError) throw err;
        tally.errors += 1;
        log({ projectId: row.id, err: errText(err) }, 'issue intake project failed');
      }
    }
  }

  async function sweep(now: number = nowMs()): Promise<IssueIntakeTally | null> {
    if (sweeping) return null;
    sweeping = true;
    const tally = emptyTally();
    try {
      const projects = deps.db
        .select()
        .from(project)
        .where(and(eq(project.repoKind, 'github'), isNotNull(project.githubRepo)))
        .orderBy(asc(project.id))
        .all();
      const issueTasks = deps.db
        .select({
          id: todo.id,
          teamId: todo.teamId,
          phase: todo.phase,
          sourceRef: todo.sourceRef,
          createdBy: todo.createdBy,
        })
        .from(todo)
        .where(
          and(
            eq(todo.sourceKind, 'github-issue'),
            isNotNull(todo.sourceRef),
            notInArray(todo.phase, CLOSE_RECONCILE_SKIPPED),
            noDeliveredPr(),
            noOpenChildren(),
          ),
        )
        .all();
      const teamIds = new Set([
        ...projects.map((p) => p.teamId),
        ...issueTasks.map((t) => t.teamId),
      ]);
      for (const teamId of teamIds) {
        tally.teams += 1;
        try {
          await sweepTeam(
            teamId,
            projects.filter((p) => p.teamId === teamId),
            issueTasks
              .filter((t) => t.teamId === teamId)
              .map((t) => ({ ...t, sourceRef: t.sourceRef ?? '' })),
            now,
            tally,
          );
        } catch (err) {
          if (err instanceof GithubRateLimitedError) {
            // 限流：本队本轮停读（读到一半的对账与列表留到下一轮），记一行。
            tally.rateLimited += 1;
            const retryAt = err.retryAt(now);
            log(
              {
                teamId,
                status: err.status,
                resetAt: retryAt === null ? null : new Date(retryAt).toISOString(),
              },
              'issue intake team rate limited',
            );
          } else {
            tally.errors += 1;
            log({ teamId, err: errText(err) }, 'issue intake team failed');
          }
        }
      }
    } catch (err) {
      // 查库等整轮级失败（例：SQLITE_BUSY）：记一行带原因，对账行照落。
      tally.errors += 1;
      log({ err: errText(err) }, 'issue intake sweep failed');
    } finally {
      sweeping = false;
    }
    log(tally, 'issue intake sweep');
    return tally;
  }

  return { sweep };
}
