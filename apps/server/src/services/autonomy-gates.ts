// #1491 后台自动任务的触发闸（spec 28 §5「token 失控」）。后台自己开跑的入口
// （issue 进料、园丁 #1407、自治合并 #1405）开一轮前都问这一处：
//
// - evaluateAutonomyGates：纯函数，按固定顺序判，首个不过即返回原因（shared
//   AUTONOMY_GATE_REASONS）。参照 PilotDeck src/always-on/runtime/
//   DiscoveryGates.ts 的同形设计（OpenBMB/PilotDeck main，2026-10-22 读）。
// - 其余是给调用方凑输入、记结果的库读写：项目设置、上次开跑、当天花费、
//   人最近一次写操作。
//
// 失败方式（票面）：
// - 花费读不到 → budget-unreadable，不放行。
// - 日预算按 UTC 日切（utcDayStart）；时钟回拨（上次开跑 / 人的写操作在
//   「将来」）照样算在窗口内，偏保守。
// - 「最近活动」只算人的写操作：member_activity 由 app 的中间件在 /api/ 鉴权
//   面的写请求成功后记；agent（/api/mcp）、机器（/api/machine）、webhook 不记。
//   眼下按整个实例记，不分项目（本仓是单人自托管，人在用任何项目都让路）。
// - 休眠读失败（main 头读不到）→ 不休眠，交给后面的闸。
// - 被拦只是本轮不开：闸不删候选，下一轮重判。

import {
  AUTONOMY_KINDS,
  type AutonomyGateReason,
  type AutonomyKind,
  type AutonomyRecord,
  type AutonomySettings,
  DEFAULT_AUTONOMY_SETTINGS,
  type PatchAutonomyBody,
} from '@pacman/shared';
import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { autonomyState, build, memberActivity, project, todo, tokenUsage } from '../db/schema.js';
import { notFound } from '../lib/errors.js';

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

/** member_activity 眼下唯一的 scope（见模块头注）。 */
const MEMBER_ACTIVITY_SCOPE = 'server';

/** 算进日预算的 build：chief 开的与定时开的（人手动开始的 'user' 不算）。人在
 * chief 聊天里让它开的也算进来——多算偏保守。 */
const AUTONOMOUS_TRIGGERS = ['chief', 'schedule'] as const;

export interface AutonomyGateInput {
  now: number;
  settings: AutonomySettings;
  /** 休眠闸：本类任务上次开跑时 main 的头与现在的头。缺省 = 本类任务不用
   * 这道闸（例：进料靠候选列表本身判有没有新东西）。任一为 null = 没有基线
   * 或读不到，不休眠。 */
  dormancy?: { baselineSha: string | null; currentSha: string | null };
  inFlight: number;
  inFlightCap: number;
  lastMemberWriteAt: number | null;
  lastStartedAt: number | null;
  /** 当天（UTC）该项目自动任务的花费；null = 读不到。 */
  spentTodayUsd: number | null;
}

export type AutonomyGateResult = { ok: true } | { ok: false; reason: AutonomyGateReason };

/** 窗口内判定：at 在 now 之前不足 minutes 分钟，或在 now 之后（时钟回拨）。 */
function within(now: number, at: number | null, minutes: number): boolean {
  return minutes > 0 && at !== null && now - at < minutes * MINUTE_MS;
}

export function evaluateAutonomyGates(input: AutonomyGateInput): AutonomyGateResult {
  const { settings } = input;
  const block = (reason: AutonomyGateReason): AutonomyGateResult => ({ ok: false, reason });
  if (!settings.enabled) return block('disabled');
  const d = input.dormancy;
  if (d !== undefined && d.baselineSha !== null && d.baselineSha === d.currentSha) {
    return block('dormant');
  }
  if (input.inFlight >= input.inFlightCap) return block('in-flight-cap');
  if (within(input.now, input.lastMemberWriteAt, settings.quietMinutes)) {
    return block('member-active');
  }
  if (within(input.now, input.lastStartedAt, settings.cooldownMinutes)) return block('cooldown');
  if (settings.dailyBudgetUsd > 0) {
    if (input.spentTodayUsd === null) return block('budget-unreadable');
    if (input.spentTodayUsd >= settings.dailyBudgetUsd) return block('budget');
  }
  return { ok: true };
}

/** now 所在 UTC 日的零点。 */
export function utcDayStart(now: number): number {
  return Math.floor(now / DAY_MS) * DAY_MS;
}

// —— 库读写 ——————————————————————————————————————————————————————————————

export function autonomySettingsOf(row: { autonomy: AutonomySettings | null }): AutonomySettings {
  return { ...DEFAULT_AUTONOMY_SETTINGS, ...(row.autonomy ?? {}) };
}

/** 当天（UTC）该项目自动任务的花费：build 落在当天、触发源是 chief / 定时
 * 的 token_usage.costTotal 合计（成本按 build 开跑那天算）。读失败 = null。 */
