// #1406 P5a-1 issue 进料轮询器（spec 28 §4 P5a + D5）：scheduler 家族的第二个
// 网络循环（5 分钟一轮，与 ci-loop 的 60s 分道；tick 是同步契约，网络读不进
// tick）。只读 GitHub，不写。
//
// 每轮按团队走：
// 1. token：团队连接 token（无连接 / 密文坏 / box 缺席 = 整队跳过，零匿名读——
//    匿名 60/h 的 IP 预算归 ci-loop 与 #931，importGithubIssue 本就要 token）。
// 2. 关闭对账：本队 github-issue 卡（相位不在 done / closed / review）逐张条件读
//    issue state；closed → transitionTodos(closed)，即 chief / MCP close_todos 的
//    关闭路径（#1445：写相位后停活动步）。review 卡留给 #1414 的 PR 对账：合并
//    关掉 issue 时那张卡仍以 done 收尾。写前重读相位，变了就不动。
// 3. chief 未绑定（orchestrateTodo 的前置）→ 本队不导入，不建无法编排的卡。
// 4. 每个 github 项目（githubRepo 形好；同队同仓只取 id 最小的一个）：在飞
//    上限有余量才条件读 open + ready-for-agent 列表（304 复用上轮列表），按号
//    升序（最旧先）；团队级已占用的号跳过（大小写不敏感）；D5 核打标人：该
//    标签最新一条 labeled 之后没有 unlabeled，且其 actor 在仓库上是 triage 及
//    以上（events 一页读不全 / 任一读失败 = 本轮不领）；importGithubIssue（409
//    = 别路已领）→ orchestrateTodo。
//
// 纪律：issue 正文只经 importGithubIssue 进 todo.spec，不进日志、不进系统行；
// 每轮一行对账日志（只有计数）；单卡 / 单项目 / 单队异常不杀整轮；上一轮
// 没跑完时新触发直接返回（不重叠）。

import {
  githubIssueSourceRef,
  isGithubRepoRef,
  type Phase,
  parseGithubIssueSourceRef,
  type SecretBox,
} from '@pacman/shared';
import { and, asc, eq, isNotNull, like, notInArray, sql } from 'drizzle-orm';
import { project, todo } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import {
  type FetchLike,
  type GithubConditionalRead,
  type GithubIssueLabelEvents,
  type GithubLabeledIssues,
  type GithubRepoPermission,
  githubCollaboratorPermission,
  githubIssueLabelEvents,
  githubIssueState,
  githubOpenIssuesWithLabel,
} from '../lib/github.js';
import { nowMs } from '../lib/ids.js';
import type { BuildDeps } from './builds.js';
import { chiefCanOrchestrate } from './chief.js';
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

/** permission 答案缓存时长（按 团队 × 仓 × login）：3 轮内不重读；权限被收回
 * 最多晚这么久生效。 */
export const ISSUE_INTAKE_PERMISSION_TTL_MS = 15 * 60_000;

/** D5 认可的打标人：role_name 是这几个之一，或 legacy permission 是 write /
 * admin（maintain 映射为 write），或 user.permissions.triage 为真（继承 triage
 * 的自定义角色）。legacy permission 的 read 同时盖住 read 与 triage，所以
 * triage 只能从 role_name / user.permissions 认出来。 */
const LABELER_ROLES = new Set(['triage', 'write', 'maintain', 'admin']);
const LABELER_BASE_PERMISSIONS = new Set(['write', 'admin']);

/** 在飞上限不计的相位。failed 计入：失败卡仍挂在项目上等人处理，不再多领。 */
const NOT_IN_FLIGHT: Phase[] = ['done', 'closed'];

/** 关闭对账不碰的相位：done / closed 已终态；review 归 #1414 的 PR 对账。 */
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
  /** 列表 304，复用上轮列表。 */
  listNotModified: number;
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
  orchestrated: number;
  /** issue 已关 → 卡已关。 */
  closed: number;
  /** issue 状态读不到，或写前相位变了：本轮不动。 */
  closeSkipped: number;
  errors: number;
}

export interface IssueIntake {
  /** 单轮。上一轮还在跑时返回 null（不重叠）。 */
  sweep(now?: number): Promise<IssueIntakeTally | null>;
}

type ProjectRow = typeof project.$inferSelect;

type Verdict = 'eligible' | { notTaken: 'not-eligible' | 'unverifiable'; reason: string };

