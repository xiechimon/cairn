import {
  CHIEF_REPORT_INTAKE_MAX,
  INTAKE_SOURCE_KIND,
  infoReportMessageSchema,
  RESEARCH_INTAKE_HISTORY_DAYS,
  RESEARCH_INTAKE_SOURCE_KIND,
} from '@cairn/shared';
import { and, count, desc, eq, gte, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { message, retroProposal, todo } from '../db/schema.js';
import { newRecordId } from '../lib/ids.js';

const DAY_MS = 86_400_000;
const FIELD_MAX = 400;
const TITLE_MAX = 120;
const RECENT_INTAKE_THREADS = 2;
const NO_VALUE = '无';
const FENCED_JSON = /```json\s*\n([\s\S]*?)\n```/g;

const rawItemSchema = z.object({
  url: z.string(),
  claim: z.string(),
  matches: z.string().optional(),
  action: z.string().optional(),
});

export interface ParsedIntakeItem {
  url: string;
  claim: string;
  matches: string;
  action: string;
}

export interface IntakeTally {
  accepted: number;
  dismissed: number;
  ignored: number;
}

export function normalizeIntakeUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const params = [...url.searchParams]
    .filter(([key]) => !/^utm_/i.test(key) && key.toLowerCase() !== 'ref')
    .sort(([a], [b]) => a.localeCompare(b));
  const search = new URLSearchParams(params).toString();
  const path = url.pathname.replace(/\/+$/, '');
  return `${url.protocol}//${url.host.replace(/^www\./, '')}${path}${search === '' ? '' : `?${search}`}`;
}

export function parseIntakeItems(reportText: string): ParsedIntakeItem[] {
  const block = [...reportText.matchAll(FENCED_JSON)].at(-1)?.[1];
  if (block === undefined) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(block);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const items: ParsedIntakeItem[] = [];
  for (const entry of parsed) {
    const raw = rawItemSchema.safeParse(entry);
    if (!raw.success) continue;
    const url = normalizeIntakeUrl(raw.data.url);
    const claim = raw.data.claim.trim().slice(0, FIELD_MAX);
    if (url === null || claim === '') continue;
    items.push({
      url,
      claim,
      matches: (raw.data.matches ?? '').trim().slice(0, FIELD_MAX),
      action: (raw.data.action ?? '').trim().slice(0, FIELD_MAX),
    });
  }
  return items;
}

export function recentIntakeItems(
  db: Db,
  teamId: string,
  now: number,
): { url: string; claim: string }[] {
  return db
    .select({ url: retroProposal.sourceId, claim: retroProposal.what })
    .from(retroProposal)
    .where(
      and(
        eq(retroProposal.teamId, teamId),
        eq(retroProposal.sourceKind, INTAKE_SOURCE_KIND),
        gte(retroProposal.createdAt, now - RESEARCH_INTAKE_HISTORY_DAYS * DAY_MS),
      ),
    )
    .orderBy(retroProposal.createdAt)
    .all();
}

function landedReport(db: Db, buildId: string): string | null {
  const row = db
    .select({ content: message.content })
    .from(message)
    .where(eq(message.id, `info-report-${buildId}`))
    .get();
  if (row === undefined) return null;
  let content: unknown = row.content;
  if (typeof content === 'string') {
    try {
      content = JSON.parse(content);
    } catch {
      return null;
    }
  }
  const report = infoReportMessageSchema.safeParse(content);
  return report.success ? report.data.content : null;
}

export function ingestIntake(db: Db, report: { id: string; teamId: string }, now: number): number {
  const recent = db
    .select()
    .from(todo)
    .where(and(eq(todo.teamId, report.teamId), eq(todo.sourceKind, RESEARCH_INTAKE_SOURCE_KIND)))
    .orderBy(desc(todo.sourceRef))
    .limit(RECENT_INTAKE_THREADS)
    .all()
    .reverse();
  if (recent.length === 0) return 0;
  const history = db
    .select({ sourceId: retroProposal.sourceId, sourceTodoId: retroProposal.sourceTodoId })
    .from(retroProposal)
    .where(
      and(
        eq(retroProposal.teamId, report.teamId),
        eq(retroProposal.sourceKind, INTAKE_SOURCE_KIND),
        gte(retroProposal.createdAt, now - RESEARCH_INTAKE_HISTORY_DAYS * DAY_MS),
      ),
    )
    .all();
  const seen = new Set(history.map((row) => row.sourceId));
  const ingested = new Set(history.map((row) => row.sourceTodoId));
  let slots =
    CHIEF_REPORT_INTAKE_MAX -
    (db
      .select({ n: count() })
      .from(retroProposal)
      .where(
        and(
          eq(retroProposal.reportId, report.id),
          eq(retroProposal.sourceKind, INTAKE_SOURCE_KIND),
        ),
      )
      .get()?.n ?? 0);
  let added = 0;
  for (const intake of recent) {
    if (slots <= 0) break;
    if (ingested.has(intake.id) || intake.latestBuildId === null) continue;
    const text = landedReport(db, intake.latestBuildId);
    if (text === null) continue;
    for (const item of parseIntakeItems(text)) {
      if (slots <= 0) break;
      if (seen.has(item.url)) continue;
      seen.add(item.url);
      db.insert(retroProposal)
        .values({
          id: newRecordId(),
          reportId: report.id,
          teamId: report.teamId,
          projectId: intake.projectId,
          title: item.claim.slice(0, TITLE_MAX),
          what: item.claim,
          why: item.matches === '' ? NO_VALUE : item.matches,
          safeguard: item.action === '' ? NO_VALUE : item.action,
          sourceKind: INTAKE_SOURCE_KIND,
          sourceId: item.url,
          sourceLabel: new URL(item.url).host.slice(0, TITLE_MAX),
          sourceTodoId: intake.id,
          status: 'draft',
          createdAt: now,
        })
        .run();
      slots--;
      added++;
    }
  }
  return added;
}

export function intakeTally(db: Db, teamId: string, since: number): IntakeTally {
  const rows = db
    .select({ status: retroProposal.status, n: count() })
    .from(retroProposal)
    .where(
      and(
        eq(retroProposal.teamId, teamId),
        eq(retroProposal.sourceKind, INTAKE_SOURCE_KIND),
        gte(retroProposal.createdAt, since),
        inArray(retroProposal.status, ['draft', 'accepted', 'dismissed']),
      ),
    )
    .groupBy(retroProposal.status)
    .all();
  const of = (status: string) => rows.find((row) => row.status === status)?.n ?? 0;
  return { accepted: of('accepted'), dismissed: of('dismissed'), ignored: of('draft') };
}
