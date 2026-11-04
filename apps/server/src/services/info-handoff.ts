import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { attachment, build, message } from '../db/schema.js';
import { newRecordId, nowMs } from '../lib/ids.js';

export interface InfoReportDeps {
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
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, input.report, 'utf8');
  const createdAt = nowMs();
  deps.db
    .insert(attachment)
    .values({
      id,
      teamId: input.teamId,
      createdBy: input.createdBy,
      fileName: 'report.md',
      mimeType: 'text/markdown',
      sizeBytes: Buffer.byteLength(input.report, 'utf8'),
      storageKey,
      grantId: `report-${input.buildId}`,
      scope: 'message',
      status: 'ready',
      createdAt,
    })
    .run();
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
    .onConflictDoUpdate({ target: message.id, set: { content: JSON.stringify(reportMessage) } })
    .run();
  return id;
}
