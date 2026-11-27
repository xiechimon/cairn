import {
  type ClaimedStep,
  contextTokensOf,
  isMailWakeText,
  type MachineDoneBody,
  type ModelUsage,
  mailFenceBlock,
  mailSharedTranscript,
  type OtelObservation,
  SUBAGENT_TOOL_NAME,
  subagentToolResultSchema,
} from '@cairn/shared';
import type { Context } from '@earendil-works/chord/context';
import type { AssistantMessage, ModelThinkingLevel } from '@earendil-works/pi-ai';
import {
  AssistantEntry,
  type ConversationId,
  ConversationIdle,
  type Cursor,
  type EntryId,
  type EntryRecord,
  type Harness,
  LiveDoc,
  type SettledSubmissionRecord,
  type Submission,
  ToolResultEntry,
} from '@earendil-works/pi-durable';
import { steerWithdrawals } from '../steer-withdrawals.js';
import { compactionWindow, type ModelRef } from './compaction.js';
import { activeConversation, type Conversation } from './conversations.js';
import { reportLiveCompactionFailure } from './failure-report.js';
import type { InputReceipts } from './input-receipts.js';
import type { MachineApi } from './machine-api.js';
import { createTurnMirror } from './mirror.js';
import type { CoordinatorModels } from './models.js';
import type { ResponsivenessTracker } from './responsiveness.js';
import { cancelStoppedRequests } from './stopped-turn.js';
import { suggestAfterTurn } from './suggest-replies.js';
import type { ConversationGate, StepGate } from './tools.js';
import { emitTurnSpans } from './turn-spans.js';
import type { VolatileContext } from './volatile.js';

const STOP_POLL_MS = 1_000;

export interface TurnDeps {
  harness: Harness;
  inputs?: InputReceipts;
  afterMirror?: () => Promise<void>;
  conversationId?: string | null;
  models: CoordinatorModels;
  api: MachineApi;
  context: Context;
  heartbeatMs: number;
  stopPollMs?: number;
  now: () => number;
  gate?: StepGate;
  conversationGate?: ConversationGate;
  volatile?: VolatileContext;
  responsiveness?: ResponsivenessTracker;
  volatileText?: string | null;
  onModel?: (ref: ModelRef) => void;
  suggestionYield?: AbortSignal;
  setupPhase?: (name: string) => void;
  registerSignals?: (handlers: { onSteer(): void; onStop(): void }) => () => void;
  isInToolRound?: (conversationId: string) => boolean;
}

function turnUsage(answer: AssistantMessage, entries: readonly EntryRecord[]): ModelUsage {
  const contextTokens = contextTokensOf(answer.usage);
  const usage = {
    model: `${answer.provider}/${answer.model}`,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    ...(contextTokens > 0 ? { contextTokens } : {}),
  };
  for (const entry of entries) {
    const message = entry.model?.[0];
    if (AssistantEntry.is(entry) && message?.role === 'assistant') {
      usage.input += message.usage.input;
      usage.output += message.usage.output;
      usage.cacheRead += message.usage.cacheRead;
      usage.cacheWrite += message.usage.cacheWrite;
      continue;
    }
    if (
      ToolResultEntry.is(entry) &&
      message?.role === 'toolResult' &&
      message.toolName === SUBAGENT_TOOL_NAME
    ) {
      const text = message.content
        .flatMap((block) => (block.type === 'text' ? [block.text] : []))
        .join('');
      try {
        const parsed = subagentToolResultSchema.safeParse(JSON.parse(text));
        if (parsed.success) {
          usage.input += parsed.data.usage.inputTokens;
          usage.output += parsed.data.usage.outputTokens;
          usage.cacheRead += parsed.data.usage.cacheReadTokens;
          usage.cacheWrite += parsed.data.usage.cacheWriteTokens;
        }
      } catch {}
    }
  }
  return usage;
}

