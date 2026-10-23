// 附件回收（issue #759，策略正本 docs/spec/20-附件回收策略.md）。
// 三态处置：
//   pending/failed 超 PENDING_TTL → 收（无文件、无引用、grant 已死三重成立；
//     web 写侧 token 只在 upload 201 后构造，grant 阶段不产生引用）
//   ready 零引用超 ORPHAN_GRACE → 收（粘了没发 / 发送失败 / 草稿废弃 /
//     所属任务已删的孤儿；删任务本身不动附件 = R1）
//   有任意一处引用 → 一律保留。
// 引用扫描面 = todo.spec + message/chief_message content + steer + plan
// content（json 列走 stringify；匹配是整行 token 的超集——行内 token 同样
// 算引用，只多留、不多删；裸 id 回退防工具调用 JSON 形引用漏网）。
// 删除顺序 = 先删 DB 行、再 unlink 文件（同 sync 块内无 await 交错；server
// 单实例独占 SQLite，前提成立；崩溃落点只可能是无行有文件，不可是 404）。
// 配额走准入（grant 时卡，不删有引用件 = R4）。

import { existsSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { attachment, chiefMessage, message, plan, steerPending, step, todo } from '../db/schema.js';
import { nowMs } from '../lib/ids.js';

/** grant 落库未上传行的保质期（策略 §4：grant 5min 后永不可达 ready）。 */
export const ATTACHMENT_PENDING_TTL_MS = 24 * 60 * 60 * 1000;
/** ready 零引用件的 grace（策略 §4：周节奏，反悔可找回）。 */
export const ATTACHMENT_ORPHAN_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
/** team 总量配额（策略 §4：约 100 件满额文件；grant 准入用）。 */
export const TEAM_ATTACHMENTS_QUOTA_BYTES = 1024 * 1024 * 1024;
/** scheduler tick 里两次 sweep 的最小间隔（策略 §4：全表扫描限流）。 */
export const ATTACHMENT_GC_INTERVAL_MS = 60 * 60 * 1000;

/** GC 日志出口最小形（pino Logger 可直接传入；测试注入捕获 fake）。 */
export interface GcLogger {
  info(meta: Record<string, unknown>, msg: string): void;
  debug(meta: Record<string, unknown>, msg: string): void;
}

export interface AttachmentGcStats {
  pending: number;
  orphan: number;
  reclaimedBytes: number;
}

// key 语法与 shared ATTACHMENT_KEY 同律（team/id 段 recordId 字母表 +
// 小写扩展名 ≤8）；此处取子串超集，不做整行锚定。
const KEY_RE = /attachment:([A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.[a-z0-9]{1,8})/g;
// transcript 内工具调用参数形引用（message content JSON 里的 attachmentId）。
const TOOL_ID_RE = /"attachmentId"\s*:\s*"([A-Za-z0-9_-]+)"/g;

interface RefCorpus {
  keys: Set<string>;
  ids: Set<string>;
  chunks: string[];
}

/** 全引用面一次扫（仅在有超龄 ready 件时调用——无候选即免全表读）。 */
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
  // 裸 id 回退：recordId 21 位随机串，子串命中即视为引用（宁可多留）。
  return corpus.chunks.some((c) => c.includes(row.id));
}

/** team 当前用量（ready + pending 求和——配额看的是占位，不是可回收量）。 */
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
