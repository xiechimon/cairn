import { createHash, randomBytes } from 'node:crypto';
import { constants, renameSync, rmSync } from 'node:fs';
import { open } from 'node:fs/promises';
import {
  attachmentExtOf,
  DELIVERABLE_LIMITS,
  DELIVERABLE_UPLOAD_DEADLINE_MS,
  DELIVERABLE_UPLOAD_IDLE_MS,
  type DeliverableCapability,
  type DeliverableKind,
  type DeliverableReceiptState,
  type DeliverablesMessage,
  isBuildStepKind,
  resolveAttachmentMime,
  type StepKind,
} from '@cairn/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { attachment, build, message, step, todo } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import {
  ATTACHMENT_PENDING_TTL_MS,
  TEAM_ATTACHMENTS_QUOTA_BYTES,
  teamAttachmentBytes,
} from './attachment-gc.js';
import { containedAttachmentPath } from './attachments.js';
import type { MachineDeps } from './machine-deps.js';

const KIND_EXTS: Record<DeliverableKind, readonly string[]> = {
  page: ['html'],
  slides: ['pptx', 'pdf'],
};
const UNSAFE_NAME = /[\p{Cc}\p{Cf}\p{Cs}/\\]/u;
const PDF_MAGIC = Buffer.from('%PDF-', 'latin1');
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const MACHINE_ACTIVE_UPLOADS = 2;
const TEAM_ACTIVE_UPLOADS = 4;
const SERVER_ACTIVE_UPLOADS = 16;

export const DELIVERABLES_MESSAGE_PREFIX = 'deliverables-';

export interface DeliverableManifest {
  generation: number;
  files: { name: string; sha256: string }[];
  skipped: { name: string; reason: string }[];
}

export function deliverableGrantId(stepId: string, generation: number): string {
  return `deliverable:${stepId}:${generation}`;
}