export async function runCoordinatorTurn(
  deps: TurnDeps,
  claimed: ClaimedStep,
): Promise<MachineDoneBody> {
  const { harness, api, context } = deps;
  if (api.inputs !== undefined && deps.inputs === undefined)
    throw new Error('Native Coordinator input channel requires a receipt observer');
  const stepId = claimed.step.id;
  let observation: OtelObservation | undefined;
  const done = async (body: MachineDoneBody) => {
    await deps.inputs?.barrier();
    await api.done(stepId, { ...body, generation: claimed.step.generation }, observation);
    await deps.inputs?.recover(harness);
    return body;
  };
  const provider = claimed.agent?.provider ?? null;
  const modelId = claimed.agent?.modelId ?? null;
  if (provider === null || modelId === null || claimed.chief === undefined) {
    return done({
      status: 'failed',
      errorMessage: 'Coordinator step has no model or chief context',
    });
  }
  const token = await api.token(stepId);
  if (token.provider !== null) deps.models.useStepProvider(token.provider);
  if (token.provider?.apiKey) await deps.models.setApiKey(provider, token.provider.apiKey);
  deps.setupPhase?.('token');

  const heartbeat = setInterval(() => void api.heartbeat(stepId).catch(() => {}), deps.heartbeatMs);
  deps.gate?.set(stepId);
  deps.onModel?.({ provider, modelId });
  let stopPoll: ReturnType<typeof setInterval> | undefined;
  let steerPoll: ReturnType<typeof setInterval> | undefined;
  let unregisterSignals: (() => void) | undefined;
  let rootKey: string | null = null;
  let watch: Awaited<ReturnType<Conversation['watch']>> | undefined;
  const suggestionAbort = new AbortController();
  const suggestionSignal =
    deps.suggestionYield === undefined
      ? suggestionAbort.signal
      : AbortSignal.any([suggestionAbort.signal, deps.suggestionYield]);
  try {
    const mailTurn = isMailWakeText(claimed.instruction ?? '');
    const root = await activeConversation(harness, deps.conversationId, context);
    if (root === undefined) {
      return done({ status: 'failed', errorMessage: 'Coordinator conversation is missing' });
    }
    rootKey = String(root.id);
    const activeRootKey = rootKey;
    const conversationKey = deps.inputs?.key(rootKey) ?? rootKey;
    deps.conversationGate?.set(rootKey, stepId);
    const storedInstruction = mailTurn
      ? mailSharedTranscript(claimed.instruction ?? '')
      : claimed.instruction;
    const mailExcerpt = mailTurn ? mailFenceBlock(claimed.instruction ?? '') : null;
    const volatileText = [deps.volatileText, mailExcerpt]
      .filter((part): part is string => part != null && part !== '')
      .join('\n\n');
    deps.volatile?.set(rootKey, volatileText === '' ? null : volatileText);
    deps.volatile?.setStep(rootKey, stepId);
    let stopping: Promise<void> | null = null;
    let polling = false;
    const checkStop = () => {
      if (polling || stopping !== null) return;
      polling = true;
      void api
        .stop(stepId)
        .then((discard) => {
          if (discard !== null && stopping === null) {
            suggestionAbort.abort();
            stopping = root.abort(context);
          }
        })
        .catch(() => {})
        .finally(() => {
          polling = false;
        });
    };
    stopPoll = setInterval(checkStop, deps.stopPollMs ?? STOP_POLL_MS);
    let inFlight = false;
    let steerTask: Promise<void> | null = null;
    let steerDirty = false;
    const admitted = new Set<string>();
    const admittedRequests = new Map<string, string>();
    const superseded = new Set<string>();
    let activeSubmission: Submission | undefined;
    let activeRequestId = stepId;
    let lastBargeInEntryId: EntryId | undefined;
    if (!mailTurn && api.inputs !== undefined) {
      for (const input of await api.inputs.list(claimed.chief.threadId)) {
        if (
          input.stepId !== stepId ||
          input.kind !== 'steer' ||
          input.state === 'released' ||
          input.conversationId !== conversationKey
        )
          continue;
        const record = await harness.commit(
          (tx) => tx.submissionByRequest(root.id, input.id),
          context,
        );
        if (record !== undefined) {
          admitted.add(input.id);
          admittedRequests.set(input.id, input.id);
        }
      }
    }
    deps.setupPhase?.('conversation');
    const reused = deps.volatile?.instructions(rootKey, claimed.chief.systemPrompt, stepId);
    const instructions = reused?.text ?? claimed.chief.systemPrompt;
    if (reused !== undefined && instructions !== claimed.chief.systemPrompt)
      await api.reusedInstructions?.(stepId, reused.sentBy);
    await root.configure(
      {
        model: { provider, modelId },
        instructions,
        thinkingLevel: (claimed.agent?.thinkingLevel ?? null) as ModelThinkingLevel | null,
      },
      context,
    );
    const newest = (await root.entries({}, 1, undefined, context)).items[0]?.id;
    const threadId = claimed.chief.threadId;
    const mirror = createTurnMirror(
      {
        ...api,
        transcriptRow: async (...args) => {
          if (mailTurn) return;
          await deps.inputs?.barrier();
          await api.inputs?.assertConversation(threadId, conversationKey);
          await api.transcriptRow(...args);
        },
        transcriptDelta: async (...args) => {
          if (mailTurn) return;
          await deps.inputs?.barrier();
          await api.inputs?.assertConversation(threadId, conversationKey);
          await api.transcriptDelta(...args);
        },
      },
      stepId,
      newest,
      deps.inputs?.storeId(),
    );
    const drainSteers = async () => {
      if (mailTurn) return;
      do {
        steerDirty = false;
        while (inFlight && stopping === null && api.steer !== undefined) {
          const steer = await api.steer(
            stepId,
            api.inputs === undefined ? undefined : [...admitted],
          );
          if (steer === null) break;
          const requestId = api.inputs === undefined ? `steer-${stepId}-${steer.key}` : steer.key;
          const live = await harness.snapshot(LiveDoc, root.id, context);
          const toolFree = (snapshot: typeof live) =>
            stopping === null &&
            deps.isInToolRound?.(activeRootKey) !== true &&
            (snapshot?.tools === undefined ||
              snapshot.tools.every((tool) => tool.name === SUBAGENT_TOOL_NAME));
          const canBargeIn =
            live?.run !== undefined && live.run.afterRun === undefined && toolFree(live);
          if (canBargeIn) {
            await deps.inputs?.barrier();
            const currentLive = await harness.snapshot(LiveDoc, root.id, context);
            if (toolFree(currentLive)) {
              if (currentLive?.run !== undefined && currentLive.run.afterRun === undefined) {
                superseded.add(activeRequestId);
                mirror.suppressTask(currentLive.run.taskId);
                await mirror.drain();
                await api.resetLive?.(stepId);
                await root.abort(context);
              }
              if (stopping !== null) {
                if (api.inputs !== undefined) await api.inputs.release(steer.key, conversationKey);
                return;
              }
              const nextSubmission = await root.submit(
                {
                  type: 'input',
                  content: steer.content,
                  whenBusy: 'steer',
                  requestId,
                },
                context,
              );
              admitted.add(steer.key);
              admittedRequests.set(steer.key, requestId);
              if (api.inputs === undefined) await api.ackSteer?.(stepId);
              const status = await nextSubmission.status(context);
              if (status.entry !== undefined) lastBargeInEntryId = status.entry;
              activeRequestId = requestId;
              activeSubmission = nextSubmission;
              await deps.inputs?.barrier();
              continue;
            }
          }
          if (stopping !== null) {
            if (api.inputs !== undefined) await api.inputs.release(steer.key, conversationKey);
            return;
          }
          try {
            await root.submit(
              {
                type: 'input',
                content: steer.content,
                whenBusy: 'steer',
                whenIdle: 'reject',
                requestId,
              },
              context,
            );
          } catch (error) {
            if (error instanceof ConversationIdle && api.inputs !== undefined) {
              const record = await harness.commit(
                (tx) => tx.submissionByRequest(root.id, requestId),
                context,
              );
              if (record === undefined) await api.inputs.release(requestId, conversationKey);
            }
            throw error;
          }
          admitted.add(steer.key);
          admittedRequests.set(steer.key, requestId);
          if (api.inputs === undefined) await api.ackSteer?.(stepId);
          await deps.inputs?.barrier();
        }
      } while (steerDirty && inFlight && stopping === null);
    };
    const scheduleSteerDrain = () => {
      if (mailTurn || !inFlight || stopping !== null) return;
      if (steerTask !== null) {
        steerDirty = true;
        return;
      }
      steerTask = drainSteers()
        .catch(() => {})
        .finally(() => {
          steerTask = null;
        });
    };
    unregisterSignals = deps.registerSignals?.({
      onSteer: scheduleSteerDrain,
      onStop: checkStop,
    });
    if (!mailTurn && api.inputs !== undefined) {
      steerWithdrawals.set(stepId, async (requestId) => {
        await steerTask;
        const record = await harness.commit(
          (tx) => tx.submissionByRequest(root.id, requestId),
          context,
        );
        const submission =
          record === undefined ? undefined : await harness.submission(record.id, context);
        if (submission === undefined) return 'not_found';
        const result = await submission.abort(context);
        if (result === 'aborted') {
          admitted.delete(requestId);
          admittedRequests.delete(requestId);
        }
        return result;
      });
    }
    if (!mailTurn) {
      steerPoll = setInterval(scheduleSteerDrain, deps.stopPollMs ?? STOP_POLL_MS);
    }
    watch = await root.watch(context);
    watch.start(async (call) => {
      if (call.kind !== 'value') return;
      reportLiveCompactionFailure({ threadId, stepId }, call.value.docs['pi.live']);
      await mirror.onView(call.value);
    });
    deps.setupPhase?.('configure');
    if (stopping !== null) {
      await stopping;
      return done({ status: 'stopped' });
    }
    const previousInitial = (await api.inputs?.list(threadId))?.findLast(
      (input) =>
        input.stepId === stepId &&
        input.kind === 'initial' &&
        input.conversationId === conversationKey &&
        input.state === 'consumed',
    );
    deps.setupPhase?.('input list');
    const prior =
      api.inputs === undefined
        ? undefined
        : await harness.commit(
            (tx) =>
              tx.submissionByRequest(
                Number(root.id) as ConversationId,
                previousInitial?.id ?? stepId,
              ),
            context,
          );
    deps.setupPhase?.('prior lookup');
    const initial = await api.inputs?.prepare(
      stepId,
      conversationKey,
      storedInstruction ?? '',
      prior?.entry === undefined ? undefined : String(prior.entry),
      previousInitial !== undefined && (prior === undefined || prior.status === 'unanswered'),
    );
    deps.setupPhase?.('input prepare');
    await cancelStoppedRequests(harness, root, await api.stoppedTurns(threadId), context);
    deps.responsiveness?.beginTurn(activeRootKey, {
      interactive: !mailTurn && claimed.chief.trigger === 'user',
      mailTurn,
    });
    const initialRequestId = initial?.id ?? stepId;
    const submission = await root.submit(
      {
        type: 'input',
        content: initial?.content ?? storedInstruction ?? '',
        requestId: initialRequestId,
      },
      context,
    );
    deps.setupPhase?.('submit');
    if (stopping !== null) await root.abort(context);
    activeSubmission = submission;
    activeRequestId = initialRequestId;
    inFlight = true;
    scheduleSteerDrain();
    const settledInputs = new Map<string, SettledSubmissionRecord>();
    let firstEntry: EntryId | undefined;
    {
      const awaitedId = activeRequestId;
      const initialSettled = await submission.wait(context);
      firstEntry = initialSettled.entry;
      settledInputs.set(awaitedId, initialSettled);
    }
    for (;;) {
      await steerTask;
      if (activeSubmission !== undefined && !settledInputs.has(activeRequestId)) {
        const awaitedId = activeRequestId;
        const awaitedSubmission = activeSubmission;
        settledInputs.set(awaitedId, await awaitedSubmission.wait(context));
        continue;
      }
      const remaining = [...admitted].filter(
        (key) => !settledInputs.has(admittedRequests.get(key) ?? key),
      );
      if (api.inputs === undefined || remaining.length === 0) {
        inFlight = false;
        clearInterval(steerPoll);
        await steerTask;
        if (
          settledInputs.has(activeRequestId) &&
          ([...admitted].every((key) => settledInputs.has(admittedRequests.get(key) ?? key)) ||
            api.inputs === undefined)
        )
          break;
        inFlight = true;
        continue;
      }
      await Promise.all(
        remaining.map(async (key) => {
          const requestId = admittedRequests.get(key) ?? key;
          const record = await harness.commit(
            (tx) => tx.submissionByRequest(root.id, requestId),
            context,
          );
          if (record === undefined)
            throw new Error(`Admitted Coordinator input ${requestId} is missing`);
          const handle = await harness.submission(record.id, context);
          if (handle === undefined)
            throw new Error(`Admitted Coordinator submission ${requestId} is missing`);
          settledInputs.set(requestId, await handle.wait(context));
        }),
      );
    }
    const baseSettled =
      settledInputs.get(activeRequestId) ??
      settledInputs.get(initialRequestId) ??
      [...settledInputs.values()].at(-1);
    if (baseSettled === undefined) throw new Error('Settled Coordinator input is missing');
    let settled: SettledSubmissionRecord = baseSettled;
    for (const [id, record] of settledInputs) {
      if (superseded.has(id)) continue;
      if (
        record.status === 'unanswered' ||
        (record.status === 'done' &&
          (settled.status !== 'done' || Number(record.answer) > Number(settled.answer)))
      )
        settled = record;
    }
    const answerId =
      settled.status === 'done' && settled.type === 'input' ? settled.answer : undefined;
    const answerEntry =
      answerId !== undefined
        ? await root.commit((tx) => tx.entry(AssistantEntry, answerId), context)
        : undefined;
    const answer = answerEntry?.model?.[0];
    const suggesting =
      claimed.chief.trigger === 'user' &&
      stopping === null &&
      !suggestionSignal.aborted &&
      answer?.role === 'assistant' &&
      answer.stopReason === 'stop' &&
      answer.content.some((block) => block.type === 'text' && block.text.trim() !== '')
        ? (api.canSuggestReplies?.(stepId) ?? Promise.resolve(false))
            .then((allowed) =>
              allowed
                ? suggestAfterTurn(
                    deps.models.models,
                    root,
                    { provider, modelId },
                    context,
                    { threadId, stepId },
                    suggestionSignal,
                  )
                : null,
            )
            .catch(() => null)
        : Promise.resolve(null);
    await deps.inputs?.barrier();
    if (api.inputs === undefined && settled.entry !== undefined)
      await api.mapUserEntry?.(stepId, String(settled.entry));
    await watch.stop();
    const turnEntries: EntryRecord[] = [];
    if (firstEntry !== undefined) {
      let cursor: Cursor | undefined;
      do {
        const page = await root.entries(
          { minEntryId: firstEntry, order: 'ascending' },
          500,
          cursor,
          context,
        );
        turnEntries.push(...page.items);
        cursor = page.next;
      } while (cursor !== undefined);
    }
    await mirror.flush(turnEntries, stopping !== null, lastBargeInEntryId);
    if (!mailTurn) await deps.afterMirror?.();
    const ordered = [...turnEntries].sort((a, b) => Number(a.id) - Number(b.id));
    observation = {
      input: ordered.flatMap((entry) =>
        (entry.model ?? [])
          .filter((message) => message.role === 'user')
          .map((message) => ({ role: message.role, content: message.content })),
      ),
      output: ordered
        .flatMap((entry) =>
          (entry.model ?? []).flatMap((message) =>
            message.role === 'assistant' && message.stopReason !== 'aborted'
              ? [
                  {
                    role: message.role,
                    content: message.content.filter((block) => block.type === 'text'),
                  },
                ]
              : [],
          ),
        )
        .slice(-1),
    };
    emitTurnSpans(
      { threadId: claimed.chief.threadId, stepId, provider, model: modelId },
      turnEntries,
      deps.now,
      mailTurn,
    );
    if (stopping !== null) {
      await stopping;
      return done({ status: 'stopped' });
    }
    if (settled.status !== 'done' || settled.type !== 'input') {
      const reason =
        settled.status === 'unanswered'
          ? `${settled.reason}${settled.detail === undefined ? '' : ` ${JSON.stringify(settled.detail)}`}`
          : 'no answer';
      return done({ status: 'failed', errorMessage: `Coordinator turn ended: ${reason}` });
    }
    if (answer?.role !== 'assistant') {
      return done({ status: 'failed', errorMessage: 'Coordinator turn has no answer entry' });
    }
    const usage = turnUsage(answer, turnEntries);
    const suggestion = await suggesting;
    if (suggestion !== null) {
      usage.input += suggestion.usage.input;
      usage.output += suggestion.usage.output;
      usage.cacheRead += suggestion.usage.cacheRead;
      usage.cacheWrite += suggestion.usage.cacheWrite;
      if (suggestion.replies.length > 0 && !suggestionSignal.aborted)
        await api.suggestReplies?.(stepId, suggestion.replies).catch(() => {});
    }
    if (stopping !== null) {
      await stopping;
      return done({ status: 'stopped', usage: [usage] });
    }
    const finished = await done({ status: 'success', usage: [usage] });
    const window = deps.models.models.getModel(provider, modelId)?.contextWindow;
    if (
      window !== undefined &&
      (usage.contextTokens ?? 0) >= compactionWindow(window).backgroundAt
    ) {
      await root.compact(undefined, context);
    }
    return finished;
  } finally {
    unregisterSignals?.();
    suggestionAbort.abort();
    void watch?.stop();
    steerWithdrawals.delete(stepId);
    clearInterval(stopPoll);
    clearInterval(steerPoll);
    deps.gate?.set(null);
    if (rootKey !== null) {
      deps.responsiveness?.endTurn(rootKey);
      deps.conversationGate?.set(rootKey, null);
      deps.volatile?.set(rootKey, null);
      deps.volatile?.setStep(rootKey, null);
    }
    clearInterval(heartbeat);
  }
}
