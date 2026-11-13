import {
  type ClaimedStep,
  contextTokensOf,
  estimateTokens,
  isMailWakeText,
  type MachineDoneBody,
  type ModelUsage,
  mailFenceBlock,
  mailSharedTranscript,
  type OtelObservation,
} from '@cairn/shared';
import type { Context } from '@earendil-works/chord/context';
import type { AssistantMessage, ModelThinkingLevel } from '@earendil-works/pi-ai';
import {
  AssistantEntry,
  type ConversationId,
  ConversationIdle,
  type Cursor,
  type EntryRecord,
  type Harness,
  type SettledSubmissionRecord,
} from '@earendil-works/pi-durable';
import { compactionWindow, type ModelRef } from './compaction.js';
import { activeConversation, type Conversation } from './conversations.js';
import {
  reportCompactionFailure,
  reportLiveCompactionFailure,
  taskFailure,
} from './failure-report.js';
import type { InputReceipts } from './input-receipts.js';
import type { MachineApi } from './machine-api.js';
import { createTurnMirror } from './mirror.js';
import type { CoordinatorModels } from './models.js';
import type { ConversationGate, StepGate } from './tools.js';
import { emitTurnSpans } from './turn-spans.js';
import type { ColdSlimPlan, VolatileContext } from './volatile.js';

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
  volatileText?: string | null;
  coldSlim?: ColdSlimPlan | null;
  beforeDone?: () => void;
  onModel?: (ref: ModelRef) => void;
}

function turnUsage(answer: AssistantMessage, entries: readonly EntryRecord[]): ModelUsage {
  const usage = {
    model: `${answer.provider}/${answer.model}`,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    contextTokens: contextTokensOf(answer.usage),
  };
  for (const entry of entries) {
    const message = entry.model?.[0];
    if (!AssistantEntry.is(entry) || message?.role !== 'assistant') continue;
    usage.input += message.usage.input;
    usage.output += message.usage.output;
    usage.cacheRead += message.usage.cacheRead;
    usage.cacheWrite += message.usage.cacheWrite;
  }
  return usage;
}

export const SWITCH_FOLD_INSTRUCTIONS =
  'The Coordinator is switching models; keep everything the next model needs to continue.';

