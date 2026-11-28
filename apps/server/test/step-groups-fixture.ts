import { eq } from 'drizzle-orm';
import type { Db } from '../src/db/client.js';
import { step } from '../src/db/schema.js';
import {
  readBlockerHandoff,
  type StepBlockerHandoffPatch,
  writeBlockerHandoff,
} from '../src/services/step-groups/blocker-handoff.js';
import {
  readMemoryTrace,
  type StepMemoryTracePatch,
  writeMemoryTrace,
} from '../src/services/step-groups/memory-trace.js';
import { readQuota, type StepQuotaPatch, writeQuota } from '../src/services/step-groups/quota.js';
import {
  readSchedule,
  type StepSchedulePatch,
  writeSchedule,
} from '../src/services/step-groups/schedule.js';
import {
  readSkillInjection,
  type StepSkillInjectionPatch,
  writeSkillInjection,
} from '../src/services/step-groups/skill-injection.js';
import {
  readSubscription,
  type StepSubscriptionPatch,
  writeSubscription,
} from '../src/services/step-groups/subscription.js';

export type StepFixtureInsert = typeof step.$inferInsert & { id: string } & StepQuotaPatch &
  StepSubscriptionPatch &
  StepSchedulePatch &
  StepMemoryTracePatch &
  StepSkillInjectionPatch &
  StepBlockerHandoffPatch;

/** Test-only convenience for fixtures spanning the core and side tables. */
export function insertStepFixture(db: Db, row: StepFixtureInsert): void {
  const {
    quotaBlock,
    fallback,
    ranModel,
    claudeSubscriptionId,
    devinSubscriptionId,
    antigravitySubscriptionId,
    scheduleId,
    scheduledBy,
    memoryTrace,
    skillInjection,
    blockerHandoff,
    ...core
  } = row;
  db.transaction((tx) => {
    tx.insert(step).values(core).run();
    writeQuota(tx, row.id, { quotaBlock, fallback, ranModel });
    writeSubscription(tx, row.id, {
      claudeSubscriptionId,
      devinSubscriptionId,
      antigravitySubscriptionId,
    });
    writeSchedule(tx, row.id, { scheduleId, scheduledBy });
    writeMemoryTrace(tx, row.id, { memoryTrace });
    writeSkillInjection(tx, row.id, { skillInjection });
    writeBlockerHandoff(tx, row.id, { blockerHandoff });
  });
}

/** Returns undefined for a missing core row; absent side groups read as null fields. */
export function readStepFixture(db: Pick<Db, 'select'>, id: string) {
  const core = db.select().from(step).where(eq(step.id, id)).get();
  if (!core) return undefined;
  return {
    ...core,
    ...readQuota(db, id),
    ...readSubscription(db, id),
    ...readSchedule(db, id),
    ...readMemoryTrace(db, id),
    ...readSkillInjection(db, id),
    ...readBlockerHandoff(db, id),
  };
}
