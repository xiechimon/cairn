import {
  attachmentExtOf,
  DELIVERABLES_MESSAGE_PREFIX,
  type DeliverableKind,
  type DeliverablesMessage,
  formatAttachmentToken,
  INLINE_IMAGE_EXTS,
} from '@cairn/shared';
import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { attachment, build, message } from '../db/schema.js';
import { nowMs } from '../lib/ids.js';
import { recordDesignVersion } from './design.js';

const KIND_EXTS: Record<DeliverableKind, readonly string[]> = {
  page: ['html'],
  slides: ['pptx', 'pdf'],
  image: INLINE_IMAGE_EXTS,
};

export function deliverableKindOf(fileName: string): DeliverableKind {
  const ext = attachmentExtOf(fileName);
  if (KIND_EXTS.page.includes(ext)) return 'page';
  if (KIND_EXTS.image.includes(ext)) return 'image';
  return 'slides';
}

export interface DeliverableManifest {
  generation: number;
  files: { name: string; sha256: string }[];
  skipped: { name: string; reason: string }[];
}

export function deliverableGrantId(stepId: string, generation: number): string {
  return `deliverable:${stepId}:${generation}`;
}

function failRows(db: Db, rows: { id: string; status: string }[]): void {
  const pending = rows.filter((r) => r.status === 'pending').map((r) => r.id);
  const received = rows.filter((r) => r.status !== 'pending').map((r) => r.id);
  if (pending.length > 0) {
    db.update(attachment)
      .set({ status: 'failed', sizeBytes: 0 })
      .where(inArray(attachment.id, pending))
      .run();
  }
  if (received.length > 0) {
    db.update(attachment).set({ status: 'failed' }).where(inArray(attachment.id, received)).run();
  }
}

export function deliverableManifestFailure(
  db: Db,
  stepId: string,
  manifest: DeliverableManifest,
): string | null {
  const received = db
    .select({ fileName: attachment.fileName, sha256: attachment.sha256 })
    .from(attachment)
    .where(
      and(
        eq(attachment.grantId, deliverableGrantId(stepId, manifest.generation)),
        eq(attachment.status, 'received'),
      ),
    )
    .all();
  const names = new Set<string>();
  for (const entry of manifest.files) {
    if (names.has(entry.name)) return `成果文件重复：${entry.name}`;
    names.add(entry.name);
    if (!received.some((r) => r.fileName === entry.name && r.sha256 === entry.sha256)) {
      return `成果文件未收到：${entry.name}`;
    }
  }
  return null;
}

export function publishDeliverables(
  db: Db,
  input: { stepId: string; buildId: string; manifest: DeliverableManifest },
): void {
  const grantId = deliverableGrantId(input.stepId, input.manifest.generation);
  const rows = db
    .select()
    .from(attachment)
    .where(and(eq(attachment.grantId, grantId), eq(attachment.status, 'received')))
    .all();
  const accepted = input.manifest.files.flatMap((entry) => {
    const row = rows.find((r) => r.fileName === entry.name && r.sha256 === entry.sha256);
    return row === undefined ? [] : [row];
  });
  if (accepted.length > 0) {
    db.update(attachment)
      .set({ status: 'ready' })
      .where(
        inArray(
          attachment.id,
          accepted.map((r) => r.id),
        ),
      )
      .run();
  }
  failUnpublishedDeliverables(db, input.stepId, input.manifest.generation);
  const content: DeliverablesMessage = {
    kind: 'deliverables',
    items: accepted.map((r) => ({
      attachmentId: r.id,
      kind: deliverableKindOf(r.fileName),
      name: r.fileName,
      sizeBytes: r.sizeBytes,
      attachmentToken: formatAttachmentToken(r.fileName.replace(/[[\]\n\r]/g, '_'), r.storageKey),
    })),
    skipped: input.manifest.skipped,
  };
  const createdAt = nowMs();
  for (const r of accepted) {
    if (r.todoId === null) continue;
    recordDesignVersion(db, {
      teamId: r.teamId,
      todoId: r.todoId,
      fileName: r.fileName,
      attachmentId: r.id,
      sha256: r.sha256,
      createdBy: r.createdBy,
      createdAt,
    });
  }
  db.insert(message)
    .values({
      id: `${DELIVERABLES_MESSAGE_PREFIX}${input.buildId}`,
      conversationId: input.buildId,
      role: 'system',
      content: JSON.stringify(content),
      createdAt,
    })
    .onConflictDoUpdate({
      target: message.id,
      set: { content: JSON.stringify(content), createdAt },
    })
    .run();
}

export function failUnpublishedDeliverables(db: Db, stepId: string, generation: number): void {
  failRows(
    db,
    db
      .select({ id: attachment.id, status: attachment.status })
      .from(attachment)
      .where(
        and(
          eq(attachment.grantId, deliverableGrantId(stepId, generation)),
          inArray(attachment.status, ['pending', 'received']),
        ),
      )
      .all(),
  );
}

export function retireTodoDeliverables(db: Db, todoIds: string[]): void {
  if (todoIds.length === 0) return;
  db.update(attachment)
    .set({ status: 'failed' })
    .where(and(inArray(attachment.todoId, todoIds), eq(attachment.scope, 'deliverable')))
    .run();
  const buildIds = db
    .select({ id: build.id })
    .from(build)
    .where(inArray(build.todoId, todoIds))
    .all()
    .map((b) => `${DELIVERABLES_MESSAGE_PREFIX}${b.id}`);
  if (buildIds.length > 0) db.delete(message).where(inArray(message.id, buildIds)).run();
}
