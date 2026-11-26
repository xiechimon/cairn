import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { asc, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { type CommitEffects, runAfterCommit } from '../db/commit-effects.js';
import { attachment, build, designVersion, message } from '../db/schema.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import { recordDesignVersion } from './design.js';

export interface InfoReportDeps extends CommitEffects {
  db: Db;
  attachmentsDir: string;
}

export function storeInfoReport(
  deps: InfoReportDeps,
  input: { buildId: string; teamId: string; createdBy: string; report: string },
): string {
  const id = newRecordId();
  const storageKey = `${input.teamId}/${id}.md`;
  const path = join(deps.attachmentsDir, storageKey);
  const sha256 = createHash('sha256').update(input.report, 'utf8').digest('hex');
  const deferred = deps.commitEffects !== undefined;
  runAfterCommit(deps, 'writeInfoReport', () => {
    try {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, input.report, 'utf8');
    } catch (error) {
      if (deferred)
        deps.db.update(attachment).set({ status: 'failed' }).where(eq(attachment.id, id)).run();
      throw error;
    }
    if (deferred)
      deps.db.update(attachment).set({ status: 'ready' }).where(eq(attachment.id, id)).run();
  });
  const createdAt = nowMs();
  const buildRow = deps.db
    .select({ todoId: build.todoId })
    .from(build)
    .where(eq(build.id, input.buildId))
    .get();
  deps.db
    .insert(attachment)
    .values({
      id,
      teamId: input.teamId,
      todoId: buildRow?.todoId ?? null,
      sha256,
      createdBy: input.createdBy,
      fileName: 'report.md',
      mimeType: 'text/markdown',
      sizeBytes: Buffer.byteLength(input.report, 'utf8'),
      storageKey,
      grantId: `report-${input.buildId}`,
      scope: 'message',
      status: deferred ? 'pending' : 'ready',
      createdAt,
    })
    .run();
  if (buildRow !== undefined) {
    recordDesignVersion(deps.db, {
      teamId: input.teamId,
      todoId: buildRow.todoId,
      fileName: 'report.md',
      attachmentId: id,
      sha256,
      createdBy: input.createdBy,
      createdAt,
    });
  }
  deps.db.update(build).set({ reportAttachmentId: id }).where(eq(build.id, input.buildId)).run();
  const reportMessage = {
    kind: 'info-report' as const,
    attachmentId: id,
    attachmentToken: `![report.md](attachment:${storageKey})`,
    content: input.report,
  };
  deps.db
    .insert(message)
    .values({
      id: `info-report-${input.buildId}`,
      conversationId: input.buildId,
      role: 'system',
      content: JSON.stringify(reportMessage),
      createdAt,
    })
    .onConflictDoUpdate({
      target: message.id,
      set: { content: JSON.stringify(reportMessage), createdAt },
    })
    .run();
  return id;
}

function readLegacyReportSha(
  attachmentsDir: string | undefined,
  storageKey: string,
  fallback: string | null,
): string | null {
  if (fallback !== null) return fallback;
  if (attachmentsDir === undefined) return null;
  const path = join(attachmentsDir, storageKey);
  if (!existsSync(path)) return null;
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export function backfillInfoReportVersions(db: Db, attachmentsDir?: string): number {
  const existing = new Set(
    db
      .select({ attachmentId: designVersion.attachmentId })
      .from(designVersion)
      .all()
      .map((r) => r.attachmentId),
  );
  const rows = db
    .select({
      todoId: build.todoId,
      teamId: attachment.teamId,
      attachmentId: attachment.id,
      fileName: attachment.fileName,
      storageKey: attachment.storageKey,
      sha256: attachment.sha256,
      createdBy: attachment.createdBy,
      createdAt: attachment.createdAt,
    })
    .from(build)
    .innerJoin(attachment, eq(build.reportAttachmentId, attachment.id))
    .orderBy(asc(build.createdAt))
    .all();
  let inserted = 0;
  for (const row of rows) {
    if (existing.has(row.attachmentId)) continue;
    const version = recordDesignVersion(db, {
      teamId: row.teamId,
      todoId: row.todoId,
      fileName: row.fileName,
      attachmentId: row.attachmentId,
      sha256: readLegacyReportSha(attachmentsDir, row.storageKey, row.sha256),
      createdBy: row.createdBy,
      createdAt: row.createdAt,
    });
    if (version !== undefined) {
      existing.add(row.attachmentId);
      inserted += 1;
    }
  }
  return inserted;
}
