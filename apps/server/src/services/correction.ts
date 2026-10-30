import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { build, gateState, message, step, tag, type todo, todoTag } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { nowMs } from '../lib/ids.js';
import { CORRECTION_GUARD_MISSING, correctionDoneCheck } from './merge-gate/correction.js';

export function isCorrectionTask(db: Db, todoId: string): boolean {
  return (
    db
      .select({ id: tag.id })
      .from(todoTag)
      .innerJoin(tag, eq(tag.id, todoTag.tagId))
      .where(and(eq(todoTag.todoId, todoId), eq(sql`lower(${tag.name})`, 'correction')))
      .get() !== undefined
  );
}

export function recordCorrectionGuard(
  db: Db,
  buildId: string,
  headSha: string,
  passed: boolean | null,
): void {
  if (passed === null) return;
  const content = { kind: 'correction_guard', headSha, passed };
  const createdAt = nowMs();
  db.insert(message)
    .values({
      id: `correction-guard:${buildId}:${headSha}`,
      conversationId: buildId,
      role: 'system',
      content,
      createdAt,
    })
    .onConflictDoUpdate({ target: message.id, set: { content, createdAt } })
    .run();
}

export function assertCorrectionDone(
  db: Db,
  row: Pick<typeof todo.$inferSelect, 'id' | 'latestBuildId'>,
): void {
  if (!isCorrectionTask(db, row.id)) return;
  const latest =
    row.latestBuildId === null
      ? undefined
      : db
          .select()
          .from(build)
          .where(and(eq(build.id, row.latestBuildId), eq(build.todoId, row.id)))
          .get();
  const changes = latest?.changes ?? null;
  const files = changes === null ? null : Array.isArray(changes) ? changes : changes.files;
  let approved = correctionDoneCheck(files);
  if (latest !== undefined) {
    const delivered = db
      .select()
      .from(step)
      .where(
        and(
          eq(step.buildId, latest.id),
          eq(step.kind, 'build'),
          eq(step.status, 'done'),
          isNotNull(step.checkpointCommit),
        ),
      )
      .orderBy(desc(step.createdAt), sql`rowid desc`)
      .get();
    const head =
      db
        .select({ sha: gateState.headSha })
        .from(gateState)
        .where(eq(gateState.buildId, latest.id))
        .get()?.sha ??
      delivered?.checkpointCommit ??
      null;
    if (head !== null) {
      const proof = db
        .select()
        .from(message)
        .where(
          and(eq(message.id, `correction-guard:${latest.id}:${head}`), eq(message.role, 'system')),
        )
        .get();
      if (proof !== undefined) {
        const content = proof.content;
        approved =
          typeof content === 'object' &&
          content !== null &&
          'kind' in content &&
          content.kind === 'correction_guard' &&
          'passed' in content &&
          content.passed === true &&
          proof.createdAt >= (delivered?.finishedAt ?? delivered?.createdAt ?? latest.createdAt);
      }
    }
  }
  if (!approved) throw new HttpError(409, CORRECTION_GUARD_MISSING);
}
