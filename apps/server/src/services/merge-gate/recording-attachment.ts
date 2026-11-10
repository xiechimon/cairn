import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RECORDING_MAX_BYTES } from '@cairn/shared/merge-gate';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { attachment } from '../../db/schema.js';

export function hasVerifyRecording(
  deps: { db: Db; attachmentsDir?: string },
  producer: { stepId: string; todoId: string; teamId: string },
): boolean {
  if (deps.attachmentsDir === undefined) return false;
  const directory = deps.attachmentsDir;
  return deps.db
    .select()
    .from(attachment)
    .where(
      and(
        eq(attachment.createdBy, `step:${producer.stepId}`),
        eq(attachment.todoId, producer.todoId),
        eq(attachment.teamId, producer.teamId),
        eq(attachment.status, 'ready'),
      ),
    )
    .all()
    .some((row) => {
      if (
        !/\.gif$/i.test(row.fileName) ||
        row.mimeType !== 'image/gif' ||
        row.sizeBytes <= 0 ||
        row.sizeBytes > RECORDING_MAX_BYTES ||
        row.sha256 === null ||
        row.storageKey !== `${producer.teamId}/${row.id}.gif`
      ) {
        return false;
      }
      try {
        const bytes = readFileSync(join(directory, row.storageKey));
        return (
          bytes.length === row.sizeBytes &&
          createHash('sha256').update(bytes).digest('hex') === row.sha256
        );
      } catch {
        return false;
      }
    });
}
