import { type DailyUsage, type DailyUsageDay, type DailyUsageModel, localDay } from '@cairn/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { project } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { loadTeamModelCatalog, resolveTeamModelEntry } from './model-catalog.js';
import { costFromRates, ratesForModel, type TokenCounts } from './token-usage-cost.js';

const SLOT_MS = 15 * 60_000;
const PREFILTER_SLACK_MS = 26 * 3_600_000;

interface SlotRow extends TokenCounts {
  coordinator: number;
  slot: number;
  model: string;
  projectId: string | null;
  todoId: string | null;
}

function windowDates(now: number, days: number, tz: string): { dates: Set<string>; from: number } {
  const [y = 1970, m = 1, d = 1] = localDay(now, tz).split('-').map(Number);
  const dates = new Set<string>();
  for (let back = 0; back < days; back += 1) {
    dates.add(new Date(Date.UTC(y, m - 1, d - back)).toISOString().slice(0, 10));
  }
  return { dates, from: Date.UTC(y, m - 1, d - (days - 1)) - PREFILTER_SLACK_MS };
}

const TYPES = ['input', 'output', 'cacheRead', 'cacheWrite'] as const;

function usageSlots(db: Db, teamId: string, from: number, to: number): SlotRow[] {
  const total = (t: string) =>
    sql.raw(`(${t}.input + ${t}.output + ${t}.cacheRead + ${t}.cacheWrite)`);
  const sums = (expr: (type: string) => string) =>
    sql.raw(TYPES.map((type) => `sum(${expr(type)}) AS ${type}`).join(', '));
  return db.all<SlotRow>(sql`
    WITH
    chief_legacy AS (
      SELECT ctu.threadId AS threadId, ct.projectId AS projectId, ctu.model AS model,
        ctu.firstReportAt AS at,
        ctu.input AS input, ctu.output AS output, ctu.cacheRead AS cacheRead,
        ctu.cacheWrite AS cacheWrite,
        CASE WHEN ${total('ctu')} = 0 THEN 0
          ELSE 1.0 * max(0, ${total('ctu')} - coalesce(su.mirroredTokens, 0)) / ${total('ctu')}
        END AS kept
      FROM chief_turn_usage ctu
      JOIN chief_thread ct ON ct.id = ctu.threadId AND ct.teamId = ${teamId}
      LEFT JOIN step_usage su ON su.stepId = ctu.stepId AND su.model = ctu.model
    ),
    new_by_key AS (
      SELECT buildId, model, ${sums((type) => type)}
      FROM step_usage WHERE teamId = ${teamId}
      GROUP BY buildId, model
    ),
    chief_legacy_by_key AS (
      SELECT threadId, model, ${sums((type) => `${type} * kept`)}
      FROM chief_legacy GROUP BY threadId, model
    )
    SELECT su.kind = 'chief' AS coordinator, su.createdAt / ${SLOT_MS} AS slot, su.model AS model,
      coalesce(td.projectId, ct.projectId) AS projectId, td.id AS todoId,
      ${sums((type) => `su.${type}`)}
    FROM step_usage su
    LEFT JOIN build b ON b.id = su.buildId AND su.kind != 'chief'
    LEFT JOIN todo td ON td.id = b.todoId AND td.teamId = ${teamId}
    LEFT JOIN chief_thread ct ON ct.id = su.buildId AND su.kind = 'chief' AND ct.teamId = ${teamId}
    WHERE su.teamId = ${teamId} AND su.createdAt >= ${from} AND su.createdAt <= ${to}
    GROUP BY 1, 2, 3, 4, 5
    UNION ALL
    SELECT 1, at / ${SLOT_MS}, model, projectId, NULL, ${sums((type) => `${type} * kept`)}
    FROM chief_legacy WHERE at >= ${from} AND at <= ${to}
    GROUP BY 2, 3, 4
    UNION ALL
    SELECT 1, ct.createdAt / ${SLOT_MS}, tu.model, ct.projectId, NULL,
      ${sums((type) => `max(0, tu.${type} - coalesce(n.${type}, 0) - coalesce(l.${type}, 0))`)}
    FROM token_usage tu
    JOIN chief_thread ct ON ct.id = tu.buildId AND ct.teamId = ${teamId}
    LEFT JOIN new_by_key n ON n.buildId = tu.buildId AND n.model = tu.model
    LEFT JOIN chief_legacy_by_key l ON l.threadId = tu.buildId AND l.model = tu.model
    WHERE ct.createdAt >= ${from} AND ct.createdAt <= ${to}
    GROUP BY 2, 3, 4
    UNION ALL
    SELECT 0, b.createdAt / ${SLOT_MS}, tu.model, td.projectId, td.id,
      ${sums((type) => `max(0, tu.${type} - coalesce(n.${type}, 0))`)}
    FROM token_usage tu
    JOIN build b ON b.id = tu.buildId
    JOIN todo td ON td.id = b.todoId AND td.teamId = ${teamId}
    LEFT JOIN new_by_key n ON n.buildId = tu.buildId AND n.model = tu.model
    WHERE b.createdAt >= ${from} AND b.createdAt <= ${to}
    GROUP BY 2, 3, 4, 5
  `);
}

