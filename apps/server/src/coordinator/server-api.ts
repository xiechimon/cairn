import { eq } from 'drizzle-orm';
import { coordinatorConversation, coordinatorEntry, step, stopPending } from '../db/schema.js';
import { NotFoundError } from '../services/builds.js';
import { releaseUnconsumedSteer } from '../services/chief-turns.js';
import { finishCoordinatorTurn, recordStepUsage } from '../services/coordinator-steps.js';
import { isChiefConversation, type MachineDeps } from '../services/machine-deps.js';
import { executeRelayToolCall, machineAsk } from '../services/machine-relay.js';
import {
  fetchStop,
  heartbeatStep,
  reportTranscriptDelta,
  reportTranscriptRow,
} from '../services/machines.js';
import type { MachineApi } from './runtime/machine-api.js';

const ASK_HOLD_MS = 24 * 60 * 60 * 1000;

export function createCoordinatorServerApi(deps: MachineDeps): MachineApi {
  const stepRow = (stepId: string) => {
    const row = deps.db.select().from(step).where(eq(step.id, stepId)).get();
    if (!row) throw new NotFoundError(`step ${stepId}`);
    return row;
  };
  const mapEntry = (chiefMessageId: string, threadId: string, entryId: string) => {
    const conversation = deps.db
      .select()
      .from(coordinatorConversation)
      .where(eq(coordinatorConversation.threadId, threadId))
      .get();
    if (conversation === undefined) return;
    deps.db
      .insert(coordinatorEntry)
      .values({
        chiefMessageId,
        threadId,
        conversationId: conversation.conversationId,
        entryId,
      })
      .onConflictDoUpdate({
        target: coordinatorEntry.chiefMessageId,
        set: { conversationId: conversation.conversationId, entryId },
      })
      .run();
  };
  return {
    claim: async () => null,
    recover: async () => [],
    token: async () => ({ provider: null, secrets: {}, git: null }),
    heartbeat: async (stepId) => {
      heartbeatStep(deps, null, stepId);
    },
    stop: async (stepId) => fetchStop(deps, { id: null }, stepId).discard,
    relayTool: (stepId, name, params) => executeRelayToolCall(deps, null, stepId, name, params),
    askUser: (stepId, body, signal) =>
      machineAsk(deps, null, stepId, body, {
        holdMs: ASK_HOLD_MS,
        ...(signal === undefined ? {} : { signal }),
      }),
    transcriptRow: async (stepId, row, entryId) => {
      const owned = stepRow(stepId);
      deps.db.transaction(() => {
        reportTranscriptRow(deps, null, stepId, row);
        if (entryId !== undefined && isChiefConversation(owned.buildId)) {
          mapEntry(row.id, owned.buildId, entryId);
          deps.db
            .update(coordinatorConversation)
            .set({ lastMirroredEntryId: entryId, updatedAt: Date.now() })
            .where(eq(coordinatorConversation.threadId, owned.buildId))
            .run();
        }
      });
    },
    mapUserEntry: async (stepId, entryId) => {
      const owned = stepRow(stepId);
      if (isChiefConversation(owned.buildId)) mapEntry(stepId, owned.buildId, entryId);
    },
    transcriptDelta: async (stepId, text) => {
      reportTranscriptDelta(deps, null, stepId, text);
    },
    done: async (stepId, body) => {
      const owned = stepRow(stepId);
      recordStepUsage(deps, owned, body.usage ?? []);
      deps.db.delete(stopPending).where(eq(stopPending.stepId, stepId)).run();
      releaseUnconsumedSteer(deps.db, owned);
      finishCoordinatorTurn(deps, owned, body);
    },
  };
}
