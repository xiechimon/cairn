import { existsSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { attachment, step } from '../db/schema.js';
import { nowMs } from '../lib/ids.js';

export const ATTACHMENT_PENDING_TTL_MS = 24 * 60 * 60 * 1000;
export const ATTACHMENT_ORPHAN_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
export const TEAM_ATTACHMENTS_QUOTA_BYTES = 1024 * 1024 * 1024;
export const ATTACHMENT_GC_INTERVAL_MS = 60 * 60 * 1000;

export interface GcLogger {
  info(meta: Record<string, unknown>, msg: string): void;
  debug(meta: Record<string, unknown>, msg: string): void;
}

export interface AttachmentGcStats {
  pending: number;
  orphan: number;
  reclaimedBytes: number;
}

const KEY_RE = /attachment:([A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.[a-z0-9]{1,8})/g;
const TOOL_ID_RE = /"attachmentId"\s*:\s*"([A-Za-z0-9_-]+)"/g;

interface RefCorpus {
  keys: Set<string>;
  ids: Set<string>;
  chunks: string[];
}

function isReferenced(corpus: RefCorpus, row: { id: string; storageKey: string }): boolean {
  if (corpus.keys.has(row.storageKey)) return true;
  if (corpus.ids.has(row.id)) return true;
  return corpus.chunks.some((c) => c.includes(row.id));
}

export function teamAttachmentBytes(db: Db, teamId: string): number {
  let total = 0;
  for (const r of db
    .select({ sizeBytes: attachment.sizeBytes })
    .from(attachment)
    .where(eq(attachment.teamId, teamId))
    .all()) {
    total += r.sizeBytes;
  }
  return total;
}

export function sweepAttachments(
  deps: { db: Db; attachmentsDir: string; logger: GcLogger },
  now: number = nowMs(),
): AttachmentGcStats {
  const batches = sweepAttachmentBatches(deps, now);
  let result = batches.next();
  while (!result.done) result = batches.next();
  return result.value;
}

export function* sweepAttachmentBatches(
  deps: { db: Db; attachmentsDir: string; logger: GcLogger },
  now: number = nowMs(),
): Generator<void, AttachmentGcStats> {
  const stats: AttachmentGcStats = { pending: 0, orphan: 0, reclaimedBytes: 0 };
  const rows = deps.db.select().from(attachment).all();
  const pendingCutoff = now - ATTACHMENT_PENDING_TTL_MS;
  const orphanCutoff = now - ATTACHMENT_ORPHAN_GRACE_MS;
  const pendingVictims = rows.filter((r) => r.status !== 'ready' && r.createdAt < pendingCutoff);
  const orphanCandidates = rows.filter((r) => r.status === 'ready' && r.createdAt < orphanCutoff);
  let orphans: typeof rows = [];
  if (orphanCandidates.length > 0) {
    const initialChanges = deps.db.get<{ changes: number }>(
      sql`select total_changes() as changes`,
    )?.changes;
    orphans = orphanCandidates;
    const sources = [
      { table: 'todo', cursor: 'id', content: 'spec', json: false },
      { table: 'message', cursor: 'id', content: 'content', json: true },
      { table: 'chief_message', cursor: 'id', content: 'content', json: true },
      { table: 'steer_pending', cursor: 'conversationId', content: 'content', json: false },
      { table: 'plan', cursor: 'id', content: 'content', json: false },
    ];
    for (const source of sources) {
      let cursor: string | null = null;
      while (orphans.length > 0) {
        const batch: { cursor: string; content: string }[] = deps.db.all(sql`
          select ${sql.raw(source.cursor)} as cursor, ${sql.raw(source.content)} as content
          from ${sql.raw(source.table)}
          ${cursor === null ? sql`` : sql`where ${sql.raw(source.cursor)} > ${cursor}`}
          order by ${sql.raw(source.cursor)} limit 128
        `);
        const corpus: RefCorpus = { keys: new Set(), ids: new Set(), chunks: [] };
        for (const row of batch) {
          const content: unknown = source.json
            ? typeof row.content === 'string'
              ? JSON.parse(row.content)
              : row.content
            : row.content;
          const text =
            source.json && typeof content !== 'string' ? JSON.stringify(content) : String(content);
          if (text.length === 0) continue;
          corpus.chunks.push(text);
          KEY_RE.lastIndex = 0;
          let keyMatch = KEY_RE.exec(text);
          while (keyMatch !== null) {
            corpus.keys.add(keyMatch[1] ?? '');
            keyMatch = KEY_RE.exec(text);
          }
          TOOL_ID_RE.lastIndex = 0;
          let idMatch = TOOL_ID_RE.exec(text);
          while (idMatch !== null) {
            corpus.ids.add(idMatch[1] ?? '');
            idMatch = TOOL_ID_RE.exec(text);
          }
        }
        orphans = orphans.filter((row) => !isReferenced(corpus, row));
        if (batch.length < 128) break;
        cursor = batch.at(-1)?.cursor ?? null;
        yield;
        if (
          deps.db.get<{ changes: number }>(sql`select total_changes() as changes`)?.changes !==
          initialChanges
        ) {
          deps.logger.info({}, 'attachment gc deferred after database writes');
          return stats;
        }
      }
    }
  }
  const reap = (victims: typeof rows, kind: 'pending' | 'orphan') => {
    for (const v of victims) {
      deps.db.delete(attachment).where(eq(attachment.id, v.id)).run();
      const abs = join(deps.attachmentsDir, v.storageKey);
      try {
        if (existsSync(abs)) unlinkSync(abs);
      } catch (err) {
        deps.logger.info(
          { attachmentId: v.id, key: v.storageKey, err: String(err) },
          'attachment gc unlink failed (row already gone)',
        );
        continue;
      }
      if (kind === 'pending') stats.pending += 1;
      else stats.orphan += 1;
      stats.reclaimedBytes += v.sizeBytes;
      deps.logger.debug(
        { attachmentId: v.id, key: v.storageKey, sizeBytes: v.sizeBytes },
        `attachment gc reaped ${kind}`,
      );
    }
  };
  reap(pendingVictims, 'pending');
  reap(orphans, 'orphan');
  deps.logger.info(
    { pending: stats.pending, orphan: stats.orphan, reclaimedBytes: stats.reclaimedBytes },
    `attachment gc: ${stats.pending} pending, ${stats.orphan} orphan, ${stats.reclaimedBytes} bytes reclaimed`,
  );
  return stats;
}

export function sweepStepSessions(
  deps: { db: Db; attachmentsDir: string; logger: GcLogger },
  now: number = nowMs(),
): { orphan: number; reclaimedBytes: number } {
  const dir = join(deps.attachmentsDir, 'step-sessions');
  const stats = { orphan: 0, reclaimedBytes: 0 };
  if (!existsSync(dir)) return stats;
  const orphanCutoff = now - ATTACHMENT_ORPHAN_GRACE_MS;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.jsonl')) continue;
    const stepId = name.slice(0, -'.jsonl'.length);
    if (deps.db.select({ id: step.id }).from(step).where(eq(step.id, stepId)).get()) continue;
    const abs = join(dir, name);
    let size = 0;
    let mtimeMs = now;
    try {
      const st = statSync(abs);
      size = st.size;
      mtimeMs = st.mtimeMs;
    } catch {
      continue;
    }
    if (mtimeMs > orphanCutoff) continue;
    try {
      unlinkSync(abs);
    } catch (err) {
      deps.logger.info({ stepId, err: String(err) }, 'session gc unlink failed');
      continue;
    }
    stats.orphan += 1;
    stats.reclaimedBytes += size;
  }
  if (stats.orphan > 0) {
    deps.logger.info(
      { orphan: stats.orphan, reclaimedBytes: stats.reclaimedBytes },
      `session gc: ${stats.orphan} orphan, ${stats.reclaimedBytes} bytes reclaimed`,
    );
  }
  return stats;
}