interface DayAcc {
  date: string;
  coordinator: number;
  tasks: number;
  types: TokenCounts;
  models: Map<string, TokenCounts>;
  projects: Map<string, number>;
  todos: Set<string>;
}

const zero = (): TokenCounts => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });

function addTo(acc: TokenCounts, row: TokenCounts) {
  for (const type of TYPES) acc[type] += row[type];
}

function modelLabels(db: Db, teamId: string, keys: readonly string[]): DailyUsageModel[] {
  const catalog = loadTeamModelCatalog(db, teamId, { includeBuiltins: false });
  return keys.map((key) => {
    const resolved = resolveTeamModelEntry(catalog, key, null, { formatFallback: false });
    return {
      key,
      name: resolved.modelName,
      provider: resolved.providerLabel ?? '',
    };
  });
}

export function dailyUsage(
  db: Db,
  teamId: string,
  { days, tz, now }: { days: number; tz: string; now: number },
): DailyUsage {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz });
  } catch {
    throw new HttpError(400, `unknown time zone ${tz}`);
  }
  const { dates, from } = windowDates(now, days, tz);
  const byDate = new Map<string, DayAcc>();
  for (const row of usageSlots(db, teamId, from, now)) {
    const tokens = row.input + row.output + row.cacheRead + row.cacheWrite;
    if (tokens <= 0) continue;
    const date = localDay(row.slot * SLOT_MS, tz);
    if (!dates.has(date)) continue;
    const day = byDate.get(date) ?? {
      date,
      coordinator: 0,
      tasks: 0,
      types: zero(),
      models: new Map(),
      projects: new Map(),
      todos: new Set(),
    };
    if (row.coordinator === 1) day.coordinator += tokens;
    else day.tasks += tokens;
    addTo(day.types, row);
    const model = day.models.get(row.model) ?? zero();
    addTo(model, row);
    day.models.set(row.model, model);
    if (row.projectId !== null)
      day.projects.set(row.projectId, (day.projects.get(row.projectId) ?? 0) + tokens);
    if (row.todoId !== null) day.todos.add(row.todoId);
    byDate.set(date, day);
  }
  const accs = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  const modelKeys = [...new Set(accs.flatMap((day) => [...day.models.keys()]))].sort();
  const rates = new Map(modelKeys.map((key) => [key, ratesForModel(db, teamId, key)]));
  const projectIds = [...new Set(accs.flatMap((day) => [...day.projects.keys()]))];
  const result: DailyUsageDay[] = accs.map((day) => {
    let cost: number | null = 0;
    for (const [key, counts] of day.models) {
      const rate = rates.get(key);
      cost =
        rate === undefined || cost === null ? null : cost + costFromRates(counts, rate).costTotal;
    }
    return {
      date: day.date,
      coordinator: Math.round(day.coordinator),
      tasks: Math.round(day.tasks),
      input: Math.round(day.types.input),
      output: Math.round(day.types.output),
      cacheRead: Math.round(day.types.cacheRead),
      cacheWrite: Math.round(day.types.cacheWrite),
      models: Object.fromEntries(
        [...day.models].map(([key, counts]) => [
          key,
          Math.round(counts.input + counts.output + counts.cacheRead + counts.cacheWrite),
        ]),
      ),
      projects: Object.fromEntries(
        [...day.projects].map(([id, tokens]) => [id, Math.round(tokens)]),
      ),
      todos: [...day.todos].sort(),
      cost,
    };
  });
  return {
    days: result,
    models: modelLabels(db, teamId, modelKeys),
    projects:
      projectIds.length === 0
        ? []
        : db
            .select({ id: project.id, name: project.name })
            .from(project)
            .where(and(eq(project.teamId, teamId), inArray(project.id, projectIds)))
            .all(),
  };
}
