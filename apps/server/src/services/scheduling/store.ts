import type { ScheduleReport } from '@cairn/shared';
import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { scheduleReport as scheduleReportTable } from '../../db/schema.js';

export type ScheduleReportRow = typeof scheduleReportTable.$inferSelect;

export function toScheduleReport(row: ScheduleReportRow): ScheduleReport {
  return {
    id: row.id,
    projectId: row.projectId,
    generatedAt: row.generatedAt,
    mainSha: row.mainSha,
    groups: row.groups,
    items: row.items,
    unparsedDeps: row.unparsedDeps,
    decidedAt: row.decidedAt ?? null,
    decidedBy: row.decidedBy ?? null,
    appliedAt: row.appliedAt ?? null,
  };
}

export function latestScheduleReport(db: Db, projectId: string): ScheduleReport | null {
  const row = db
    .select()
    .from(scheduleReportTable)
    .where(eq(scheduleReportTable.projectId, projectId))
    .orderBy(desc(scheduleReportTable.generatedAt))
    .limit(1)
    .get();
  return row === undefined ? null : toScheduleReport(row);
}

export function scheduleReportById(db: Db, projectId: string, id: string): ScheduleReport | null {
  const row = db
    .select()
    .from(scheduleReportTable)
    .where(and(eq(scheduleReportTable.projectId, projectId), eq(scheduleReportTable.id, id)))
    .get();
  return row === undefined ? null : toScheduleReport(row);
}

export function insertScheduleReport(db: Db, report: ScheduleReport): ScheduleReport {
  db.insert(scheduleReportTable)
    .values({
      id: report.id,
      projectId: report.projectId,
      generatedAt: report.generatedAt,
      mainSha: report.mainSha,
      groups: report.groups,
      items: report.items,
      unparsedDeps: report.unparsedDeps,
      decidedAt: report.decidedAt,
      decidedBy: report.decidedBy,
      appliedAt: report.appliedAt,
    })
    .run();
  return report;
}

export function markScheduleApplied(
  db: Db,
  projectId: string,
  id: string,
  at: number,
  decidedBy: string,
): void {
  const existing = scheduleReportById(db, projectId, id);
  if (existing === null) return;
  const items = existing.items.map((item) =>
    item.labelChange === null ? item : { ...item, labelChange: null },
  );
  db.update(scheduleReportTable)
    .set({ appliedAt: at, decidedAt: at, decidedBy, items })
    .where(and(eq(scheduleReportTable.projectId, projectId), eq(scheduleReportTable.id, id)))
    .run();
}

export function updateScheduleDecision(
  db: Db,
  projectId: string,
  id: string,
  decidedBy: string,
  at: number,
): void {
  db.update(scheduleReportTable)
    .set({ decidedAt: at, decidedBy })
    .where(and(eq(scheduleReportTable.projectId, projectId), eq(scheduleReportTable.id, id)))
    .run();
}