async function foldBeforeModelSwitch(
  deps: TurnDeps,
  root: Conversation,
  next: ModelRef,
  scope: { threadId: string; stepId: string },
): Promise<void> {
  const current = (await root.agent(deps.context)).model;
  if (current === undefined) return;
  if (current.provider === next.provider && current.modelId === next.modelId) return;
  const window = deps.models.models.getModel(next.provider, next.modelId)?.contextWindow;
  if (window === undefined) return;
  const view = await root.context(deps.context);
  if (estimateTokens(JSON.stringify(view.messages)) < compactionWindow(window).backgroundAt) return;
  try {
    const task = await root.compact(SWITCH_FOLD_INSTRUCTIONS, deps.context);
    const settled = await deps.harness.waitForTask(task, deps.context);
    const { outcome } = settled.state;
    if (outcome.status !== 'completed') {
      const reason = outcome.error?.message ?? outcome.reason ?? outcome.status;
      reportCompactionFailure(scope, 'model-switch-fold', taskFailure(reason));
    }
  } catch (error) {
    reportCompactionFailure(scope, 'model-switch-fold', error);
  }
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
    if (body.status === 'success') deps.beforeDone?.();
    await deps.inputs?.barrier();
    await api.done(stepId, body, observation);
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

  const heartbeat = setInterval(() => void api.heartbeat(stepId).catch(() => {}), deps.heartbeatMs);
  deps.gate?.set(stepId);
  deps.onModel?.({ provider, modelId });
  let stopPoll: ReturnType<typeof setInterval> | undefined;
  let steerPoll: ReturnType<typeof setInterval> | undefined;
  let rootKey: string | null = null;
  let watch: Awaited<ReturnType<Conversation['watch']>> | undefined;
  try {
    const mailTurn = isMailWakeText(claimed.instruction ?? '');
    const root = await activeConversation(harness, deps.conversationId, context);
    if (root === undefined) {
      return done({ status: 'failed', errorMessage: 'Coordinator conversation is missing' });
    }
    rootKey = String(root.id);
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
    deps.volatile?.setColdSlim(rootKey, deps.coldSlim ?? null);
    let stopping: Promise<void> | null = null;
    let polling = false;
    stopPoll = setInterval(() => {
      if (polling || stopping !== null) return;
      polling = true;
      void api
        .stop(stepId)
        .then((discard) => {
          if (discard !== null && stopping === null) stopping = root.abort(context);
        })
        .catch(() => {})
        .finally(() => {
          polling = false;
        });
    }, deps.stopPollMs ?? STOP_POLL_MS);
    let inFlight = false;
    let steerTask: Promise<void> | null = null;
    const admitted = new Set<string>();
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
        if (record !== undefined) admitted.add(input.id);
      }
    }
    const drainSteers = async () => {
      if (mailTurn) return;
      while (inFlight && stopping === null && api.steer !== undefined) {
        const steer = await api.steer(stepId, api.inputs === undefined ? undefined : [...admitted]);
        if (steer === null) return;
        const requestId = api.inputs === undefined ? `steer-${stepId}-${steer.key}` : steer.key;
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
        if (api.inputs === undefined) await api.ackSteer?.(stepId);
        await deps.inputs?.barrier();
      }
    };
    if (!mailTurn) {
      steerPoll = setInterval(() => {
        if (!inFlight || steerTask !== null || stopping !== null) return;
        steerTask = drainSteers()
          .catch(() => {})
          .finally(() => {
            steerTask = null;
          });
      }, deps.stopPollMs ?? STOP_POLL_MS);
    }
    await foldBeforeModelSwitch(
      deps,
      root,
      { provider, modelId },
      { threadId: claimed.chief.threadId, stepId },
    );
    await root.configure(
      {
        model: { provider, modelId },
        instructions: claimed.chief.systemPrompt,
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
    watch = await root.watch(context);
    watch.start(async (call) => {
      if (call.kind !== 'value') return;
      reportLiveCompactionFailure({ threadId, stepId }, call.value.docs['pi.live']);
      await mirror.onView(call.value);
    });
    if (stopping !== null) {
      await stopping;
      return done({ status: 'stopped' });
    }
    const previousInitial = (await api.inputs?.list(threadId))?.find(
      (input) =>
        input.stepId === stepId &&
        input.kind === 'initial' &&
        input.conversationId === conversationKey,
    );
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
    const initial = await api.inputs?.prepare(
      stepId,
      conversationKey,
      storedInstruction ?? '',
      prior?.entry === undefined ? undefined : String(prior.entry),
    );
    const submission = await root.submit(
      {
        type: 'input',
        content: initial?.content ?? storedInstruction ?? '',
        requestId: initial?.id ?? stepId,
      },
      context,
    );
    inFlight = true;
    let settled = await submission.wait(context);
    const firstEntry = settled.entry;
    const settledInputs = new Map<string, SettledSubmissionRecord>();
    settledInputs.set(stepId, settled);
    for (;;) {
      await steerTask;
      const remaining = [...admitted].filter((id) => !settledInputs.has(id));
      if (api.inputs === undefined || remaining.length === 0) {
        inFlight = false;
        clearInterval(steerPoll);
        await steerTask;
        if ([...admitted].every((id) => settledInputs.has(id)) || api.inputs === undefined) break;
        continue;
      }
      await Promise.all(
        remaining.map(async (id) => {
          const record = await harness.commit((tx) => tx.submissionByRequest(root.id, id), context);
          if (record === undefined) throw new Error(`Admitted Coordinator input ${id} is missing`);
          const handle = await harness.submission(record.id, context);
          if (handle === undefined)
            throw new Error(`Admitted Coordinator submission ${id} is missing`);
          settledInputs.set(id, await handle.wait(context));
        }),
      );
    }
    for (const record of settledInputs.values()) {
      if (
        record.status === 'unanswered' ||
        (record.status === 'done' &&
          (settled.status !== 'done' || Number(record.answer) > Number(settled.answer)))
      )
        settled = record;
    }
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
    await mirror.flush(turnEntries);
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
    clearInterval(stopPoll);
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
    const answerId = settled.answer;
    const entry = await root.commit((tx) => tx.entry(AssistantEntry, answerId), context);
    const answer = entry?.model?.[0];
    if (answer?.role !== 'assistant') {
      return done({ status: 'failed', errorMessage: 'Coordinator turn has no answer entry' });
    }
    const usage = turnUsage(answer, turnEntries);
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
    void watch?.stop();
    clearInterval(stopPoll);
    clearInterval(steerPoll);
    deps.gate?.set(null);
    if (rootKey !== null) {
      deps.conversationGate?.set(rootKey, null);
      deps.volatile?.set(rootKey, null);
      deps.volatile?.setStep(rootKey, null);
      deps.volatile?.setColdSlim(rootKey, null);
    }
    clearInterval(heartbeat);
  }
}
