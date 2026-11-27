import {
  coordinatorConversationKey,
  type MachineDoneBody,
  type OtelObservation,
  quickRepliesRowId,
  TRANSCRIPT_PROMPT_ROW_ID_PREFIX,
} from '@cairn/shared';
import { and, eq, gt, isNull, notLike, or } from 'drizzle-orm';
import {
  chiefMessage,
  coordinatorConversation,
  coordinatorEntry,
  step,
  stopPending,
} from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { NotFoundError } from '../services/builds.js';
import { chiefMessageStored } from '../services/chief.js';
import { askQuestionContentOf } from '../services/chief-question-store.js';
import { storeQuickReplies } from '../services/chief-quick-replies.js';
import { releaseUnconsumedSteer } from '../services/chief-turns.js';
import { wakeCoordinator } from '../services/coordinator-context.js';
import {
  consumeCoordinatorInput,
  coordinatorInputIsLive,
  coordinatorInputs,
  inputRequestId,
  inputRequestIds,
  prepareCoordinatorInput,
  pullCoordinatorInput,
  releaseCoordinatorInput,
  requireCoordinatorConversation,
  stoppedCoordinatorTurns,
} from '../services/coordinator-inputs.js';
import { bindCoordinatorRun, coordinatorRuns } from '../services/coordinator-runs.js';
import { finishCoordinatorTurn, recordStepUsage } from '../services/coordinator-steps.js';
import { stopStepComputer } from '../services/machine-computer.js';
import {
  isChiefConversation,
  type MachineDeps,
  ownedStepRow,
  stepTeamId,
  touchStepProgress,
  withFencedTransaction,
} from '../services/machine-deps.js';
import { chiefStepAgent, requeueChiefStepOnFallback } from '../services/machine-finish-step.js';
import { executeRelayToolCall, machineAsk, relayComputerTool } from '../services/machine-relay.js';
import {
  fetchStop,
  heartbeatStep,
  reportTranscriptDelta,
  storeTranscriptRow,
} from '../services/machines.js';
import { ranModel, recordProviderOutcome } from '../services/model-fallback.js';
import { publishStepRow } from '../services/quota-wait.js';
import { discardShield } from '../services/terminal-claims.js';
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
  const assertClaimed = (stepId: string, expectedGeneration?: number) => {
    const row = stepRow(stepId);
    if (row.machineId !== null)
      throw new HttpError(409, `step ${stepId} is not owned by server Coordinator`);
    if (row.status !== 'claimed') throw new HttpError(409, `step ${stepId} is not claimed`);
    if (
      expectedGeneration !== undefined
        ? row.claimedAt !== expectedGeneration
        : row.stallState?.lastRecoveredAt != null
    ) {
      throw new HttpError(409, `step ${stepId} claim generation mismatch`);
    }
    return row;
  };
  const canSuggestReplies = (stepId: string): boolean => {
    const owned = stepRow(stepId);
    if (owned.status !== 'claimed') return false;
    if (deps.db.select().from(stopPending).where(eq(stopPending.stepId, stepId)).get())
      return false;
    const rows = deps.db
      .select()
      .from(chiefMessage)
      .where(eq(chiefMessage.threadId, owned.buildId))
      .all();
    if (
      rows.some(
        (row) =>
          row.id === quickRepliesRowId(stepId) ||
          askQuestionContentOf(row.content)?.status === 'pending',
      )
    )
      return false;
    return !deps.db
      .select({ id: chiefMessage.id })
      .from(chiefMessage)
      .where(
        and(
          eq(chiefMessage.threadId, owned.buildId),
          eq(chiefMessage.role, 'user'),
          or(isNull(chiefMessage.origin), eq(chiefMessage.origin, 'user')),
          notLike(chiefMessage.id, `${TRANSCRIPT_PROMPT_ROW_ID_PREFIX}%`),
          gt(chiefMessage.createdAt, owned.claimedAt ?? owned.createdAt),
        ),
      )
      .get();
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
  const applyTranscriptRow = (
    stepId: string,
    row: Parameters<MachineApi['transcriptRow']>[1],
    entryId?: string,
  ) => {
    let owned: ReturnType<typeof ownedStepRow>;
    try {
      owned = ownedStepRow(deps, null, stepId);
    } catch (error) {
      if (error instanceof NotFoundError) return;
      throw error;
    }
    deps.db.transaction(() => {
      if (
        !isChiefConversation(owned.buildId) ||
        !chiefMessageStored(deps.db, { ...row, threadId: owned.buildId })
      )
        storeTranscriptRow(deps, owned, stepId, row);
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
  };
  const applyMapUserEntry = (stepId: string, entryId: string) => {
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
  };
  const applyResetLive = (stepId: string) => {
    const owned = deps.db.select().from(step).where(eq(step.id, stepId)).get();
    if (owned === undefined || owned.status !== 'claimed') return;
    discardShield(deps.db, stepId);
    deps.convHub?.publishActivity(owned.buildId, {
      phase: 'thinking',
      stepId,
      at: Date.now(),
      resetLive: true,
    });
  };
  const applyDone = (
    stepId: string,
    body: MachineDoneBody,
    observation?: OtelObservation,
    boundGeneration?: number,
  ) => {
    const expectedGeneration = boundGeneration ?? body.generation;
    const strictGeneration = boundGeneration !== undefined;
    const precheck = deps.db.select().from(step).where(eq(step.id, stepId)).get();
    if (
      precheck !== undefined &&
      precheck.status === 'pending' &&
      precheck.holdReason === 'stall_recovery' &&
      expectedGeneration !== undefined &&
      expectedGeneration === precheck.claimedAt &&
      precheck.stallState?.lastRecoveredFromMachineId === null
    ) {
      const released = deps.db
        .update(step)
        .set({ holdReason: null, holdUntil: null })
        .where(
          and(
            eq(step.id, stepId),
            eq(step.status, 'pending'),
            eq(step.holdReason, 'stall_recovery'),
          ),
        )
        .run();
      if (released.changes > 0 && precheck.kind === 'chief') wakeCoordinator(precheck.buildId);
    }
    withFencedTransaction(deps, (txDeps) => {
      const owned = txDeps.db.select().from(step).where(eq(step.id, stepId)).get();
      if (!owned) throw new NotFoundError(`step ${stepId}`);
      const recovered = owned.stallState?.lastRecoveredAt != null;
      const mismatch =
        expectedGeneration !== undefined
          ? owned.status !== 'claimed' ||
            owned.machineId !== null ||
            owned.claimedAt !== expectedGeneration
          : recovered || owned.status !== 'claimed' || owned.machineId !== null;
      if (mismatch) {
        if (owned.status !== 'claimed') stopStepComputer(txDeps, stepId);
        if (strictGeneration || (recovered && expectedGeneration === undefined)) {
          throw new HttpError(409, `step ${stepId} claim generation mismatch`);
        }
        return;
      }
      recordStepUsage(txDeps, owned, body.usage ?? []);
      txDeps.db.delete(stopPending).where(eq(stopPending.stepId, stepId)).run();
      releaseUnconsumedSteer(txDeps.db, owned);
      const chiefAgent = chiefStepAgent(txDeps, owned);
      if (chiefAgent !== null) {
        recordProviderOutcome(
          stepTeamId(txDeps, owned),
          ranModel(chiefAgent, owned).provider,
          body,
          false,
        );
      }
      if (requeueChiefStepOnFallback(txDeps, owned, chiefAgent, body)) {
        stopStepComputer(txDeps, stepId);
        return;
      }
      finishCoordinatorTurn(txDeps, owned, body, observation);
      stopStepComputer(txDeps, stepId);
    });
  };
  const baseApi: MachineApi = {
    claim: async () => null,
    recover: async () => [],
    token: async () => ({ provider: null, secrets: {}, git: null }),
    heartbeat: async (stepId) => {
      heartbeatStep(deps, null, stepId);
    },
    stop: async (stepId) => {
      const owned = deps.db.select().from(step).where(eq(step.id, stepId)).get();
      if (owned === undefined || owned.status !== 'claimed' || owned.machineId !== null)
        return false;
      return fetchStop(deps, { id: null }, stepId).discard;
    },
    stoppedTurns: async (threadId) => stoppedCoordinatorTurns(deps.db, threadId),
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
        inputTransition(() =>
          bindCoordinatorRun(deps.db, threadId, conversationId, taskId, requestIds),
        ),
      list: async (threadId) =>
        coordinatorInputs(deps.db, threadId).map((input) => ({
          ...input,
          id: inputRequestId(input),
          requestIds: inputRequestIds(inputRequestId(input)),
          live: coordinatorInputIsLive(deps.db, inputRequestId(input)) === true,
        })),
      prepare: async (stepId, conversationId, content, existingEntryId, renew) => {
        const input = inputTransition(() =>
          prepareCoordinatorInput(deps.db, stepId, conversationId, content, existingEntryId, renew),
        );
        return {
          ...input,
          requestIds: inputRequestIds(input.id),
          live: coordinatorInputIsLive(deps.db, input.id) === true,
        };
      },
      consume: async (requestId, conversationId, entryId, placedAt) => {
        const { placed, retired } = inputTransition(() =>
          consumeCoordinatorInput(deps.db, requestId, conversationId, entryId, placedAt),
        );
        for (const message of placed) deps.convHub?.publishMessage(message.threadId, message);
        if (retired !== undefined) publishStepRow(deps, retired);
      },
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
    relayTool: async (stepId, name, params, toolCallId, signal) => {
      const result = await executeRelayToolCall(
        deps,
        null,
        stepId,
        name,
        params,
        toolCallId,
        signal,
      );
      touchStepProgress(deps.db, stepId);
      return result;
    },
    relayComputer: async (stepId, name, params, toolCallId, signal) => {
      const result = await relayComputerTool(deps, null, stepId, name, params, toolCallId, signal);
      touchStepProgress(deps.db, stepId);
      return result;
    },
    askUser: (stepId, body, signal) =>
      machineAsk(deps, null, stepId, body, {
        holdMs: ASK_HOLD_MS,
        ...(signal === undefined ? {} : { signal }),
      }),
    transcriptRow: async (stepId, row, entryId) => {
      applyTranscriptRow(stepId, row, entryId);
    },
    mapUserEntry: async (stepId, entryId) => {
      applyMapUserEntry(stepId, entryId);
    },
    transcriptDelta: async (stepId, text) => {
      try {
        reportTranscriptDelta(deps, null, stepId, text);
      } catch (error) {
        if (!(error instanceof NotFoundError)) throw error;
      }
    },
    resetLive: async (stepId) => {
      applyResetLive(stepId);
    },
    canSuggestReplies: async (stepId) => canSuggestReplies(stepId),
    suggestReplies: async (stepId, replies) => {
      if (!canSuggestReplies(stepId)) return;
      storeQuickReplies(deps, stepRow(stepId).buildId, stepId, replies);
    },
    done: async (stepId, body, observation) => {
      applyDone(stepId, body, observation);
    },
  };
  baseApi.forGeneration = (boundStepId, boundGeneration) => {
    const ensureStepId = (stepId: string) => {
      if (stepId !== boundStepId) {
        throw new HttpError(
          409,
          `step ${stepId} does not match bound Coordinator step ${boundStepId}`,
        );
      }
    };
    return {
      ...baseApi,
      heartbeat: async (stepId) => {
        ensureStepId(stepId);
        deps.db.transaction(
          () => {
            assertClaimed(stepId, boundGeneration);
            heartbeatStep(deps, null, stepId);
          },
          { behavior: 'immediate' },
        );
      },
      stop: async (stepId) => {
        if (stepId !== boundStepId) return false;
        const owned = deps.db.select().from(step).where(eq(step.id, stepId)).get();
        if (
          owned === undefined ||
          owned.status !== 'claimed' ||
          owned.machineId !== null ||
          owned.claimedAt !== boundGeneration
        ) {
          return false;
        }
        return fetchStop(deps, { id: null }, stepId).discard;
      },
      steer: async (stepId, admittedRequestIds) => {
        ensureStepId(stepId);
        return deps.db.transaction(
          () => {
            assertClaimed(stepId, boundGeneration);
            const input = pullCoordinatorInput(deps.db, stepId, undefined, admittedRequestIds);
            return input === null ? null : { content: input.content, key: input.id };
          },
          { behavior: 'immediate' },
        );
      },
      relayTool: async (stepId, name, params, toolCallId, signal) => {
        ensureStepId(stepId);
        deps.db.transaction(() => assertClaimed(stepId, boundGeneration), {
          behavior: 'immediate',
        });
        const result = await executeRelayToolCall(
          deps,
          null,
          stepId,
          name,
          params,
          toolCallId,
          signal,
        );
        deps.db.transaction(
          () => {
            assertClaimed(stepId, boundGeneration);
            touchStepProgress(deps.db, stepId);
          },
          { behavior: 'immediate' },
        );
        return result;
      },
      relayComputer: async (stepId, name, params, toolCallId, signal) => {
        ensureStepId(stepId);
        deps.db.transaction(() => assertClaimed(stepId, boundGeneration), {
          behavior: 'immediate',
        });
        const result = await relayComputerTool(
          deps,
          null,
          stepId,
          name,
          params,
          toolCallId,
          signal,
        );
        deps.db.transaction(
          () => {
            assertClaimed(stepId, boundGeneration);
            touchStepProgress(deps.db, stepId);
          },
          { behavior: 'immediate' },
        );
        return result;
      },
      askUser: async (stepId, body, signal) => {
        ensureStepId(stepId);
        deps.db.transaction(() => assertClaimed(stepId, boundGeneration), {
          behavior: 'immediate',
        });
        const result = await machineAsk(deps, null, stepId, body, {
          holdMs: ASK_HOLD_MS,
          ...(signal === undefined ? {} : { signal }),
        });
        deps.db.transaction(() => assertClaimed(stepId, boundGeneration), {
          behavior: 'immediate',
        });
        return result;
      },
      transcriptRow: async (stepId, row, entryId) => {
        ensureStepId(stepId);
        deps.db.transaction(
          () => {
            assertClaimed(stepId, boundGeneration);
            applyTranscriptRow(stepId, row, entryId);
          },
          { behavior: 'immediate' },
        );
      },
      mapUserEntry: async (stepId, entryId) => {
        ensureStepId(stepId);
        deps.db.transaction(
          () => {
            assertClaimed(stepId, boundGeneration);
            applyMapUserEntry(stepId, entryId);
          },
          { behavior: 'immediate' },
        );
      },
      transcriptDelta: async (stepId, text) => {
        ensureStepId(stepId);
        deps.db.transaction(
          () => {
            assertClaimed(stepId, boundGeneration);
            reportTranscriptDelta(deps, null, stepId, text);
          },
          { behavior: 'immediate' },
        );
      },
      resetLive: async (stepId) => {
        ensureStepId(stepId);
        deps.db.transaction(
          () => {
            assertClaimed(stepId, boundGeneration);
            applyResetLive(stepId);
          },
          { behavior: 'immediate' },
        );
      },
      canSuggestReplies: async (stepId) => {
        if (stepId !== boundStepId) return false;
        try {
          return deps.db.transaction(
            () => {
              assertClaimed(stepId, boundGeneration);
              return canSuggestReplies(stepId);
            },
            { behavior: 'immediate' },
          );
        } catch {
          return false;
        }
      },
      suggestReplies: async (stepId, replies) => {
        ensureStepId(stepId);
        deps.db.transaction(
          () => {
            assertClaimed(stepId, boundGeneration);
            if (!canSuggestReplies(stepId)) return;
            storeQuickReplies(deps, stepRow(stepId).buildId, stepId, replies);
          },
          { behavior: 'immediate' },
        );
      },
      done: async (stepId, body, observation) => {
        ensureStepId(stepId);
        applyDone(stepId, body, observation, boundGeneration);
      },
    };
  };
  return baseApi;
}
