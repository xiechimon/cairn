import type { MachineHeartbeatBody } from '@cairn/shared';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { build, buildFeedback, step } from '../db/schema.js';
import { newRecordId, nowMs } from '../lib/ids.js';

export function recordBuildProvenance(db: Db, stepId: string, body: MachineHeartbeatBody): void {
  if (body.harnessHash === undefined) return;
  const row = db.select().from(step).where(eq(step.id, stepId)).get();
  if (row === undefined || row.status !== 'claimed') return;
  const first = db
    .select({ id: step.id })
    .from(step)
    .where(eq(step.buildId, row.buildId))
    .orderBy(asc(step.createdAt), sql`rowid`)
    .get();
  if (first?.id !== stepId) return;
  db.update(build)
    .set({ baseSha: body.baseSha ?? null, harnessHash: body.harnessHash })
    .where(and(eq(build.id, row.buildId), isNull(build.harnessHash)))
    .run();
}

export function recordBuildFeedback(
  db: Db,
  buildId: string,
  kind: 'revision' | 'restart',
  side: 'plan' | 'build',
  feedback: string,
  actor: string,
): void {
  const rejected = db
    .select({ id: step.id })
    .from(step)
    .where(eq(step.buildId, buildId))
    .orderBy(desc(step.createdAt), sql`rowid desc`)
    .get();
  db.insert(buildFeedback)
    .values({
      id: newRecordId(),
      buildId,
      kind,
      side,
      feedback,
      actor,
      stepId: rejected?.id ?? null,
      createdAt: nowMs(),
    })
    .run();
}