export function autonomySpentToday(db: Db, projectId: string, now: number): number | null {
  const start = utcDayStart(now);
  try {
    const row = db
      .select({ usd: sql<number | null>`sum(${tokenUsage.costTotal})` })
      .from(tokenUsage)
      .innerJoin(build, eq(build.id, tokenUsage.buildId))
      .innerJoin(todo, eq(todo.id, build.todoId))
      .where(
        and(
          eq(todo.projectId, projectId),
          inArray(build.triggerSource, [...AUTONOMOUS_TRIGGERS]),
          gte(build.createdAt, start),
          lt(build.createdAt, start + DAY_MS),
        ),
      )
      .get();
    return row?.usd ?? 0;
  } catch {
    return null;
  }
}

/** 不算人的写操作的 /api/ 面：机器（daemon，含 chief / worker 步回传）、MCP
 * （agent 拿 apiKey 调）、GitHub webhook、OAuth 回跳。 */
const NON_MEMBER_API_PREFIXES = ['/api/machine', '/api/mcp', '/api/webhook', '/api/oauth/callback'];
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** 一个 /api/ 请求算不算人的写操作：写方法、成功（< 400）、不在上面几个面。 */
export function countsAsMemberWrite(method: string, pathname: string, status: number): boolean {
  if (READ_METHODS.has(method.toUpperCase()) || status >= 400) return false;
  if (!pathname.startsWith('/api/')) return false;
  return !NON_MEMBER_API_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function recordMemberWrite(db: Db, at: number): void {
  db.insert(memberActivity)
    .values({ scope: MEMBER_ACTIVITY_SCOPE, at })
    .onConflictDoUpdate({ target: memberActivity.scope, set: { at } })
    .run();
}

export function lastMemberWriteAt(db: Db): number | null {
  return (
    db
      .select({ at: memberActivity.at })
      .from(memberActivity)
      .where(eq(memberActivity.scope, MEMBER_ACTIVITY_SCOPE))
      .get()?.at ?? null
  );
}

type AutonomyStateRow = typeof autonomyState.$inferSelect;

export function autonomyStateOf(
  db: Db,
  projectId: string,
  kind: AutonomyKind,
): AutonomyStateRow | null {
  return (
    db
      .select()
      .from(autonomyState)
      .where(and(eq(autonomyState.projectId, projectId), eq(autonomyState.kind, kind)))
      .get() ?? null
  );
}

function upsertState(
  db: Db,
  projectId: string,
  kind: AutonomyKind,
  set: Partial<Omit<AutonomyStateRow, 'projectId' | 'kind'>>,
): void {
  db.insert(autonomyState)
    .values({ projectId, kind, ...set })
    .onConflictDoUpdate({ target: [autonomyState.projectId, autonomyState.kind], set })
    .run();
}

/** 记一次判定的结果（放行记 null，被拦记原因）。 */
export function recordAutonomyVerdict(
  db: Db,
  projectId: string,
  kind: AutonomyKind,
  result: AutonomyGateResult,
  now: number,
): void {
  upsertState(db, projectId, kind, {
    lastBlockedReason: result.ok ? null : result.reason,
    lastEvaluatedAt: now,
  });
}

/** 记一次开跑（冷却从这里起算；baselineSha = 开跑时 main 的头，休眠闸用）。 */
export function recordAutonomyStart(
  db: Db,
  projectId: string,
  kind: AutonomyKind,
  now: number,
  baselineSha: string | null = null,
): void {
  upsertState(db, projectId, kind, { lastStartedAt: now, baselineSha });
}

// —— GET / PATCH /api/projects/{id}/autonomy ——————————————————————————————

export function readAutonomy(db: Db, projectId: string, now: number): AutonomyRecord {
  const row = db
    .select({ autonomy: project.autonomy })
    .from(project)
    .where(eq(project.id, projectId))
    .get();
  if (row === undefined) throw notFound('project');
  const states = db
    .select()
    .from(autonomyState)
    .where(eq(autonomyState.projectId, projectId))
    .all();
  return {
    settings: autonomySettingsOf(row),
    spentTodayUsd: autonomySpentToday(db, projectId, now),
    kinds: AUTONOMY_KINDS.map((kind) => {
      const s = states.find((x) => x.kind === kind);
      return {
        kind,
        lastStartedAt: s?.lastStartedAt ?? null,
        lastBlockedReason: s?.lastBlockedReason ?? null,
        lastEvaluatedAt: s?.lastEvaluatedAt ?? null,
      };
    }),
  };
}

export function patchAutonomy(
  db: Db,
  projectId: string,
  body: PatchAutonomyBody,
  now: number,
): AutonomyRecord {
  const row = db
    .select({ autonomy: project.autonomy })
    .from(project)
    .where(eq(project.id, projectId))
    .get();
  if (row === undefined) throw notFound('project');
  const next: AutonomySettings = { ...autonomySettingsOf(row), ...body };
  db.update(project).set({ autonomy: next }).where(eq(project.id, projectId)).run();
  return readAutonomy(db, projectId, now);
}
