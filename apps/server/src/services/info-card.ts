import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  INFO_CARD_TOOLS,
  type RemoteToolDef,
  type StepKind,
  type StepQueueBlocked,
  WORKER_ASK_USER_TOOL,
} from '@cairn/shared';
import { and, desc, eq, gte } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { attachment, machine, type step, type todo } from '../db/schema.js';
import { coordinatorInServerEnabled } from './coordinator-context.js';
import { stepRuntimeFor } from './dispatch-eligibility.js';
import { effectiveModel } from './model-fallback.js';
import { profileForStep, providerRefusal, type RouteProfile } from './routing-rules.js';

export type InfoCardPlan =
  | { kind: 'pi'; profile: RouteProfile; provider: string; modelId: string; machineId: string }
  | { kind: 'runner'; profile: RouteProfile; machineId: string; relayOnly: boolean }
  | { kind: 'wait'; blocked: StepQueueBlocked };

export function infoComputerHosts(db: Pick<Db, 'select'>, teamId: string) {
  return db
    .select()
    .from(machine)
    .where(eq(machine.teamId, teamId))
    .all()
    .filter((row) => row.online)
    .sort(
      (a, b) =>
        Number(b.capabilities?.computer === true) - Number(a.capabilities?.computer === true),
    );
}

export function infoCardPlan(
  db: Db,
  todoRow: Pick<
    typeof todo.$inferSelect,
    'teamId' | 'projectId' | 'sourceKind' | 'sourceRef' | 'routeOverride'
  >,
  stepRow: Pick<typeof step.$inferSelect, 'id' | 'kind' | 'fallback'>,
): InfoCardPlan {
  const host = infoComputerHosts(db, todoRow.teamId)[0];
  if (host === undefined) return { kind: 'wait', blocked: { kind: 'no-computer', missing: [] } };
  const profile = profileForStep(db, todoRow, stepRow.kind, stepRow.id);
  if (profile === null || profile.modelId === null) {
    return { kind: 'wait', blocked: { kind: 'model-unavailable', missing: [] } };
  }
  const model = effectiveModel(profile, stepRow);
  if (model.provider === null || model.modelId === null) {
    return { kind: 'wait', blocked: { kind: 'model-unavailable', missing: [] } };
  }
  const runtime = stepRuntimeFor(model.provider);
  if (runtime !== 'pi') {
    return { kind: 'runner', profile, machineId: host.id, relayOnly: runtime === 'claude-code' };
  }
  if (
    !coordinatorInServerEnabled() ||
    providerRefusal(db, todoRow.teamId, model.provider) !== null
  ) {
    return { kind: 'wait', blocked: { kind: 'model-unavailable', missing: [] } };
  }
  return {
    kind: 'pi',
    profile,
    provider: model.provider,
    modelId: model.modelId,
    machineId: host.id,
  };
}

export function acceptedInfoReport(
  deps: { db: Db; attachmentsDir?: string | undefined },
  stepRow: Pick<typeof step.$inferSelect, 'buildId' | 'claimedAt' | 'createdAt'>,
): string | undefined {
  if (deps.attachmentsDir === undefined) return undefined;
  const row = deps.db
    .select({ storageKey: attachment.storageKey })
    .from(attachment)
    .where(
      and(
        eq(attachment.grantId, `report-${stepRow.buildId}`),
        eq(attachment.status, 'ready'),
        gte(attachment.createdAt, stepRow.claimedAt ?? stepRow.createdAt),
      ),
    )
    .orderBy(desc(attachment.createdAt))
    .get();
  if (row === undefined) return undefined;
  try {
    return readFileSync(join(deps.attachmentsDir, row.storageKey), 'utf8');
  } catch {
    return undefined;
  }
}

export function infoCardRemoteTools(kind: StepKind): RemoteToolDef[] {
  return [...INFO_CARD_TOOLS, ...(kind === 'session' ? [WORKER_ASK_USER_TOOL] : [])];
}
