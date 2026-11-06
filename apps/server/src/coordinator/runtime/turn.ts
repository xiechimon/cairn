import { createHash } from 'node:crypto';
import type { ClaimedStep, MachineDoneBody, ModelUsage } from '@cairn/shared';
import type { Context } from '@earendil-works/chord/context';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import { AssistantEntry, type EntryRecord, type Harness } from '@earendil-works/pi-durable';
import { compactionWindow, estimateTokens, type ModelRef } from './compaction.js';
import { activeConversation, type Conversation } from './conversations.js';
import type { MachineApi } from './machine-api.js';
import { createTurnMirror } from './mirror.js';
import type { CoordinatorModels } from './models.js';
import type { ConversationGate, StepGate } from './tools.js';
import type { VolatileContext } from './volatile.js';

const STOP_POLL_MS = 1_000;
const STEER_REQUEST_HASH_CHARS = 16;

function steerRequestId(stepId: string, content: string): string {
  const digest = createHash('sha256').update(content).digest('hex');
  return `steer-${stepId}-${digest.slice(0, STEER_REQUEST_HASH_CHARS)}`;
}

export interface TurnDeps {
  harness: Harness;
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
  onModel?: (ref: ModelRef) => void;
}

function turnUsage(answer: AssistantMessage, entries: readonly EntryRecord[]): ModelUsage {
  const usage = {
    model: `${answer.provider}/${answer.model}`,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    contextTokens: answer.usage.input + answer.usage.cacheRead + answer.usage.cacheWrite,
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
    await deps.harness.waitForTask(task, deps.context);
  } catch {
    return;
  }
}

export async function runCoordinatorTurn(
  deps: TurnDeps,
  claimed: ClaimedStep,
): Promise<MachineDoneBody> {
  const { harness, api, context } = deps;
  const stepId = claimed.step.id;
  const done = async (body: MachineDoneBody) => {
    await api.done(stepId, body);
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
  try {
    const root = await activeConversation(harness, deps.conversationId, context);
    if (root === undefined) {
      return done({ status: 'failed', errorMessage: 'Coordinator conversation is missing' });
    }
    rootKey = String(root.id);
    deps.conversationGate?.set(rootKey, stepId);
    deps.volatile?.set(rootKey, deps.volatileText ?? null);
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
    let steering = false;
    steerPoll = setInterval(() => {
      if (!inFlight || steering || stopping !== null || api.steer === undefined) return;
      steering = true;
      void api
        .steer(stepId)
        .then(async (content) => {
          if (content === null) return;
          await root.submit(
            {
              type: 'input',
              content,
              whenBusy: 'steer',
              whenIdle: 'reject',
              requestId: steerRequestId(stepId, content),
            },
            context,
          );
          await api.ackSteer?.(stepId);
        })
        .catch(() => {})
        .finally(() => {
          steering = false;
        });
    }, deps.stopPollMs ?? STOP_POLL_MS);
    await foldBeforeModelSwitch(deps, root, { provider, modelId });
    await root.configure(
      { model: { provider, modelId }, instructions: claimed.chief.systemPrompt },
      context,
    );
    const newest = (await root.entries({}, 1, undefined, context)).items[0]?.id;
    const mirror = createTurnMirror(api, stepId, newest);
    const watch = await root.watch(context);
    watch.start(async (call) => {
      if (call.kind === 'value') await mirror.onView(call.value);
    });
    if (stopping !== null) {
      await stopping;
      return done({ status: 'stopped' });
    }
    const submission = await root.submit(
      { type: 'input', content: claimed.instruction ?? '', requestId: stepId },
      context,
    );
    inFlight = true;
    const settled = await submission.wait(context);
    inFlight = false;
    clearInterval(steerPoll);
    if (settled.entry !== undefined) await api.mapUserEntry?.(stepId, String(settled.entry));
    await watch.stop();
    const turnEntries =
      settled.entry === undefined
        ? []
        : (await root.entries({ minEntryId: settled.entry }, 500, undefined, context)).items;
    await mirror.flush(turnEntries);
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
    clearInterval(stopPoll);
    clearInterval(steerPoll);
    deps.gate?.set(null);
    if (rootKey !== null) {
      deps.conversationGate?.set(rootKey, null);
      deps.volatile?.set(rootKey, null);
    }
    clearInterval(heartbeat);
  }
}
