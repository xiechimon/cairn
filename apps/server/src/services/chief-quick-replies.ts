import {
  QUICK_REPLIES_KIND,
  type QuickRepliesContent,
  quickRepliesRowId,
  SUGGEST_REPLIES_TOOL_NAME,
  sanitizeQuickReplies,
} from '@cairn/shared';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { step } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { nowMs } from '../lib/ids.js';
import { parseChiefTrigger, upsertChiefMessage } from './chief.js';
import type { ConversationStreamHub } from './events.js';

export function suggestQuickReplies(
  deps: { db: Db; convHub?: ConversationStreamHub },
  ctx: { threadId: string; turnPrompt?: string | null },
  params: Record<string, unknown>,
): string {
  if (parseChiefTrigger(ctx.turnPrompt ?? null) !== 'user') {
    throw new HttpError(
      400,
      `${SUGGEST_REPLIES_TOOL_NAME} rejected: event turns do not reach the user, so there is no reply to attach suggestions to`,
    );
  }
  const sanitized = sanitizeQuickReplies(params.replies);
  if (!sanitized.ok) {
    throw new HttpError(400, `${SUGGEST_REPLIES_TOOL_NAME} rejected: ${sanitized.problem}`);
  }
  const turn = deps.db
    .select({ id: step.id })
    .from(step)
    .where(and(eq(step.buildId, ctx.threadId), eq(step.kind, 'chief'), eq(step.status, 'claimed')))
    .orderBy(desc(step.claimedAt), sql`rowid desc`)
    .limit(1)
    .get();
  if (turn === undefined) {
    throw new HttpError(409, `${SUGGEST_REPLIES_TOOL_NAME} requires a running Coordinator turn`);
  }
  const row = {
    id: quickRepliesRowId(turn.id),
    role: 'system' as const,
    content: JSON.stringify({
      kind: QUICK_REPLIES_KIND,
      stepId: turn.id,
      replies: sanitized.replies,
    } satisfies QuickRepliesContent),
    createdAt: nowMs(),
  };
  upsertChiefMessage(deps.db, { ...row, threadId: ctx.threadId });
  deps.convHub?.publishMessage(ctx.threadId, row);
  return JSON.stringify({ shown: sanitized.replies });
}