function parseGrantId(grantId: string): { stepId: string; generation: number } | null {
  const match = /^deliverable:([^:]+):(\d+)$/.exec(grantId);
  if (match === null) return null;
  return { stepId: match[1] ?? '', generation: Number(match[2]) };
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

export function deliverableCapability(
  kind: StepKind,
  output: string | null,
  claimedAt: number,
): DeliverableCapability | undefined {
  if (!isBuildStepKind(kind) || output !== 'info') return undefined;
  return {
    generation: claimedAt,
    limits: {
      maxFiles: DELIVERABLE_LIMITS.maxFiles,
      maxTotalBytes: DELIVERABLE_LIMITS.maxTotalBytes,
      maxPageBytes: DELIVERABLE_LIMITS.maxPageBytes,
      maxSlidesBytes: DELIVERABLE_LIMITS.maxSlidesBytes,
    },
  };
}

export function deliverableKindOf(fileName: string): DeliverableKind {
  return KIND_EXTS.page.includes(attachmentExtOf(fileName)) ? 'page' : 'slides';
}

function maxBytesOf(kind: DeliverableKind): number {
  return kind === 'page' ? DELIVERABLE_LIMITS.maxPageBytes : DELIVERABLE_LIMITS.maxSlidesBytes;
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

function requireClaim(db: Db, machineId: string, stepId: string, generation: number) {
  const row = db.select().from(step).where(eq(step.id, stepId)).get();
  if (
    !row ||
    row.machineId !== machineId ||
    row.status !== 'claimed' ||
    row.claimedAt !== generation
  ) {
    throw new HttpError(409, `step ${stepId} is not claimed at generation ${generation}`);
  }
  return row;
}

export interface GrantedDeliverable {
  name: string;
  attachmentId: string;
  received: boolean;
  url: string;
  method: 'PUT';
  headers: Record<string, string>;
}

export function grantDeliverables(
  deps: MachineDeps,
  machineRow: { id: string; teamId: string },
  stepId: string,
  generation: number | undefined,
  entries: { kind: DeliverableKind; name: string; size: number; sha256: string }[],
  origin: string,
): GrantedDeliverable[] {
  if (entries.length === 0) return [];
  if (generation === undefined) throw new HttpError(400, 'deliverables need the claim generation');
  const { db } = deps;
  return db.transaction(() => {
    const stepRow = requireClaim(db, machineRow.id, stepId, generation);
    if (!isBuildStepKind(stepRow.kind)) {
      throw new HttpError(400, 'deliverables are only accepted on build steps');
    }
    const todoRow = db
      .select({ id: todo.id, teamId: todo.teamId, output: todo.output })
      .from(build)
      .innerJoin(todo, eq(todo.id, build.todoId))
      .where(eq(build.id, stepRow.buildId))
      .get();
    if (todoRow?.output !== 'info') {
      throw new HttpError(400, 'deliverables are only accepted on info tasks');
    }
    if (todoRow.teamId !== machineRow.teamId) throw new HttpError(403, 'step of another team');
    const seen = new Set<string>();
    const checked = entries.map((entry) => {
      const ext = checkedExt(entry.kind, entry.name);
      if (entry.size > maxBytesOf(entry.kind)) {
        throw new HttpError(413, `deliverable ${entry.name} is over its size limit`);
      }
      const folded = entry.name.toLowerCase();
      if (seen.has(folded)) throw new HttpError(400, `duplicate deliverable ${entry.name}`);
      seen.add(folded);
      return { ...entry, ext, folded };
    });
    const grantId = deliverableGrantId(stepId, generation);
    const now = nowMs();
    const rows = db.select().from(attachment).where(eq(attachment.grantId, grantId)).all();
    const live = rows.filter(
      (r) => r.status !== 'failed' && now - r.createdAt <= ATTACHMENT_PENDING_TTL_MS,
    );
    const retired = new Set(
      rows.filter((r) => r.status !== 'failed' && !live.includes(r)).map((r) => r.id),
    );
    const reused = new Map<string, (typeof rows)[number]>();
    const fresh: typeof checked = [];
    for (const entry of checked) {
      const match = live.find((r) => r.fileName.toLowerCase() === entry.folded);
      if (
        match !== undefined &&
        match.fileName === entry.name &&
        match.sha256 === entry.sha256 &&
        match.sizeBytes === entry.size
      ) {
        reused.set(entry.name, match);
        continue;
      }
      if (match !== undefined) retired.add(match.id);
      fresh.push(entry);
    }
    const kept = live.filter((r) => !retired.has(r.id));
    if (kept.length + fresh.length > DELIVERABLE_LIMITS.maxFiles) {
      throw new HttpError(400, `more than ${DELIVERABLE_LIMITS.maxFiles} deliverables`);
    }
    const keptBytes = kept.reduce((sum, r) => sum + r.sizeBytes, 0);
    const freshBytes = fresh.reduce((sum, e) => sum + e.size, 0);
    if (keptBytes + freshBytes > DELIVERABLE_LIMITS.maxTotalBytes) {
      throw new HttpError(413, 'deliverables are over the total size limit');
    }
    if (rows.length + fresh.length > DELIVERABLE_LIMITS.maxRowsPerClaim) {
      throw new HttpError(429, 'too many deliverable uploads for this claim');
    }
    if (teamAttachmentBytes(db, todoRow.teamId) + freshBytes > TEAM_ATTACHMENTS_QUOTA_BYTES) {
      throw new HttpError(413, 'team attachment quota exceeded');
    }
    if (retired.size > 0)
      failRows(
        db,
        rows.filter((r) => retired.has(r.id)),
      );
    for (const entry of fresh) {
      const id = newRecordId();
      const row = {
        id,
        teamId: todoRow.teamId,
        todoId: todoRow.id,
        createdBy: deps.user.id,
        fileName: entry.name,
        mimeType: resolveAttachmentMime(entry.name, '') ?? 'application/octet-stream',
        sizeBytes: entry.size,
        sha256: entry.sha256,
        storageKey: `${todoRow.teamId}/${id}.${entry.ext}`,
        grantId,
        scope: 'deliverable' as const,
        status: 'pending' as const,
        createdAt: now,
      };
      db.insert(attachment).values(row).run();
      reused.set(entry.name, row);
    }
    return checked.map((entry) => {
      const row = reused.get(entry.name);
      if (row === undefined) throw new Error('deliverable row missing after grant');
      return {
        name: entry.name,
        attachmentId: row.id,
        received: row.status === 'received',
        url: `${origin}/api/machine/deliverable/${row.id}`,
        method: 'PUT' as const,
        headers: {},
      };
    });
  });
}

export class DeliverableUploadGate {
  private readonly active = new Set<string>();
  private readonly perMachine = new Map<string, number>();
  private readonly perTeam = new Map<string, number>();

  enter(attachmentId: string, machineId: string, teamId: string): () => void {
    if (this.active.has(attachmentId)) throw new HttpError(409, 'deliverable upload busy');
    const machineCount = this.perMachine.get(machineId) ?? 0;
    const teamCount = this.perTeam.get(teamId) ?? 0;
    if (
      machineCount >= MACHINE_ACTIVE_UPLOADS ||
      teamCount >= TEAM_ACTIVE_UPLOADS ||
      this.active.size >= SERVER_ACTIVE_UPLOADS
    ) {
      throw new HttpError(429, 'too many deliverable uploads in progress');
    }
    this.active.add(attachmentId);
    this.perMachine.set(machineId, machineCount + 1);
    this.perTeam.set(teamId, teamCount + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active.delete(attachmentId);
      decrement(this.perMachine, machineId);
      decrement(this.perTeam, teamId);
    };
  }
}

function decrement(counts: Map<string, number>, key: string): void {
  const left = (counts.get(key) ?? 1) - 1;
  if (left <= 0) counts.delete(key);
  else counts.set(key, left);
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

async function readWithin(reader: ReadableStreamDefaultReader<Uint8Array>, ms: number) {
  if (ms <= 0) throw new HttpError(408, 'deliverable upload deadline passed');
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new HttpError(408, 'deliverable upload timed out')), ms);
  });
  try {
    return await Promise.race([reader.read(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function streamToPart(
  path: string,
  body: ReadableStream<Uint8Array> | null,
  limit: number,
  check: ContentCheck,
): Promise<{ size: number; sha256: string }> {
  const handle = await open(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
  const hash = createHash('sha256');
  let size = 0;
  const reader = body?.getReader();
  const deadline = nowMs() + DELIVERABLE_UPLOAD_DEADLINE_MS;
  try {
    while (reader !== undefined) {
      const chunk = await readWithin(
        reader,
        Math.min(DELIVERABLE_UPLOAD_IDLE_MS, deadline - nowMs()),
      );
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > limit) throw new HttpError(413, 'deliverable body is larger than its grant');
      check.push(chunk.value);
      hash.update(chunk.value);
      await handle.write(chunk.value);
    }
    check.end();
  } catch (err) {
    await reader?.cancel().catch(() => undefined);
    throw err;
  } finally {
    await handle.close();
  }
  return { size, sha256: hash.digest('hex') };
}

export async function receiveDeliverable(
  deps: MachineDeps,
  gate: DeliverableUploadGate,
  input: {
    machineId: string;
    attachmentId: string;
    contentLength: string | undefined;
    body: ReadableStream<Uint8Array> | null;
    confirmMachine: () => void;
  },
): Promise<void> {
  const { db } = deps;
  const row = db.select().from(attachment).where(eq(attachment.id, input.attachmentId)).get();
  const claim = row?.scope === 'deliverable' ? parseGrantId(row.grantId) : null;
  const stepRow =
    claim !== null ? db.select().from(step).where(eq(step.id, claim.stepId)).get() : undefined;
  if (!row || claim === null || !stepRow || stepRow.machineId !== input.machineId) {
    throw new HttpError(404, 'deliverable upload not found');
  }
  if (nowMs() - row.createdAt > ATTACHMENT_PENDING_TTL_MS) {
    throw new HttpError(410, 'deliverable upload expired');
  }
  if (stepRow.status !== 'claimed' || stepRow.claimedAt !== claim.generation) {
    throw new HttpError(409, 'deliverable upload belongs to an earlier claim');
  }
  if (row.status === 'received') {
    await input.body?.cancel().catch(() => undefined);
    return;
  }
  if (row.status !== 'pending') throw new HttpError(409, 'deliverable upload is not pending');
  if (input.contentLength !== undefined && Number(input.contentLength) > row.sizeBytes) {
    throw new HttpError(413, 'deliverable body is larger than its grant');
  }
  const release = gate.enter(row.id, input.machineId, row.teamId);
  try {
    const finalPath = containedAttachmentPath(deps.attachmentsDir, row.storageKey);
    const partPath = `${finalPath}.part-${randomBytes(8).toString('hex')}`;
    try {
      const received = await streamToPart(
        partPath,
        input.body,
        row.sizeBytes,
        contentCheckOf(attachmentExtOf(row.storageKey)),
      );
      if (received.size !== row.sizeBytes || received.sha256 !== row.sha256) {
        throw new HttpError(422, 'deliverable size or hash does not match its grant');
      }
      input.confirmMachine();
      db.transaction(() => {
        requireClaim(db, input.machineId, claim.stepId, claim.generation);
        const fresh = db.select().from(attachment).where(eq(attachment.id, row.id)).get();
        if (fresh?.status !== 'pending' || fresh.grantId !== row.grantId) {
          throw new HttpError(409, 'deliverable upload is not pending');
        }
        renameSync(partPath, finalPath);
        db.update(attachment).set({ status: 'received' }).where(eq(attachment.id, row.id)).run();
      });
    } finally {
      rmSync(partPath, { force: true });
    }
  } finally {
    release();
  }
}

export function deliverableReceipt(
  db: Db,
  machineId: string,
  stepId: string,
  generation: number,
): DeliverableReceiptState {
  const row = db.select().from(step).where(eq(step.id, stepId)).get();
  if (!row || row.machineId !== machineId || row.claimedAt !== generation) return 'superseded';
  if (row.status === 'claimed') return 'claimed';
  if (row.status === 'done' || row.status === 'failed' || row.status === 'stopped') {
    return 'finished';
  }
  return 'superseded';
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
      attachmentToken: `![${r.id}](attachment:${r.storageKey})`,
    })),
    skipped: input.manifest.skipped,
  };
  const createdAt = nowMs();
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
