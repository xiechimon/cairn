import { existsSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { attachment, chiefMessage, message, plan, steerPending, step, todo } from '../db/schema.js';
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

function collectAttachmentRefs(db: Db): RefCorpus {
  const keys = new Set<string>();
  const ids = new Set<string>();
  const chunks: string[] = [];
  const eat = (text: string) => {
    if (text.length === 0) return;
    chunks.push(text);
    KEY_RE.lastIndex = 0;
    let m = KEY_RE.exec(text);
    while (m !== null) {
      keys.add(m[1] ?? '');
      m = KEY_RE.exec(text);
    }
    TOOL_ID_RE.lastIndex = 0;
    let t = TOOL_ID_RE.exec(text);
    while (t !== null) {
      ids.add(t[1] ?? '');
      t = TOOL_ID_RE.exec(text);
    }
  };
  for (const r of db.select({ spec: todo.spec }).from(todo).all()) eat(r.spec);
  for (const r of db.select({ content: message.content }).from(message).all()) {
    eat(typeof r.content === 'string' ? r.content : JSON.stringify(r.content));
  }
  for (const r of db.select({ content: chiefMessage.content }).from(chiefMessage).all()) {
    eat(typeof r.content === 'string' ? r.content : JSON.stringify(r.content));
  }
  for (const r of db.select({ content: steerPending.content }).from(steerPending).all()) {
    eat(r.content);
  }
  for (const r of db.select({ content: plan.content }).from(plan).all()) eat(r.content);
  return { keys, ids, chunks };
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
  const stats: AttachmentGcStats = { pending: 0, orphan: 0, reclaimedBytes: 0 };
  const rows = deps.db.select().from(attachment).all();
  const pendingCutoff = now - ATTACHMENT_PENDING_TTL_MS;
  const orphanCutoff = now - ATTACHMENT_ORPHAN_GRACE_MS;
  const pendingVictims = rows.filter((r) => r.status !== 'ready' && r.createdAt < pendingCutoff);
  const orphanCandidates = rows.filter((r) => r.status === 'ready' && r.createdAt < orphanCutoff);
  let orphans: typeof rows = [];
  if (orphanCandidates.length > 0) {
    const corpus = collectAttachmentRefs(deps.db);
    orphans = orphanCandidates.filter((r) => !isReferenced(corpus, r));
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
  const live = new Set(
    deps.db
      .select({ id: step.id })
      .from(step)
      .all()
      .map((r) => r.id),
  );
  const orphanCutoff = now - ATTACHMENT_ORPHAN_GRACE_MS;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.jsonl')) continue;
    const stepId = name.slice(0, -'.jsonl'.length);
    if (live.has(stepId)) continue;
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
