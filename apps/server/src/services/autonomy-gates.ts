import {
  type ActionTier,
  AUTONOMY_KINDS,
  type AutonomyGateReason,
  type AutonomyKind,
  type AutonomyRecord,
  type AutonomySettings,
  DEFAULT_AUTONOMY_SETTINGS,
  type PatchAutonomyBody,
  type PatchTeamAutonomyBody,
  type StoredAutonomySettings,
  type TeamAutonomy,
} from '@cairn/shared';
import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  autonomyState,
  build,
  memberActivity,
  project,
  team,
  todo,
  tokenUsage,
} from '../db/schema.js';
import { notFound } from '../lib/errors.js';

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

const MEMBER_ACTIVITY_SCOPE = 'server';

const AUTONOMOUS_TRIGGERS = ['chief', 'schedule', 'retry'] as const;

export interface AutonomyGateInput {
  now: number;
  settings: AutonomySettings;
  dormancy?: { baselineSha: string | null; currentSha: string | null };
  inFlight: number;
  inFlightCap: number;
  lastMemberWriteAt: number | null;
  lastStartedAt: number | null;
  spentTodayUsd: number | null;
}

export type AutonomyGateResult = { ok: true } | { ok: false; reason: AutonomyGateReason };

function within(now: number, at: number | null, minutes: number): boolean {
  return minutes > 0 && at !== null && Math.abs(now - at) < minutes * MINUTE_MS;
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

export function utcDayStart(now: number): number {
  return Math.floor(now / DAY_MS) * DAY_MS;
}

export function autonomySettingsOf(row: {
  autonomy: StoredAutonomySettings | null;
}): AutonomySettings {
  return {
    ...DEFAULT_AUTONOMY_SETTINGS,
    ...(row.autonomy ?? {}),
    actionTier: row.autonomy?.actionTier ?? DEFAULT_AUTONOMY_SETTINGS.actionTier,
  };
}

export function teamActionTierOf(db: Db, teamId: string): ActionTier {
  const row = db
    .select({ actionTier: team.actionTier })
    .from(team)
    .where(eq(team.id, teamId))
    .get();
  return row?.actionTier ?? DEFAULT_AUTONOMY_SETTINGS.actionTier;
}

export function actionTierOf(db: Db, teamId: string, projectId: string | null): ActionTier {
  if (projectId !== null) {
    const row = db
      .select({ autonomy: project.autonomy, teamId: project.teamId })
      .from(project)
      .where(eq(project.id, projectId))
      .get();
    if (row !== undefined && row.teamId === teamId && row.autonomy?.actionTier != null) {
      return row.autonomy.actionTier;
    }
  }
  return teamActionTierOf(db, teamId);
}

export function spentForGate(
  db: Db,
  projectId: string,
  settings: AutonomySettings,
  now: number,
): number | null {
  return settings.enabled && settings.dailyBudgetUsd > 0
    ? autonomySpentToday(db, projectId, now)
    : 0;
}

export function evaluateRequestedRun(
  db: Db,
  row: { id: string; autonomy: StoredAutonomySettings | null },
  now: number,
): AutonomyGateResult {
  const settings = autonomySettingsOf(row);
  return evaluateAutonomyGates({
    now,
    settings,
    inFlight: 0,
    inFlightCap: 1,
    lastMemberWriteAt: null,
    lastStartedAt: null,
    spentTodayUsd: spentForGate(db, row.id, settings, now),
  });
}

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

const NON_MEMBER_API_PREFIXES = ['/api/machine', '/api/mcp', '/api/oauth/callback'];
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

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

export function recordAutonomyStart(
  db: Db,
  projectId: string,
  kind: AutonomyKind,
  now: number,
  baselineSha: string | null = null,
): void {
  upsertState(db, projectId, kind, { lastStartedAt: now, baselineSha });
}

export function readAutonomy(db: Db, projectId: string, now: number): AutonomyRecord {
  const row = db
    .select({ autonomy: project.autonomy, teamId: project.teamId })
    .from(project)
    .where(eq(project.id, projectId))
    .get();
  if (row === undefined) throw notFound('project');
  const states = db
    .select()
    .from(autonomyState)
    .where(eq(autonomyState.projectId, projectId))
    .all();
  const actionTier = row.autonomy?.actionTier ?? teamActionTierOf(db, row.teamId);
  return {
    settings: { ...autonomySettingsOf(row), actionTier },
    actionTierOverride: row.autonomy?.actionTier ?? null,
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
  const next = { ...(row.autonomy ?? {}), ...body };
  db.update(project).set({ autonomy: next }).where(eq(project.id, projectId)).run();
  return readAutonomy(db, projectId, now);
}

export function readTeamAutonomy(db: Db, teamId: string): TeamAutonomy {
  return { actionTier: teamActionTierOf(db, teamId) };
}

export function patchTeamAutonomy(
  db: Db,
  teamId: string,
  body: PatchTeamAutonomyBody,
): TeamAutonomy {
  if (body.actionTier !== undefined) {
    db.update(team).set({ actionTier: body.actionTier }).where(eq(team.id, teamId)).run();
  }
  return readTeamAutonomy(db, teamId);
}
