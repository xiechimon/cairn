// #1406 P5a-1 issue 进料轮询器（spec 28 §4 P5a + D5）：scheduler 家族的第二个
// 网络循环（5 分钟一轮，与 ci-loop 的 60s 分道；tick 是同步契约，网络读不进
// tick）。只读 GitHub，不写。
//
// 每轮按团队走：
// 1. token：团队连接 token（无连接 / 密文坏 / box 缺席 = 整队跳过，零匿名读——
//    匿名 60/h 的 IP 预算归 ci-loop 与 #931，importGithubIssue 本就要 token）。
// 2. 关闭对账：本队轮询器领的 github-issue 卡（createdBy = 本队 chief 绑定的
//    Agent id，导入时写入；手工导入与 webhook 导入是 seed 用户，不碰；chief
//    没绑 Agent = 本队本轮不对账、不清「见过 open」，记一行），相位不在
//    done / closed / review、且没有哪个 build 交付过 PR 的，逐张条件读 issue
//    state。只认本进程亲眼看到的 open → closed：导入时、或某次读到 open，记为
//    「见过 open」；之后读到 closed，且最新一条 closed 事件的 actor 在仓库上
//    是 triage 及以上（与打标人同一判据、同一缓存），才 transitionTodos(closed)
//    ——chief / MCP close_todos 的关闭路径（#1445：写相位后停活动步）。首见即
//    closed 的卡（例：重启后才读到）永不被对账关闭；关过一次即忘掉「见过
//    open」，有人把卡重开就不再关。外部作者关自己的 issue、任一读失败 = 本轮
//    不关。review 卡与 build 交付过 PR 的卡（building 磨绿中 / failed / 重跑
//    中）留给 PR 对账：合并带关闭引用关掉 issue 时，那张卡不以 closed 收尾。
//    写前重读相位与 PR，变了就不动。
// 3. chief 未绑定（orchestrateTodo 的前置）→ 本队不导入，不建无法编排的卡。
//    绑好的队先重试上几轮导入后编排失败的卡（进程内记次，连同导入那次至多
//    ISSUE_INTAKE_MAX_ORCHESTRATE_ATTEMPTS 次；卡已离开 todo 或导入后已开始
//    编排（编排线程里有 chief 步）= 有人接手，不再试）。
// 4. 每个 github 项目（githubRepo 形好；同队同仓只取 id 最小的一个）：在飞
//    上限有余量才条件读 open + ready-for-agent 列表（304 复用上轮列表；按 Link
//    rel="next" 翻页，至多 ISSUE_INTAKE_MAX_LIST_PAGES 页），按号升序（最旧
//    先）；团队级已占用的号跳过（大小写不敏感）；D5 核打标人：该标签最新一条
//    labeled 之后没有 unlabeled，且其 actor 在仓库上是 triage 及以上（events
//    按 Link rel="next" 至多读 ISSUE_INTAKE_MAX_EVENT_PAGES 页，读满仍有下一页
//    = 读不全；读不全 / 任一读失败 = 本轮不领）；importGithubIssue（409 = 别路
//    已领；createdBy 记 chief 绑定的 Agent）→ orchestrateTodo；领到一条记一行
//    日志（打标人与经手的 app slug，审计用，不进判据）。
//
// 纪律：issue 正文只经 importGithubIssue 进 todo.spec，不进日志、不进系统行；
// 每轮一行对账日志（只有计数）；单卡 / 单项目 / 单队异常不杀整轮；上一轮
// 没跑完时新触发直接返回（不重叠）。

import {
  githubIssueSourceRef,
  isGithubRepoRef,
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
import { build, chiefThread, project, step, todo } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import {
  type FetchLike,
  type GithubConditionalRead,
  type GithubIssueEvent,
  type GithubIssueEventsPage,
  type GithubLabeledIssuesPage,
  type GithubRepoPermission,
  githubCollaboratorPermission,
  githubIssueEvents,
  githubIssueState,
  githubOpenIssuesWithLabel,
} from '../lib/github.js';
import { nowMs } from '../lib/ids.js';
import type { BuildDeps } from './builds.js';
import { chiefBoundAgentId, chiefOrchestrateAgentId } from './chief.js';
import { type TransitionActor, transitionTodos } from './chief-tools.js';
import { openGithubToken } from './github-connection.js';
import { importGithubIssue } from './github-issues.js';
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
 * 最多晚这么久生效。 */
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

/** 关闭对账不碰的相位：done / closed 已终态；review 归 #1414 的 PR 对账。
 * 相位之外还有一条：任一 build 交付过 PR 的卡也不碰（见 noDeliveredPr）。 */
const CLOSE_RECONCILE_SKIPPED: Phase[] = ['done', 'closed', 'review'];

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
   * 写前相位变了或 build 交付了 PR。 */
  closeSkipped: number;
  errors: number;
}

