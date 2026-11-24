import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  attachmentExtOf,
  DELIVERABLE_LIMITS,
  type DeliverableKind,
  type DeliverablesMessage,
  formatAttachmentToken,
  INLINE_IMAGE_EXTS,
  INLINE_IMAGE_MIME_BY_EXT,
  inlineImageMimeOfBytes,
  resolveAttachmentMime,
} from '@cairn/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { attachment, build, message, type step, type todo } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import { TEAM_ATTACHMENTS_QUOTA_BYTES, teamAttachmentBytes } from './attachment-gc.js';
import { containedAttachmentPath } from './attachments.js';
import { recordDesignVersion } from './design.js';
import type { MachineDeps } from './machine-deps.js';

const KIND_EXTS: Record<DeliverableKind, readonly string[]> = {
  page: ['html'],
  slides: ['pptx', 'pdf'],
  image: INLINE_IMAGE_EXTS,
};
const MAX_BYTES_BY_KIND: Record<DeliverableKind, number> = {
  page: DELIVERABLE_LIMITS.maxPageBytes,
  slides: DELIVERABLE_LIMITS.maxSlidesBytes,
  image: DELIVERABLE_LIMITS.maxImageBytes,
};
const UNSAFE_NAME = /[\p{Cc}\p{Cf}\p{Cs}/\\]/u;
const PDF_MAGIC = Buffer.from('%PDF-', 'latin1');
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

export const DELIVERABLES_MESSAGE_PREFIX = 'deliverables-';

export interface DeliverableManifest {
  generation: number;
  files: { name: string; sha256: string }[];
  skipped: { name: string; reason: string }[];
}

export function deliverableGrantId(stepId: string, generation: number): string {
  return `deliverable:${stepId}:${generation}`;
}

