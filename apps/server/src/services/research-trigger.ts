import {
  classifyStepFailure,
  isProviderOutage,
  RESEARCH_REQUESTED_KIND,
  researchRequestedMessageSchema,
} from '@cairn/shared';
import { and, eq, gte, like } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { build, buildFeedback, message, step } from '../db/schema.js';
import { CI_FIX_PROMPT_HEAD, researchRoundOf } from './retry-lessons.js';

export const STUCK_REJECTIONS_TRIGGER = 2;

export type StuckReason = 'ci-last-retry' | 'second-rejection';

export interface StuckSignals {
  ciRed: boolean;
  ciFixRounds: number;
  ciFixRoundsMax: number;
  rejectionsInRound: number;
  infraFailure: boolean;
  requestedInRound: boolean;
}

export function stuckResearchReason(signals: StuckSignals): StuckReason | null {
  if (signals.infraFailure || signals.requestedInRound) return null;
  if (signals.ciRed && signals.ciFixRounds === signals.ciFixRoundsMax - 1) return 'ci-last-retry';
  if (signals.rejectionsInRound >= STUCK_REJECTIONS_TRIGGER) return 'second-rejection';
  return null;
}

export interface StuckBuildState {
  round: number;
  ciFixRounds: number;
  rejectionsInRound: number;
  infraFailure: boolean;
  requestedInRound: boolean;
}

export function isInfraFailure(rawError: string | null): boolean {
  if (rawError === null || rawError.trim() === '') return false;
  return classifyStepFailure(rawError) !== 'other' || isProviderOutage(rawError);
}

export function readStuckBuildState(db: Db, buildId: string): StuckBuildState {
  const round = researchRoundOf(db, buildId);
  const roundStart = db
    .select({ at: buildFeedback.createdAt })
    .from(buildFeedback)
    .where(and(eq(buildFeedback.buildId, buildId), eq(buildFeedback.kind, 'restart')))
    .all()
    .reduce((latest, row) => Math.max(latest, row.at), 0);
  const ciFixRounds = db
    .select({ id: step.id })
    .from(step)
    .where(
      and(
        eq(step.buildId, buildId),
        eq(step.kind, 'build'),
        like(step.prompt, `${CI_FIX_PROMPT_HEAD}%`),
      ),
    )
    .all().length;
  const rejectionsInRound = db
    .select({ id: buildFeedback.id })
    .from(buildFeedback)
    .where(
      and(
        eq(buildFeedback.buildId, buildId),
        eq(buildFeedback.kind, 'revision'),
        eq(buildFeedback.side, 'build'),
        gte(buildFeedback.createdAt, roundStart),
      ),
    )
    .all().length;
  const buildRow = db.select().from(build).where(eq(build.id, buildId)).get();
  const requestedInRound = db
    .select({ content: message.content })
    .from(message)
    .where(and(eq(message.conversationId, buildId), eq(message.role, 'system')))
    .all()
    .some((row) => {
      if (typeof row.content !== 'string' || !row.content.includes(RESEARCH_REQUESTED_KIND)) {
        return false;
      }
      try {
        const parsed = researchRequestedMessageSchema.safeParse(JSON.parse(row.content));
        return parsed.success && parsed.data.round === round;
      } catch {
        return false;
      }
    });
  return {
    round,
    ciFixRounds,
    rejectionsInRound,
    infraFailure: isInfraFailure(buildRow?.errorMessage ?? null),
    requestedInRound,
  };
}
