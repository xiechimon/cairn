import {
  CHIEF_MODEL_RESTORED_KIND,
  type ChiefModelRestoredContent,
  chiefModelFallbackContentSchema,
  chiefModelRestoredContentSchema,
} from '@cairn/shared';
import { and, desc, eq, like, or, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { chiefMessage, chiefThread, type step } from '../db/schema.js';
import { nowMs } from '../lib/ids.js';
import { type MachineDeps, upsertChiefRow } from './machine-deps.js';
import { stepScopeProjectId } from './picked-project.js';
import { coordinatorProfile } from './routing-rules.js';
import { readQuota } from './step-groups/quota.js';

export const MODEL_SWITCH_QUIET_MS = 15 * 60_000;

const FALLBACK_ROW_PREFIX = 'chief-fallback-';
const RESTORED_ROW_PREFIX = 'chief-model-restored-';

interface ToldModel {
  fallbackTo: string | null;
  at: number | null;
}

function toldModel(db: Db, threadId: string): ToldModel {
  const rows = db
    .select({ content: chiefMessage.content, createdAt: chiefMessage.createdAt })
    .from(chiefMessage)
    .where(
      and(
        eq(chiefMessage.threadId, threadId),
        or(
          like(chiefMessage.id, `${FALLBACK_ROW_PREFIX}%`),
          like(chiefMessage.id, `${RESTORED_ROW_PREFIX}%`),
        ),
      ),
    )
    .orderBy(desc(chiefMessage.createdAt), sql`rowid desc`)
    .all();
  for (const row of rows) {
    const parsed = parseContent(row.content);
    const fallback = chiefModelFallbackContentSchema.safeParse(parsed);
    if (fallback.success && fallback.data.announced === true) {
      return { fallbackTo: fallback.data.to, at: row.createdAt };
    }
    if (chiefModelRestoredContentSchema.safeParse(parsed).success) {
      return { fallbackTo: null, at: row.createdAt };
    }
  }
  return { fallbackTo: null, at: null };
}

function parseContent(content: unknown): unknown {
  if (typeof content !== 'string') return content;
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

export function fallbackAnnounced(
  db: Db,
  threadId: string,
  to: string,
  now: number = nowMs(),
): boolean {
  const told = toldModel(db, threadId);
  if (told.fallbackTo !== null) return told.fallbackTo !== to;
  return told.at === null || now - told.at >= MODEL_SWITCH_QUIET_MS;
}

export function announcePrimaryRestored(
  deps: MachineDeps,
  stepRow: typeof step.$inferSelect,
): void {
  if (readQuota(deps.db, stepRow.id).fallback != null) return;
  if (toldModel(deps.db, stepRow.buildId).fallbackTo === null) return;
  const thread = deps.db
    .select({ teamId: chiefThread.teamId, projectId: chiefThread.projectId })
    .from(chiefThread)
    .where(eq(chiefThread.id, stepRow.buildId))
    .get();
  const profile = thread ? coordinatorProfile(deps.db, thread.teamId, thread.projectId) : null;
  if (!profile?.provider || !profile.modelId) return;
  const primary = `${profile.provider}/${profile.modelId}`;
  const content: ChiefModelRestoredContent = {
    kind: CHIEF_MODEL_RESTORED_KIND,
    model: primary,
    stepId: stepRow.id,
  };
  upsertChiefRow(deps, {
    id: `${RESTORED_ROW_PREFIX}${stepRow.id}`,
    threadId: stepRow.buildId,
    projectId: stepScopeProjectId(stepRow),
    role: 'system',
    content: JSON.stringify(content),
    createdAt: nowMs(),
  });
}