function emptyTally(): IssueIntakeTally {
  return {
    teams: 0,
    projects: 0,
    skipped: 0,
    listNotModified: 0,
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

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function qualifies(p: GithubRepoPermission): boolean {
  return (
    LABELER_BASE_PERMISSIONS.has(p.permission) ||
    (p.roleName !== null && LABELER_ROLES.has(p.roleName)) ||
    p.triage === true
  );
}

/** D5 第一半：该标签最新一条 labeled 的 actor（之后有 unlabeled / 读不全 /
 * 没有 labeled / 账号已删 → 不领的理由）。顺序按 created_at，同刻按 id，不信
 * 数组位置。 */
function newestLabeler(data: GithubIssueLabelEvents): { login: string } | { reason: string } {
  if (!data.complete) return { reason: 'events-incomplete' };
  const later = (a: { at: number; id: number }, b: { at: number; id: number }) =>
    a.at > b.at || (a.at === b.at && a.id > b.id);
  let labeled: (typeof data.events)[number] | null = null;
  let unlabeled: (typeof data.events)[number] | null = null;
  for (const e of data.events) {
    if (e.label.toLowerCase() !== ISSUE_INTAKE_LABEL) continue;
    if (e.event === 'labeled' && (labeled === null || later(e, labeled))) labeled = e;
    if (e.event === 'unlabeled' && (unlabeled === null || later(e, unlabeled))) unlabeled = e;
  }
  if (labeled === null) return { reason: 'no-labeled-event' };
  if (unlabeled !== null && later(unlabeled, labeled)) return { reason: 'label-removed' };
  if (labeled.actor === null) return { reason: 'labeler-deleted' };
  return { login: labeled.actor };
}

export function createIssueIntake(
  deps: BuildDeps,
  run: { githubFetch: FetchLike; logger?: IssueIntakeLogger },
): IssueIntake {
  const log = (obj: object, msg: string) => run.logger?.info(obj, msg);
  // 缓存键都带 teamId：不同团队的 token 看到的表示可能不同（应答 Vary:
  // Authorization）。
  const listCache: EtagCache<GithubLabeledIssues> = new Map();
  const eventsCache: EtagCache<GithubIssueLabelEvents> = new Map();
  const stateCache: EtagCache<{ state: 'open' | 'closed' }> = new Map();
  const permissionCache = new Map<string, { at: number; permission: GithubRepoPermission }>();
  let sweeping = false;

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

  /** 项目在飞数（每次导入前现数：sweep 期间 webhook 导入的卡同样占位）。 */
  function inFlight(projectId: string): number {
    return (
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
        .get()?.n ?? 0
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

  async function permissionOf(
    teamId: string,
    token: string,
    owner: string,
    repo: string,
    login: string,
    now: number,
  ): Promise<GithubRepoPermission | null> {
    const key = `${teamId}\u0000${owner}/${repo}\u0000${login}`.toLowerCase();
    const hit = permissionCache.get(key);
    if (hit !== undefined && now - hit.at < ISSUE_INTAKE_PERMISSION_TTL_MS) return hit.permission;
    const got = await githubCollaboratorPermission(run.githubFetch, token, owner, repo, login);
    // 读不到不进缓存（下轮重读）；404 是明确的否定答案，照常缓存。
    if (got !== null) permissionCache.set(key, { at: now, permission: got });
    return got;
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
    const page = await githubIssueLabelEvents(run.githubFetch, token, owner, repo, issueNumber, {
      etag: eventsCache.get(key)?.etag ?? null,
    });
    const data = settle(eventsCache, key, page);
    if (data === null) return { notTaken: 'unverifiable', reason: 'events-unreadable' };
    const labeler = newestLabeler(data);
    if ('reason' in labeler) return { notTaken: 'not-eligible', reason: labeler.reason };
    const permission = await permissionOf(teamId, token, owner, repo, labeler.login, now);
    if (permission === null) return { notTaken: 'unverifiable', reason: 'permission-unreadable' };
    return qualifies(permission)
      ? 'eligible'
      : { notTaken: 'not-eligible', reason: 'labeler-below-triage' };
  }

  async function intakeProject(
    row: ProjectRow,
    owner: string,
    repo: string,
    access: { token: string; box: SecretBox },
    now: number,
    tally: IssueIntakeTally,
  ): Promise<void> {
    // 满员不读列表（省一次读；下一轮有位再读）。
    if (inFlight(row.id) >= ISSUE_INTAKE_IN_FLIGHT_CAP) return;
    const listKey = `${row.teamId}\u0000${owner}/${repo}`.toLowerCase();
    const page = await githubOpenIssuesWithLabel(
      run.githubFetch,
      access.token,
      owner,
      repo,
      ISSUE_INTAKE_LABEL,
      { etag: listCache.get(listKey)?.etag ?? null },
    );
    const listedIssues = settle(listCache, listKey, page);
    if (listedIssues === null) {
      // 403 / 404（token 看不到该仓）、限流、网络：整项目本轮不领。
      tally.skipped += 1;
      log({ projectId: row.id, reason: 'list-unreadable' }, 'issue intake project skipped');
      return;
    }
    if (page?.notModified === true) tally.listNotModified += 1;
    const candidates = [...listedIssues.issues].sort((a, b) => a.number - b.number);
    tally.candidates += candidates.length;
    const claimed = claimedRefs(row.teamId);
    const listed = new Set<string>();
    let waiting = 0;
    for (const issue of candidates) {
      const ref = githubIssueSourceRef(owner, repo, issue.number);
      listed.add(`${listKey}#${issue.number}`);
      if (claimed.has(ref.toLowerCase())) {
        tally.claimed += 1;
        continue;
      }
      if (inFlight(row.id) >= ISSUE_INTAKE_IN_FLIGHT_CAP) {
        waiting += 1;
        continue;
      }
      const verdict = await labelerVerdict(
        row.teamId,
        access.token,
        owner,
        repo,
        issue.number,
        now,
      );
      if (verdict !== 'eligible') {
        if (verdict.notTaken === 'unverifiable') tally.unverifiable += 1;
        else tally.notEligible += 1;
        log(
          { projectId: row.id, issue: issue.number, reason: verdict.reason },
          'issue intake candidate not taken',
        );
        continue;
      }
      // 读窗口里别处可能已占位（webhook 导入）：导入前再数一次。
      if (inFlight(row.id) >= ISSUE_INTAKE_IN_FLIGHT_CAP) {
        waiting += 1;
        continue;
      }
      let todoId: string;
      try {
        const record = await importGithubIssue(
          { ...deps, box: access.box, githubFetch: run.githubFetch },
          row,
          issue.number,
        );
        todoId = record.id;
      } catch (err) {
        if (err instanceof HttpError && err.status === 409) {
          tally.claimed += 1;
          continue;
        }
        tally.errors += 1;
        log(
          { projectId: row.id, issue: issue.number, err: errText(err) },
          'issue intake import failed',
        );
        continue;
      }
      tally.imported += 1;
      claimed.add(ref.toLowerCase());
      try {
        orchestrateTodo(deps, todoId);
        tally.orchestrated += 1;
      } catch (err) {
        tally.errors += 1;
        log({ todoId, err: errText(err) }, 'issue intake orchestrate failed');
      }
    }
    tally.atCap += waiting;
    // events 缓存只留仍在列表里的 issue。
    for (const key of eventsCache.keys()) {
      if (key.startsWith(`${listKey}#`) && !listed.has(key)) eventsCache.delete(key);
    }
  }

  /** issue 在 GitHub 关了 → 卡经关闭路径落 closed（停活动步）。 */
  async function reconcileClosed(
    teamId: string,
    token: string,
    rows: { id: string; phase: Phase; sourceRef: string }[],
    tally: IssueIntakeTally,
  ): Promise<void> {
    const keep = new Set<string>();
    for (const t of rows) {
      const ref = parseGithubIssueSourceRef(t.sourceRef);
      if (ref === null) continue;
      const key = `${teamId}\u0000${t.sourceRef}`.toLowerCase();
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
        if (issue.state !== 'closed') continue;
        // 写前重读相位：读窗口里被人推进（如进 review）/ 关闭 / 完成 → 不动。
        const fresh = deps.db
          .select({ phase: todo.phase })
          .from(todo)
          .where(eq(todo.id, t.id))
          .get();
        if (fresh === undefined || fresh.phase !== t.phase) {
          tally.closeSkipped += 1;
          continue;
        }
        const result = transitionTodos(deps, teamId, [t.id], 'closed', ISSUE_INTAKE_ACTOR);
        if (result.transitioned.includes(t.id)) tally.closed += 1;
        else tally.closeSkipped += 1;
      } catch (err) {
        tally.errors += 1;
        log({ todoId: t.id, err: errText(err) }, 'issue intake close failed');
      }
    }
    for (const key of stateCache.keys()) {
      if (key.startsWith(`${teamId}\u0000`.toLowerCase()) && !keep.has(key)) stateCache.delete(key);
    }
  }

  async function sweepTeam(
    teamId: string,
    projects: ProjectRow[],
    toReconcile: { id: string; phase: Phase; sourceRef: string }[],
    now: number,
    tally: IssueIntakeTally,
  ): Promise<void> {
    const got = teamToken(teamId);
    if ('reason' in got) {
      tally.skipped += projects.length;
      log({ teamId, reason: got.reason }, 'issue intake team skipped');
      return;
    }
    await reconcileClosed(teamId, got.token, toReconcile, tally);
    if (projects.length === 0) return;
    if (!chiefCanOrchestrate(deps, teamId)) {
      tally.skipped += projects.length;
      log({ teamId, reason: 'chief-not-bound' }, 'issue intake team skipped');
      return;
    }
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
          got,
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
      const toReconcile = deps.db
        .select({ id: todo.id, teamId: todo.teamId, phase: todo.phase, sourceRef: todo.sourceRef })
        .from(todo)
        .where(
          and(
            eq(todo.sourceKind, 'github-issue'),
            isNotNull(todo.sourceRef),
            notInArray(todo.phase, CLOSE_RECONCILE_SKIPPED),
          ),
        )
        .all();
      const teamIds = new Set([
        ...projects.map((p) => p.teamId),
        ...toReconcile.map((t) => t.teamId),
      ]);
      for (const teamId of teamIds) {
        tally.teams += 1;
        try {
          await sweepTeam(
            teamId,
            projects.filter((p) => p.teamId === teamId),
            toReconcile
              .filter((t) => t.teamId === teamId)
              .map((t) => ({ id: t.id, phase: t.phase, sourceRef: t.sourceRef ?? '' })),
            now,
            tally,
          );
        } catch (err) {
          tally.errors += 1;
          log({ teamId, err: errText(err) }, 'issue intake team failed');
        }
      }
    } finally {
      sweeping = false;
    }
    log(tally, 'issue intake sweep');
    return tally;
  }

  return { sweep };
}
