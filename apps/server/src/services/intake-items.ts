import {
  CHIEF_REPORT_INTAKE_MAX,
  INTAKE_SOURCE_KIND,
  infoReportMessageSchema,
  RESEARCH_INTAKE_HISTORY_DAYS,
  RESEARCH_INTAKE_SOURCE_KIND,
} from '@cairn/shared';
import { and, asc, count, desc, eq, gte, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { chiefReport, message, retroProposal, todo } from '../db/schema.js';
import { newRecordId } from '../lib/ids.js';
import { checkedResearchReport } from './research-citations.js';

const DAY_MS = 86_400_000;
const FIELD_MAX = 400;
const TITLE_MAX = 120;
const RECENT_INTAKE_THREADS = 2;
const NO_VALUE = '无';
const DELIVERY_PREFIX = 'research-intake-delivery:';
const deliverySchema = z.object({ todoIds: z.array(z.string()).max(RECENT_INTAKE_THREADS) });
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

export function pendingIntakeReports(db: Db): string[] {
  return db
    .select({ id: chiefReport.id })
    .from(message)
    .innerJoin(chiefReport, eq(message.id, sql`${DELIVERY_PREFIX} || ${chiefReport.id}`))
    .where(
      and(
        gte(message.id, DELIVERY_PREFIX),
        lt(message.id, 'research-intake-delivery;'),
        inArray(chiefReport.status, ['posted', 'empty']),
        isNotNull(chiefReport.inputs),
      ),
    )
    .orderBy(asc(message.createdAt), asc(message.id))
    .limit(5)
    .all()
    .map((row) => row.id);
}

export function ingestIntake(
  db: Db,
  report: { id: string; teamId: string; chiefId: string },
  now: number,
): number {
  const ownReports = db
    .select({ id: chiefReport.id })
    .from(chiefReport)
    .where(eq(chiefReport.chiefId, report.chiefId));
  const deliveryId = `${DELIVERY_PREFIX}${report.id}`;
  const queued = db.select().from(message).where(eq(message.id, deliveryId)).get();
  let queuedContent: unknown = queued?.content;
  if (typeof queuedContent === 'string') {
    try {
      queuedContent = JSON.parse(queuedContent);
    } catch {
      queuedContent = null;
    }
  }
  const delivery = queued === undefined ? null : deliverySchema.safeParse(queuedContent);
  if (delivery !== null && !delivery.success) {
    db.update(message).set({ createdAt: now }).where(eq(message.id, deliveryId)).run();
    return 0;
  }
  const pinned = delivery?.success ? delivery.data.todoIds : null;
  const recent =
    pinned === null
      ? db
          .select()
          .from(todo)
          .where(
            and(
              eq(todo.teamId, report.teamId),
              eq(todo.sourceKind, RESEARCH_INTAKE_SOURCE_KIND),
              isNull(todo.archivedAt),
            ),
          )
          .orderBy(desc(todo.sourceRef))
          .limit(RECENT_INTAKE_THREADS)
          .all()
          .reverse()
      : db
          .select()
          .from(todo)
          .where(
            and(
              eq(todo.teamId, report.teamId),
              eq(todo.sourceKind, RESEARCH_INTAKE_SOURCE_KIND),
              isNull(todo.archivedAt),
              inArray(todo.id, pinned),
            ),
          )
          .all()
          .sort((a, b) => pinned.indexOf(a.id) - pinned.indexOf(b.id));
  if (recent.length === 0) {
    if (queued) db.delete(message).where(eq(message.id, deliveryId)).run();
    return 0;
  }
  const history = db
    .select({ sourceId: retroProposal.sourceId })
    .from(retroProposal)
    .where(
      and(
        eq(retroProposal.teamId, report.teamId),
        inArray(retroProposal.reportId, ownReports),
        eq(retroProposal.sourceKind, INTAKE_SOURCE_KIND),
        gte(retroProposal.createdAt, now - RESEARCH_INTAKE_HISTORY_DAYS * DAY_MS),
      ),
    )
    .all();
  const seen = new Set(history.map((row) => row.sourceId));
  const ingested = new Set(
    db
      .select({ sourceTodoId: retroProposal.sourceTodoId })
      .from(retroProposal)
      .where(
        and(
          inArray(retroProposal.reportId, ownReports),
          eq(retroProposal.sourceKind, INTAKE_SOURCE_KIND),
          inArray(
            retroProposal.sourceTodoId,
            recent.map((row) => row.id),
          ),
        ),
      )
      .all()
      .map((row) => row.sourceTodoId),
  );
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
  const pending: string[] = [];
  for (const intake of recent) {
    if (slots <= 0) break;
    if (ingested.has(intake.id)) continue;
    if (intake.latestBuildId === null) {
      pending.push(intake.id);
      continue;
    }
    const text = landedReport(db, intake.latestBuildId);
    if (text === null) {
      pending.push(intake.id);
      continue;
    }
    const items = parseIntakeItems(text);
    if (items.length === 0) continue;
    const checked = checkedResearchReport(db, intake.latestBuildId);
    if (checked === null) {
      pending.push(intake.id);
      continue;
    }
    for (const item of items) {
      if (
        !checked.claims.some(
          (claim) =>
            claim.verdict === 'supported' &&
            normalizeIntakeUrl(claim.url) === item.url &&
            claim.claim.trim().slice(0, FIELD_MAX) === item.claim,
        )
      )
        continue;
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
  if (pending.length > 0 && slots > 0) {
    const content = { todoIds: pending };
    db.insert(message)
      .values({
        id: deliveryId,
        conversationId: deliveryId,
        role: 'system',
        content,
        createdAt: now,
      })
      .onConflictDoUpdate({ target: message.id, set: { content, createdAt: now } })
      .run();
  } else db.delete(message).where(eq(message.id, deliveryId)).run();
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