export interface IssueIntake {
  /** 单轮。上一轮还在跑时返回 null（不重叠）。 */
  sweep(now?: number): Promise<IssueIntakeTally | null>;
}

type ProjectRow = typeof project.$inferSelect;

/** 该标签最新一条 labeled 的打标人与经手的 app（app 只供领取日志审计）。 */
interface Labeler {
  labeler: string;
  viaApp: string | null;
}

/** D5 判定：可领时即打标人。 */
type Verdict = Labeler | { notTaken: 'not-eligible' | 'unverifiable'; reason: string };

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
 * 没有 labeled / 账号已删 → 不领的理由）。顺序按 created_at，同刻按 id，不信
 * 数组位置。 */
function newestLabeler(data: IssueHistory): Labeler | { reason: string } {
  if (!data.complete) return { reason: 'events-incomplete' };
  const forLabel = (kind: 'labeled' | 'unlabeled') => (e: GithubIssueEvent) =>
    e.event === kind && e.label?.toLowerCase() === ISSUE_INTAKE_LABEL;
  const labeled = newestOf(data.events, forLabel('labeled'));
  const unlabeled = newestOf(data.events, forLabel('unlabeled'));
  if (labeled === null) return { reason: 'no-labeled-event' };
  if (unlabeled !== null && later(unlabeled, labeled)) return { reason: 'label-removed' };
  if (labeled.actor === null) return { reason: 'labeler-deleted' };
  return { labeler: labeled.actor, viaApp: labeled.viaApp };
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
  const permissionCache = new Map<string, { at: number; permission: GithubRepoPermission }>();
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
   * 仍开着、仍可能被合并）。交付过的卡，合并带关闭引用关掉 issue 时由 PR
   * 对账收尾，关闭对账不碰。用在以 todo 为主表的查询里（相关子查询）。 */
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

  function teamToken(teamId: string): { token: string; box: SecretBox } | { reason: string } {
    const box = deps.box;
    if (box === undefined) return { reason: 'no-secret-box' };
    try {
      const token = openGithubToken({ db: deps.db, box }, teamId);
      return token === null ? { reason: 'no-github-connection' } : { token, box };
    } catch {
      return { reason: 'token-unreadable' };
    }
  }

  /** 项目在飞已满（每次导入前现数：sweep 期间 webhook 导入的卡同样占位）。 */
  function projectFull(projectId: string): boolean {
    const inFlight =
      deps.db
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
    return inFlight >= ISSUE_INTAKE_IN_FLIGHT_CAP;
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

  /** login 在仓库上是不是 triage 及以上（打标人与关闭人同一判据）；null = 读
   * 不到。答案按 团队 × 仓 × login 缓存 TTL。 */
  async function hasTriage(
    teamId: string,
    token: string,
    owner: string,
    repo: string,
    login: string,
    now: number,
  ): Promise<boolean | null> {
    const key = `${teamId}\u0000${owner}/${repo}\u0000${login}`.toLowerCase();
    const hit = permissionCache.get(key);
    let p: GithubRepoPermission | null =
      hit !== undefined && now - hit.at < ISSUE_INTAKE_PERMISSION_TTL_MS ? hit.permission : null;
    if (p === null) {
      p = await githubCollaboratorPermission(run.githubFetch, token, owner, repo, login);
      // 读不到不进缓存（下轮重读）；404 是明确的否定答案，照常缓存。
      if (p === null) return null;
      permissionCache.set(key, { at: now, permission: p });
    }
    return (
      LABELER_BASE_PERMISSIONS.has(p.permission) ||
      (p.roleName !== null && LABELER_ROLES.has(p.roleName)) ||
      p.triage === true
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
    if ('reason' in found) return { notTaken: 'not-eligible', reason: found.reason };
    const trusted = await hasTriage(teamId, token, owner, repo, found.labeler, now);
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
   * = 有人接手，不再试（记一行带原因）。读库失败只跳过这张卡，不计次。 */
  function retryOrchestration(teamId: string, tally: IssueIntakeTally): void {
    for (const [todoId, entry] of orchestrateRetries) {
      if (entry.teamId !== teamId) continue;
      let dropped: 'todo-gone' | 'left-todo' | 'thread-exists' | null;
      try {
        const row = deps.db
          .select({ phase: todo.phase, seqNum: todo.seqNum })
          .from(todo)
          .where(eq(todo.id, todoId))
          .get();
        dropped =
          row === undefined
            ? 'todo-gone'
            : row.phase !== 'todo'
              ? 'left-todo'
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
      log(
        { projectId: row.id, issue: issueNumber, reason: verdict.reason },
        'issue intake candidate not taken',
      );
      return 'not-taken';
    }
    // 读窗口里别处可能已占位（webhook 导入）：导入前再数一次。
    if (projectFull(row.id)) {
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
    // 打标人与经手的 app：只供审计，D5 不看 app（用户授权的 app 令牌打的标，
    // actor 是授权的人；app 安装令牌打的标，actor 是 <slug>[bot]，照常按它
    // 在仓库上的权限判）。
    log(
      {
        projectId: row.id,
        issue: issueNumber,
        todoId,
        labeler: verdict.labeler,
        viaApp: verdict.viaApp,
      },
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
    if (projectFull(row.id)) return;
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
        if (!atCap) atCap = projectFull(row.id);
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
    const trusted = await hasTriage(teamId, token, ref.owner, ref.repo, closed.actor, now);
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
        // 写前重读相位与 PR：读窗口里被人推进（如进 review）/ 关闭 / 完成，或
        // build 交付了 PR（留给 PR 对账）→ 不动。
        const fresh = deps.db
          .select({ phase: todo.phase })
          .from(todo)
          .where(and(eq(todo.id, t.id), noDeliveredPr()))
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
    const got = teamToken(teamId);
    if ('reason' in got) {
      tally.skipped += projects.length;
      log({ teamId, reason: got.reason }, 'issue intake team skipped');
      return;
    }
    // 关闭对账只碰轮询器领的卡：createdBy = 本队 chief 绑定的 Agent id（导入
    // 时写入；手工导入与 webhook 导入是 seed 用户）。认卡只看库里的列，重启后
    // 照样认得；chief 换绑 Agent 后，换绑前领的卡不再对账。
    const agentId = chiefBoundAgentId(deps, teamId);
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
    // 导入卡的 createdBy = chief 绑定的 Agent（能编排才导入）。
    const createdBy = chiefOrchestrateAgentId(deps, teamId);
    if (createdBy === null) {
      tally.skipped += projects.length;
      log({ teamId, reason: 'chief-not-bound' }, 'issue intake team skipped');
      return;
    }
    retryOrchestration(teamId, tally);
    const seenRepos = new Set<string>();
    for (const row of projects) {
      const githubRepo = row.githubRepo ?? '';
      if (!isGithubRepoRef(githubRepo)) {
        tally.skipped += 1;
        log({ projectId: row.id, reason: 'malformed-repo' }, 'issue intake project skipped');
        continue;
      }
      // 同队两个项目指同一仓（GitHub owner / repo 不分大小写）：只取 id 最小
      // 的一个，另一个跳过——同一条 issue 不会以两个大小写不同的引用各领一次。
      if (seenRepos.has(githubRepo.toLowerCase())) {
        tally.skipped += 1;
        log({ projectId: row.id, reason: 'duplicate-repo' }, 'issue intake project skipped');
        continue;
      }
      seenRepos.add(githubRepo.toLowerCase());
      tally.projects += 1;
      const slash = githubRepo.indexOf('/');
      try {
        await intakeProject(
          row,
          githubRepo.slice(0, slash),
          githubRepo.slice(slash + 1),
          { ...got, createdBy },
          now,
          tally,
        );
      } catch (err) {
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
      for (const [key, hit] of permissionCache) {
        if (now - hit.at >= ISSUE_INTAKE_PERMISSION_TTL_MS) permissionCache.delete(key);
      }
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
          tally.errors += 1;
          log({ teamId, err: errText(err) }, 'issue intake team failed');
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
