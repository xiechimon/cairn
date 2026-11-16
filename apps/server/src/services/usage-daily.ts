import type { DailyUsage, DailyUsageDay } from '@cairn/shared';
import { sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { HttpError } from '../lib/errors.js';
import { localDay } from './chief-report.js';

const SLOT_MS = 15 * 60_000;
const PREFILTER_SLACK_MS = 26 * 3_600_000;

interface SlotRow {
  coordinator: number;
  slot: number;
  tokens: number;
}

function windowDates(now: number, days: number, tz: string): { dates: Set<string>; from: number } {
  const [y = 1970, m = 1, d = 1] = localDay(now, tz).split('-').map(Number);
  const dates = new Set<string>();
  for (let back = 0; back < days; back += 1) {
    dates.add(new Date(Date.UTC(y, m - 1, d - back)).toISOString().slice(0, 10));
  }
  return { dates, from: Date.UTC(y, m - 1, d - (days - 1)) - PREFILTER_SLACK_MS };
}

function usageSlots(db: Db, teamId: string, from: number, to: number): SlotRow[] {
  const total = (t: string) =>
    sql.raw(`(${t}.input + ${t}.output + ${t}.cacheRead + ${t}.cacheWrite)`);
  return db.all<SlotRow>(sql`
    WITH
    chief_legacy AS (
      SELECT ctu.threadId AS threadId, ctu.model AS model, ctu.createdAt AS at,
        max(0, ${total('ctu')} - coalesce(su.mirroredTokens, 0)) AS tokens
      FROM chief_turn_usage ctu
      JOIN chief_thread ct ON ct.id = ctu.threadId AND ct.teamId = ${teamId}
      LEFT JOIN step_usage su ON su.stepId = ctu.stepId AND su.model = ctu.model
    ),
    new_by_key AS (
      SELECT buildId, model, sum(${total('step_usage')}) AS tokens
      FROM step_usage WHERE teamId = ${teamId}
      GROUP BY buildId, model
    ),
    chief_legacy_by_key AS (
      SELECT threadId, model, sum(tokens) AS tokens FROM chief_legacy GROUP BY threadId, model
    )
    SELECT kind = 'chief' AS coordinator, createdAt / ${SLOT_MS} AS slot,
      sum(${total('step_usage')}) AS tokens
    FROM step_usage
    WHERE teamId = ${teamId} AND createdAt >= ${from} AND createdAt <= ${to}
    GROUP BY 1, 2
    UNION ALL
    SELECT 1, at / ${SLOT_MS}, sum(tokens)
    FROM chief_legacy WHERE at >= ${from} AND at <= ${to}
    GROUP BY 2
    UNION ALL
    SELECT 1, ct.createdAt / ${SLOT_MS},
      sum(max(0, ${total('tu')} - coalesce(n.tokens, 0) - coalesce(l.tokens, 0)))
    FROM token_usage tu
    JOIN chief_thread ct ON ct.id = tu.buildId AND ct.teamId = ${teamId}
    LEFT JOIN new_by_key n ON n.buildId = tu.buildId AND n.model = tu.model
    LEFT JOIN chief_legacy_by_key l ON l.threadId = tu.buildId AND l.model = tu.model
    WHERE ct.createdAt >= ${from} AND ct.createdAt <= ${to}
    GROUP BY 2
    UNION ALL
    SELECT 0, b.createdAt / ${SLOT_MS}, sum(max(0, ${total('tu')} - coalesce(n.tokens, 0)))
    FROM token_usage tu
    JOIN build b ON b.id = tu.buildId
    JOIN todo td ON td.id = b.todoId AND td.teamId = ${teamId}
    LEFT JOIN new_by_key n ON n.buildId = tu.buildId AND n.model = tu.model
    WHERE b.createdAt >= ${from} AND b.createdAt <= ${to}
    GROUP BY 2
  `);
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
  const byDate = new Map<string, DailyUsageDay>();
  for (const row of usageSlots(db, teamId, from, now)) {
    if (row.tokens <= 0) continue;
    const date = localDay(row.slot * SLOT_MS, tz);
    if (!dates.has(date)) continue;
    const day = byDate.get(date) ?? { date, coordinator: 0, tasks: 0 };
    if (row.coordinator === 1) day.coordinator += row.tokens;
    else day.tasks += row.tokens;
    byDate.set(date, day);
  }
  return { days: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)) };
}