export function hasDeliverableRows(db: Db, stepId: string, generation: number): boolean {
  return (
    db
      .select({ id: attachment.id })
      .from(attachment)
      .where(eq(attachment.grantId, deliverableGrantId(stepId, generation)))
      .get() !== undefined
  );
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

export function deliverableKindOf(fileName: string): DeliverableKind {
  const ext = attachmentExtOf(fileName);
  if (KIND_EXTS.page.includes(ext)) return 'page';
  if (KIND_EXTS.image.includes(ext)) return 'image';
  return 'slides';
}

function maxBytesOf(kind: DeliverableKind): number {
  return MAX_BYTES_BY_KIND[kind];
}

function checkedExt(kind: DeliverableKind, name: string): string {
  if (
    name.length === 0 ||
    name.length > DELIVERABLE_LIMITS.maxNameChars ||
    name === '.' ||
    name === '..' ||
    UNSAFE_NAME.test(name)
  ) {
    throw new HttpError(400, 'invalid deliverable name');
  }
  const ext = attachmentExtOf(name);
  if (!KIND_EXTS[kind].includes(ext)) {
    throw new HttpError(400, `deliverable ${kind} cannot be a .${ext || '(none)'} file`);
  }
  return ext;
}

interface ContentCheck {
  push(chunk: Uint8Array): void;
  end(): void;
}

function contentCheckOf(ext: string): ContentCheck {
  if (ext === 'html') {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const decode = (chunk?: Uint8Array) => {
      try {
        if (chunk === undefined) decoder.decode();
        else decoder.decode(chunk, { stream: true });
      } catch {
        throw new HttpError(422, 'page is not valid UTF-8');
      }
    };
    return { push: (chunk) => decode(chunk), end: () => decode() };
  }
  const expectedImageMime = INLINE_IMAGE_MIME_BY_EXT[ext];
  if (expectedImageMime !== undefined) {
    let head = Buffer.alloc(0);
    return {
      push(chunk) {
        if (head.length < 12) {
          head = Buffer.concat([head, Buffer.from(chunk.subarray(0, 12 - head.length))]);
        }
      },
      end() {
        if (inlineImageMimeOfBytes(head) !== expectedImageMime) {
          throw new HttpError(422, `file is not a valid .${ext}`);
        }
      },
    };
  }
  const magic = ext === 'pdf' ? PDF_MAGIC : ZIP_MAGIC;
  let head = Buffer.alloc(0);
  return {
    push(chunk) {
      if (head.length < magic.length) {
        head = Buffer.concat([head, Buffer.from(chunk.subarray(0, magic.length - head.length))]);
      }
    },
    end() {
      if (!head.equals(magic)) throw new HttpError(422, `file is not a valid .${ext}`);
    },
  };
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
    if (r.todoId === null || deliverableKindOf(r.fileName) !== 'page') continue;
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

export function failEarlierClaimDeliverables(db: Db, stepId: string): void {
  const prefix = `deliverable:${stepId}:`;
  failRows(
    db,
    db
      .select({ id: attachment.id, status: attachment.status })
      .from(attachment)
      .where(
        and(
          sql`substr(${attachment.grantId}, 1, ${prefix.length}) = ${prefix}`,
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

const DEFERRED_SIGNALS = new Set(['wake', 'steerSignal', 'stopSignal']);

function deferSignals<T extends object>(hub: T, queue: (() => void)[]): T {
  return new Proxy(hub, {
    get(target, key) {
      const value: unknown = Reflect.get(target, key, target);
      if (typeof value !== 'function') return value;
      const call = value as (...args: unknown[]) => unknown;
      if (typeof key === 'string' && (key.startsWith('publish') || DEFERRED_SIGNALS.has(key))) {
        return (...args: unknown[]) => {
          queue.push(() => call.apply(target, args));
        };
      }
      return call.bind(target);
    },
  });
}

export function withEventsAfterCommit(deps: MachineDeps, run: (deps: MachineDeps) => void): void {
  const queue: (() => void)[] = [];
  const deferred: MachineDeps = {
    ...deps,
    hub: deferSignals(deps.hub, queue),
    machineHub: deferSignals(deps.machineHub, queue),
    ...(deps.convHub !== undefined ? { convHub: deferSignals(deps.convHub, queue) } : {}),
  };
  deps.db.transaction(() => run(deferred));
  for (const publish of queue) publish();
}

export interface VmDeliverableFile {
  name: string;
  kind: DeliverableKind;
  bytes: Buffer;
}

export function replaceVmDeliverables(
  deps: MachineDeps,
  stepRow: Pick<typeof step.$inferSelect, 'id' | 'claimedAt'>,
  todoRow: Pick<typeof todo.$inferSelect, 'id' | 'teamId'>,
  files: readonly VmDeliverableFile[],
): { skipped: { name: string; reason: string }[] } {
  if (stepRow.claimedAt === null || deps.attachmentsDir === undefined) {
    throw new HttpError(409, 'deliverables need a claimed step');
  }
  const { db } = deps;
  const grantId = deliverableGrantId(stepRow.id, stepRow.claimedAt);
  failUnpublishedDeliverables(db, stepRow.id, stepRow.claimedAt);
  const skipped: { name: string; reason: string }[] = [];
  let accepted = 0;
  let total = 0;
  const seen = new Set<string>();
  for (const file of files) {
    let ext: string;
    try {
      ext = checkedExt(file.kind, file.name);
      const check = contentCheckOf(ext);
      check.push(file.bytes);
      check.end();
    } catch (error) {
      skipped.push({
        name: file.name,
        reason: error instanceof HttpError ? error.message : 'invalid-file',
      });
      continue;
    }
    const folded = file.name.toLowerCase();
    if (seen.has(folded)) {
      skipped.push({ name: file.name, reason: 'duplicate-name' });
      continue;
    }
    seen.add(folded);
    if (file.bytes.length > maxBytesOf(file.kind)) {
      skipped.push({ name: file.name, reason: 'too-large' });
      continue;
    }
    if (
      accepted >= DELIVERABLE_LIMITS.maxFiles ||
      total + file.bytes.length > DELIVERABLE_LIMITS.maxTotalBytes ||
      teamAttachmentBytes(db, todoRow.teamId) + file.bytes.length > TEAM_ATTACHMENTS_QUOTA_BYTES
    ) {
      skipped.push({ name: file.name, reason: 'over-limit' });
      continue;
    }
    const id = newRecordId();
    const storageKey = `${todoRow.teamId}/${id}.${ext}`;
    const path = containedAttachmentPath(deps.attachmentsDir, storageKey);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, file.bytes);
    db.insert(attachment)
      .values({
        id,
        teamId: todoRow.teamId,
        todoId: todoRow.id,
        createdBy: deps.user.id,
        fileName: file.name,
        mimeType: resolveAttachmentMime(file.name, '') ?? 'application/octet-stream',
        sizeBytes: file.bytes.length,
        sha256: createHash('sha256').update(file.bytes).digest('hex'),
        storageKey,
        grantId,
        scope: 'deliverable',
        status: 'received',
        createdAt: nowMs(),
      })
      .run();
    accepted += 1;
    total += file.bytes.length;
  }
  return { skipped };
}

export function deliverableManifestOf(
  db: Db,
  stepRow: Pick<typeof step.$inferSelect, 'id' | 'claimedAt'>,
): DeliverableManifest | undefined {
  if (stepRow.claimedAt === null) return undefined;
  const rows = db
    .select({ fileName: attachment.fileName, sha256: attachment.sha256 })
    .from(attachment)
    .where(
      and(
        eq(attachment.grantId, deliverableGrantId(stepRow.id, stepRow.claimedAt)),
        eq(attachment.status, 'received'),
      ),
    )
    .all();
  if (rows.length === 0) return undefined;
  return {
    generation: stepRow.claimedAt,
    files: rows.flatMap((r) => (r.sha256 === null ? [] : [{ name: r.fileName, sha256: r.sha256 }])),
    skipped: [],
  };
}
