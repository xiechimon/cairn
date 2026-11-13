import { coordinatorConversationKey } from '@cairn/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { coordinatorConversation, coordinatorEntry, step, stopPending } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { NotFoundError } from '../services/builds.js';
import { releaseUnconsumedSteer } from '../services/chief-turns.js';
import {
  consumeCoordinatorInput,
  coordinatorInputIsLive,
  coordinatorInputs,
  prepareCoordinatorInput,
  pullCoordinatorInput,
  releaseCoordinatorInput,
  requireCoordinatorConversation,
} from '../services/coordinator-inputs.js';
import { bindCoordinatorRun, coordinatorRuns } from '../services/coordinator-runs.js';
import { finishCoordinatorTurn, recordStepUsage } from '../services/coordinator-steps.js';
import { stopStepComputer } from '../services/machine-computer.js';
import { isChiefConversation, type MachineDeps } from '../services/machine-deps.js';
import { executeRelayToolCall, machineAsk } from '../services/machine-relay.js';
import {
  fetchStop,
  heartbeatStep,
  reportTranscriptDelta,
  reportTranscriptRow,
} from '../services/machines.js';
import { InputAuthorityError } from './runtime/input-channel.js';
import type { MachineApi } from './runtime/machine-api.js';
import { parseWatermark } from './watermark.js';

const ASK_HOLD_MS = 24 * 60 * 60 * 1000;

function inputTransition<T>(action: () => T): T {
  try {
    return action();
  } catch (error) {
    if (error instanceof HttpError) throw new InputAuthorityError(error.message);
    throw error;
  }
}

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
        conversationId:
          conversation.storeId === null
            ? conversation.conversationId
            : coordinatorConversationKey(conversation.storeId, conversation.conversationId),
        entryId,
      })
      .onConflictDoUpdate({
        target: coordinatorEntry.chiefMessageId,
        set: {
          conversationId:
            conversation.storeId === null
              ? conversation.conversationId
              : coordinatorConversationKey(conversation.storeId, conversation.conversationId),
          entryId,
        },
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
    inputs: {
      position: async (threadId) =>
        deps.db
          .select()
          .from(coordinatorConversation)
          .where(eq(coordinatorConversation.threadId, threadId))
          .get() ?? null,
      targets: async (threadId) =>
        deps.db
          .select({ id: step.id, content: step.prompt })
          .from(step)
          .where(
            and(
              eq(step.buildId, threadId),
              eq(step.kind, 'chief'),
              eq(step.status, 'claimed'),
              isNull(step.machineId),
            ),
          )
          .all()
          .map((row) => ({ id: row.id, content: row.content ?? '' })),
      assertConversation: async (threadId, conversationId) =>
        inputTransition(() => requireCoordinatorConversation(deps.db, threadId, conversationId)),
      runs: async (threadId) => coordinatorRuns(deps.db, threadId),
      bindRun: async (threadId, conversationId, taskId, requestIds) =>
        inputTransition(() => {
          requireCoordinatorConversation(deps.db, threadId, conversationId);
          bindCoordinatorRun(deps.db, threadId, conversationId, taskId, requestIds);
        }),
      list: async (threadId) =>
        coordinatorInputs(deps.db, threadId).map((input) => ({
          ...input,
          live: coordinatorInputIsLive(deps.db, input.id) === true,
        })),
      prepare: async (stepId, conversationId, content, existingEntryId) => {
        const input = inputTransition(() =>
          prepareCoordinatorInput(deps.db, stepId, conversationId, content, existingEntryId),
        );
        return { ...input, live: coordinatorInputIsLive(deps.db, input.id) === true };
      },
      consume: async (requestId, conversationId, entryId) =>
        inputTransition(() => consumeCoordinatorInput(deps.db, requestId, conversationId, entryId)),
      release: async (requestId, conversationId) =>
        inputTransition(() => releaseCoordinatorInput(deps.db, requestId, conversationId)),
      checkpoint: async (threadId, conversationId, entryId) => {
        const current = deps.db
          .select()
          .from(coordinatorConversation)
          .where(eq(coordinatorConversation.threadId, threadId))
          .get();
        const watermark = parseWatermark(current?.lastMirroredEntryId ?? null);
        if (
          current === undefined ||
          (current.storeId === null
            ? current.conversationId
            : coordinatorConversationKey(current.storeId, current.conversationId)) !==
            conversationId ||
          watermark?.kind === 'rewind' ||
          (watermark?.kind === 'mirrored' && watermark.entryId >= Number(entryId))
        )
          return;
        deps.db
          .update(coordinatorConversation)
          .set({ lastMirroredEntryId: entryId, updatedAt: Date.now() })
          .where(eq(coordinatorConversation.threadId, threadId))
          .run();
      },
    },
    steer: async (stepId, admittedRequestIds) => {
      const input = pullCoordinatorInput(deps.db, stepId, undefined, admittedRequestIds);
      return input === null ? null : { content: input.content, key: input.id };
    },
    relayTool: (stepId, name, params, toolCallId, signal) =>
      executeRelayToolCall(deps, null, stepId, name, params, toolCallId, signal),
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
          if (!coordinatorInputs(deps.db, owned.buildId).some((input) => input.stepId === stepId))
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
      if (!isChiefConversation(owned.buildId)) return;
      mapEntry(stepId, owned.buildId, entryId);
      const conversation = deps.db
        .select()
        .from(coordinatorConversation)
        .where(eq(coordinatorConversation.threadId, owned.buildId))
        .get();
      const mirrored = parseWatermark(conversation?.lastMirroredEntryId ?? null);
      if (
        conversation === undefined ||
        (mirrored?.kind === 'mirrored' && mirrored.entryId >= Number(entryId))
      ) {
        return;
      }
      deps.db
        .update(coordinatorConversation)
        .set({ lastMirroredEntryId: entryId, updatedAt: Date.now() })
        .where(eq(coordinatorConversation.threadId, owned.buildId))
        .run();
    },
    transcriptDelta: async (stepId, text) => {
      reportTranscriptDelta(deps, null, stepId, text);
    },
    done: async (stepId, body, observation) => {
      const owned = stepRow(stepId);
      recordStepUsage(deps, owned, body.usage ?? []);
      deps.db.delete(stopPending).where(eq(stopPending.stepId, stepId)).run();
      releaseUnconsumedSteer(deps.db, owned);
      finishCoordinatorTurn(deps, owned, body, observation);
      stopStepComputer(deps, stepId);
    },
  };
}
