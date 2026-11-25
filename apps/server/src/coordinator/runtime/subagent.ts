import {
  buildSubagentUserPrompt,
  clampSubagentMaxTurns,
  clampSubagentTimeoutSec,
  contextTokensOf,
  coordinatorToolSourceId,
  resolveSubagentAllowedTools,
  SUBAGENT_CHILD_STEPS_MAX,
  SUBAGENT_FORK_MAX_CONTEXT_RATIO,
  SUBAGENT_MAX_CONCURRENT,
  SUBAGENT_MAX_PER_TURN,
  SUBAGENT_REQUEST_ID_PREFIX,
  SUBAGENT_SYSTEM_PROMPT,
  SUBAGENT_TOOL_DEF,
  SUBAGENT_TOOL_NAME,
  type SubagentChildStep,
  type SubagentLiveProgress,
  type SubagentToolResult,
  type SubagentUsage,
  sanitizeSubagentSummary,
  subagentLabelOf,
  subagentToolInputSchema,
} from '@cairn/shared';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import type { AssistantMessage, ToolResultMessage, Usage } from '@earendil-works/pi-ai';
import {
  AssistantEntry,
  type ConversationId,
  configure,
  defineExtension,
  defineTool,
  type EntryId,
  type EntryRecord,
  type Extension,
  ToolResultEntry,
} from '@earendil-works/pi-durable';
import type { MachineApi } from './machine-api.js';
import type { CoordinatorModels } from './models.js';
import type { ConversationGate } from './tools.js';

interface TurnSemaphoreState {
  active: number;
  total: number;
  queue: Array<{
    resolve: () => void;
    reject: (error: Error) => void;
    signal?: AbortSignal;
    onAbort?: () => void;
  }>;
}

class SubagentCapError extends Error {
  constructor(limit: number) {
    super(`max subagents per turn (${limit}) reached`);
    this.name = 'SubagentCapError';
  }
}

class SubagentAbortedError extends Error {
  constructor() {
    super('Sub-agent aborted');
    this.name = 'SubagentAbortedError';
  }
}

export class SubagentTurnLimiter {
  private readonly turns = new Map<string, TurnSemaphoreState>();

  constructor(
    private readonly maxConcurrent = SUBAGENT_MAX_CONCURRENT,
    private readonly maxPerTurn = SUBAGENT_MAX_PER_TURN,
  ) {}

  async acquire(stepId: string, signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) throw new SubagentAbortedError();
    let state = this.turns.get(stepId);
    if (state === undefined) {
      state = { active: 0, total: 0, queue: [] };
      this.turns.set(stepId, state);
    }
    if (state.total >= this.maxPerTurn) {
      throw new SubagentCapError(this.maxPerTurn);
    }
    state.total += 1;
    if (state.active < this.maxConcurrent) {
      state.active += 1;
      return () => this.release(stepId);
    }
    await new Promise<void>((resolve, reject) => {
      const waiter: TurnSemaphoreState['queue'][number] = { resolve, reject, signal };
      if (signal !== undefined) {
        const onAbort = () => {
          const idx = state.queue.indexOf(waiter);
          if (idx >= 0) state.queue.splice(idx, 1);
          reject(new SubagentAbortedError());
        };
        waiter.onAbort = onAbort;
        signal.addEventListener('abort', onAbort, { once: true });
      }
      state.queue.push(waiter);
    });
    return () => this.release(stepId);
  }

  private release(stepId: string): void {
    const state = this.turns.get(stepId);
    if (state === undefined) return;
    const next = state.queue.shift();
    if (next !== undefined) {
      if (next.signal !== undefined && next.onAbort !== undefined) {
        next.signal.removeEventListener('abort', next.onAbort);
      }
      next.resolve();
      return;
    }
    state.active = Math.max(0, state.active - 1);
  }

  clearStep(stepId: string): void {
    this.turns.delete(stepId);
  }
}

export interface CoordinatorSubagentOptions {
  gate: ConversationGate;
  models: CoordinatorModels;
  api: Pick<MachineApi, 'transcriptRow'>;
  storeId?: () => string | undefined;
  isUntrustedTurn?: (stepId: string) => boolean;
  readOnlyConnectorNames?: () => ReadonlySet<string>;
  scrubError?: (stepId: string, message: string) => string;
  onChildLifecycle?: (childConversationId: string, parentConversationId: string | null) => void;
  now?: () => number;
  minTimeoutMs?: number;
  limiter?: SubagentTurnLimiter;
}

function textFromAssistant(message: AssistantMessage): string {
  return message.content
    .flatMap((block) => (block.type === 'text' ? [block.text] : []))
    .join('\n')
    .trim();
}

function summarizeArgs(args: unknown): string | undefined {
  if (args === null || args === undefined || typeof args !== 'object') return undefined;
  const pairs = Object.entries(args as Record<string, unknown>)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .slice(0, 2)
    .map(([key, value]) => {
      const raw = typeof value === 'string' ? value : JSON.stringify(value);
      return `${key}=${raw.length > 40 ? `${raw.slice(0, 39)}…` : raw}`;
    });
  return pairs.length > 0 ? pairs.join(', ') : undefined;
}

function extractChildMetrics(entries: readonly EntryRecord[]): {
  finalText: string;
  partialText: string;
  toolCalls: number;
  childSteps: SubagentChildStep[];
  usage: SubagentUsage;
  piUsage: Usage;
  lastStopReason: AssistantMessage['stopReason'] | undefined;
  lastErrorMessage: string | undefined;
} {
  const resultsById = new Map<string, ToolResultMessage>();
  for (const entry of entries) {
    const msg = entry.model?.[0];
    if (ToolResultEntry.is(entry) && msg?.role === 'toolResult') {
      resultsById.set(msg.toolCallId, msg);
    }
  }
  const usage: SubagentUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
  const piUsage: Usage = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
  const childSteps: SubagentChildStep[] = [];
  let toolCalls = 0;
  let lastText = '';
  let lastStopReason: AssistantMessage['stopReason'] | undefined;
  let lastErrorMessage: string | undefined;
  const allTexts: string[] = [];
  const recentToolSummaries: string[] = [];

  for (const entry of entries) {
    const msg = entry.model?.[0];
    if (!AssistantEntry.is(entry) || msg?.role !== 'assistant') continue;
    lastStopReason = msg.stopReason;
    lastErrorMessage = msg.errorMessage;
    usage.inputTokens += msg.usage.input;
    usage.outputTokens += msg.usage.output;
    usage.cacheReadTokens += msg.usage.cacheRead;
    usage.cacheWriteTokens += msg.usage.cacheWrite;
    piUsage.input += msg.usage.input;
    piUsage.output += msg.usage.output;
    piUsage.cacheRead += msg.usage.cacheRead;
    piUsage.cacheWrite += msg.usage.cacheWrite;
    piUsage.totalTokens += msg.usage.totalTokens;
    if (msg.usage.cost !== undefined) {
      piUsage.cost.input += msg.usage.cost.input;
      piUsage.cost.output += msg.usage.cost.output;
      piUsage.cost.cacheRead += msg.usage.cost.cacheRead;
      piUsage.cost.cacheWrite += msg.usage.cost.cacheWrite;
      piUsage.cost.total += msg.usage.cost.total;
    }
    const text = textFromAssistant(msg);
    if (text !== '') {
      lastText = text;
      allTexts.push(text);
    }
    for (const block of msg.content) {
      if (block.type !== 'toolCall') continue;
      toolCalls += 1;
      const res = resultsById.get(block.id);
      const durationMs =
        res !== undefined && msg.timestamp > 0 && res.timestamp >= msg.timestamp
          ? res.timestamp - msg.timestamp
          : undefined;
      if (childSteps.length < SUBAGENT_CHILD_STEPS_MAX) {
        const argSummary = summarizeArgs(block.arguments);
        childSteps.push({
          name: block.name,
          ...(argSummary !== undefined ? { argSummary } : {}),
          ...(res?.isError === true ? { isError: true } : {}),
          ...(durationMs !== undefined ? { durationMs } : {}),
        });
      }
      if (res !== undefined) {
        const snippet = res.content
          .flatMap((part) => (part.type === 'text' ? [part.text] : []))
          .join(' ')
          .trim()
          .slice(0, 240);
        if (snippet !== '') recentToolSummaries.push(`${block.name}: ${snippet}`);
      }
    }
  }

  const partialParts: string[] = [];
  if (allTexts.length > 0) partialParts.push(allTexts.join('\n\n'));
  if (partialParts.length === 0 && recentToolSummaries.length > 0) {
    partialParts.push(`Partial tool outputs:\n${recentToolSummaries.slice(-3).join('\n')}`);
  }
  return {
    finalText: lastText,
    partialText: partialParts.join('\n\n') || 'No partial findings were captured before stopping.',
    toolCalls,
    childSteps,
    usage,
    piUsage,
    lastStopReason,
    lastErrorMessage,
  };
}

function findSafeForkEntry(entries: readonly EntryRecord[]): {
  entryId: EntryId | undefined;
  lastContextTokens: number;
} {
  let lastContextTokens = 0;
  let safeEntryId: EntryId | undefined;
  for (const entry of entries) {
    const msg = entry.model?.[0];
    if (AssistantEntry.is(entry) && msg?.role === 'assistant') {
      const ctxTokens = contextTokensOf(msg.usage);
      if (ctxTokens > 0) lastContextTokens = ctxTokens;
      const hasToolCall = msg.content.some((block) => block.type === 'toolCall');
      if (!hasToolCall && msg.stopReason !== 'aborted') {
        safeEntryId = entry.id;
      }
    } else if (ToolResultEntry.is(entry)) {
      safeEntryId = entry.id;
    }
  }
  return { entryId: safeEntryId, lastContextTokens };
}

export function coordinatorSubagentExtension(options: CoordinatorSubagentOptions): Extension {
  const now = options.now ?? Date.now;
  const limiter = options.limiter ?? new SubagentTurnLimiter();
  let extensionRef: Extension;

  extensionRef = defineExtension({
    name: 'cairn-coordinator-subagent',
    tools: [
      defineTool({
        name: SUBAGENT_TOOL_NAME,
        description: SUBAGENT_TOOL_DEF.description,
        parameters: SUBAGENT_TOOL_DEF.parameters as object,
        replay: 'safe',
        execute: async (rawArgs, api, context) => {
          const startedAt = now();
          const parentConversationId = String(api.conversationId);
          const stepId = await options.gate.stepFor(parentConversationId);
          const parsedInput = subagentToolInputSchema.safeParse(rawArgs);
          const parentAgent = await api.agent(context);
          const modelLabel =
            parentAgent.model !== undefined
              ? `${parentAgent.model.provider}/${parentAgent.model.modelId}`
              : 'unknown';

          if (!parsedInput.success) {
            const invalid: SubagentToolResult = {
              status: 'failed',
              summary: '',
              error: `Invalid subagent arguments: ${parsedInput.error.message}`,
              childId: '',
              runtime: 'pi',
              model: modelLabel,
              toolCalls: 0,
              durationMs: Math.max(0, now() - startedAt),
              usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
            };
            return {
              output: [{ type: 'text', text: JSON.stringify(invalid) }],
              isError: true,
              details: invalid,
            };
          }

          const input = parsedInput.data;
          const label = subagentLabelOf(input);
          const requestedMode = input.mode ?? 'fresh';
          const timeoutSec = clampSubagentTimeoutSec(input.timeoutSec);
          const timeoutMs =
            options.minTimeoutMs !== undefined
              ? Math.min(
                  timeoutSec * 1000,
                  Math.max(options.minTimeoutMs, (input.timeoutSec ?? timeoutSec) * 1000),
                )
              : timeoutSec * 1000;
          const effectiveTimeoutMs =
            options.minTimeoutMs !== undefined &&
            input.timeoutSec !== undefined &&
            input.timeoutSec < 10
              ? options.minTimeoutMs
              : timeoutMs;
          const maxTurns = clampSubagentMaxTurns(input.maxTurns);
          const store = options.storeId?.();
          const rowCallId =
            store === undefined ? api.callId : coordinatorToolSourceId(store, api.callId);

          const publishLiveProgress = async (progress: SubagentLiveProgress) => {
            await api.details(progress, context).catch(() => undefined);
            await options.api
              .transcriptRow(stepId, {
                id: rowCallId,
                role: 'assistant',
                content: {
                  kind: 'toolcall',
                  call: {
                    id: rowCallId,
                    name: SUBAGENT_TOOL_NAME,
                    arguments: rawArgs,
                    startedAt,
                    result: [{ type: 'text', text: JSON.stringify(progress) }],
                  },
                },
                createdAt: startedAt,
              })
              .catch(() => undefined);
          };

          let release: (() => void) | null = null;
          try {
            release = await limiter.acquire(stepId, context.abortSignal);
          } catch (error) {
            const isAborted = error instanceof SubagentAbortedError;
            const rejected: SubagentToolResult = {
              status: isAborted ? 'aborted' : 'failed',
              summary: '',
              error: error instanceof Error ? error.message : String(error),
              childId: '',
              runtime: 'pi',
              model: modelLabel,
              toolCalls: 0,
              durationMs: Math.max(0, now() - startedAt),
              usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
              label,
              mode: requestedMode,
            };
            return {
              output: [{ type: 'text', text: JSON.stringify(rejected) }],
              isError: !isAborted,
              details: rejected,
            };
          }

          let childId: ConversationId | null = null;
          let effectiveMode: 'fresh' | 'fork' = requestedMode;
          let fallbackFromFork = false;
          let childRegistered = false;
          let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
          let progressTimer: ReturnType<typeof setInterval> | undefined;
          let timedOut = false;

          try {
            const parentToolNames = parentAgent.callable.map((tool) => tool.name);
            const allowedNames = new Set(
              resolveSubagentAllowedTools(input.tools, parentToolNames, {
                readOnlyConnectors: options.readOnlyConnectorNames?.(),
                untrustedTurn: options.isUntrustedTurn?.(stepId) === true,
              }),
            );
            const allowedTools = parentAgent.callable.filter((tool) => allowedNames.has(tool.name));
            const modelInfo =
              parentAgent.model === undefined
                ? undefined
                : options.models.models.getModel(
                    parentAgent.model.provider,
                    parentAgent.model.modelId,
                  );

            const created = await api.commit(async (tx) => {
              const existing = (await tx.scanConversations({ ownerTaskId: api.taskId }, 1))
                .items[0];
              if (existing !== undefined) {
                return {
                  id: existing.id,
                  mode: requestedMode,
                  fallback: false,
                  reused: true,
                };
              }
              let forkEntryId: EntryId | undefined;
              let forkMode: 'fresh' | 'fork' = requestedMode;
              let fellBack = false;
              if (requestedMode === 'fork') {
                const parentPage = await tx.scanEntries(
                  { conversationId: api.conversationId, order: 'ascending' },
                  500,
                );
                const forkInfo = findSafeForkEntry(parentPage.items);
                const contextWindow = modelInfo?.contextWindow;
                if (
                  contextWindow !== undefined &&
                  forkInfo.lastContextTokens > contextWindow * SUBAGENT_FORK_MAX_CONTEXT_RATIO
                ) {
                  forkMode = 'fresh';
                  fellBack = true;
                } else if (forkInfo.entryId !== undefined) {
                  forkEntryId = forkInfo.entryId;
                } else {
                  forkMode = 'fresh';
                  fellBack = true;
                }
              }
              const record =
                forkMode === 'fork' && forkEntryId !== undefined
                  ? await tx.forkConversation(api.conversationId, forkEntryId, {
                      ownership: { kind: 'task', taskId: api.taskId },
                    })
                  : await tx.createConversation({
                      ownership: { kind: 'task', taskId: api.taskId },
                    });
              await configure(tx, record.id, {
                ...(parentAgent.model !== undefined ? { model: parentAgent.model } : {}),
                thinkingLevel: parentAgent.thinkingLevel,
                instructions: SUBAGENT_SYSTEM_PROMPT,
                extensions: { remove: [extensionRef] },
                tools: allowedTools,
                modelTools: allowedTools,
                maxTurns,
              });
              return { id: record.id, mode: forkMode, fallback: fellBack, reused: false };
            }, context);

            childId = created.id;
            effectiveMode = created.mode;
            fallbackFromFork = created.fallback;
            const childKey = String(childId);
            options.gate.set(childKey, stepId);
            options.onChildLifecycle?.(childKey, parentConversationId);
            childRegistered = true;

            await publishLiveProgress({
              status: 'running',
              label,
              childId: childKey,
              toolCalls: 0,
              startedAt,
              elapsedMs: Math.max(0, now() - startedAt),
            });

            const childHandle = await api.conversation(childId, context);
            if (childHandle === undefined) {
              throw new Error(`Sub-agent conversation ${childKey} is missing`);
            }

            const abortChild = () => {
              void childHandle.abort(BACKGROUND_CONTEXT).catch(() => undefined);
            };
            const onParentAbort = () => abortChild();
            if (context.abortSignal?.aborted) {
              abortChild();
            } else {
              context.abortSignal?.addEventListener('abort', onParentAbort, { once: true });
            }

            timeoutHandle = setTimeout(() => {
              timedOut = true;
              abortChild();
            }, effectiveTimeoutMs);

            let lastPublishedToolCalls = 0;
            progressTimer = setInterval(() => {
              if (childId === null || context.abortSignal?.aborted || timedOut) return;
              void api
                .commit(
                  (tx) =>
                    tx.scanEntries(
                      { conversationId: childId as ConversationId, order: 'ascending' },
                      200,
                    ),
                  BACKGROUND_CONTEXT,
                )
                .then((page) => {
                  const metrics = extractChildMetrics(page.items);
                  if (metrics.toolCalls !== lastPublishedToolCalls) {
                    lastPublishedToolCalls = metrics.toolCalls;
                    const lastStep = metrics.childSteps.at(-1);
                    void publishLiveProgress({
                      status: 'running',
                      label,
                      childId: childKey,
                      toolCalls: metrics.toolCalls,
                      ...(lastStep !== undefined ? { lastTool: lastStep.name } : {}),
                      startedAt,
                      elapsedMs: Math.max(0, now() - startedAt),
                    });
                  }
                })
                .catch(() => undefined);
            }, 900);

            const submission = await childHandle.submit(
              {
                type: 'input',
                content: buildSubagentUserPrompt(input.task, input.context),
                requestId: `${SUBAGENT_REQUEST_ID_PREFIX}${String(api.taskId)}`,
              },
              context,
            );

            let settledStatus: 'done' | 'unanswered' = 'unanswered';
            let unansweredReason: string | undefined;
            let unansweredDetail: string | undefined;
            try {
              const settled = await submission.wait(context);
              settledStatus = settled.status;
              if (settled.status === 'unanswered') {
                unansweredReason = settled.reason;
                unansweredDetail =
                  typeof settled.detail === 'string'
                    ? settled.detail
                    : settled.detail === undefined
                      ? undefined
                      : JSON.stringify(settled.detail);
              }
            } catch (waitError) {
              if (!timedOut && !context.abortSignal?.aborted) {
                throw waitError;
              }
            } finally {
              context.abortSignal?.removeEventListener('abort', onParentAbort);
            }

            if (timedOut) {
              await childHandle.waitForIdle(BACKGROUND_CONTEXT).catch(() => undefined);
            }

            const childEntries = (
              await api.commit(
                (tx) =>
                  tx.scanEntries(
                    { conversationId: childId as ConversationId, order: 'ascending' },
                    500,
                  ),
                BACKGROUND_CONTEXT,
              )
            ).items;
            const metrics = extractChildMetrics(childEntries);
            const durationMs = Math.max(0, now() - startedAt);

            let status: SubagentToolResult['status'] = 'completed';
            let partial = false;
            let errorMessage: string | undefined;
            let rawSummary = metrics.finalText;

            if (timedOut) {
              status = 'timed_out';
              partial = true;
              rawSummary = metrics.partialText;
            } else if (context.abortSignal?.aborted || unansweredReason === 'aborted') {
              status = 'aborted';
              rawSummary = metrics.partialText;
            } else if (unansweredReason === 'turn_limit') {
              status = 'completed';
              partial = true;
              rawSummary = metrics.partialText;
            } else if (metrics.lastStopReason === 'error') {
              status = 'failed';
              const rawErr =
                metrics.lastErrorMessage ?? unansweredDetail ?? 'Sub-agent provider error';
              errorMessage = options.scrubError ? options.scrubError(stepId, rawErr) : rawErr;
              rawSummary = metrics.finalText;
            } else if (settledStatus !== 'done') {
              status = 'failed';
              const rawErr = unansweredDetail ?? unansweredReason ?? 'Sub-agent run failed';
              errorMessage = options.scrubError ? options.scrubError(stepId, rawErr) : rawErr;
              rawSummary = metrics.finalText;
            }

            const sanitized = sanitizeSubagentSummary(rawSummary, childKey);
            const result: SubagentToolResult = {
              status,
              summary: sanitized.summary,
              ...(partial ? { partial: true } : {}),
              ...(errorMessage !== undefined ? { error: errorMessage } : {}),
              childId: childKey,
              runtime: 'pi',
              model: modelLabel,
              toolCalls: metrics.toolCalls,
              durationMs,
              usage: metrics.usage,
              ...(metrics.childSteps.length > 0 ? { childSteps: metrics.childSteps } : {}),
              label,
              mode: effectiveMode,
              ...(fallbackFromFork ? { fallbackFromFork: true } : {}),
            };
            return {
              output: [{ type: 'text', text: JSON.stringify(result) }],
              isError: status === 'failed',
              details: result,
              usage: metrics.piUsage,
            };
          } catch (error) {
            const rawErr = error instanceof Error ? error.message : String(error);
            const scrubbed = options.scrubError ? options.scrubError(stepId, rawErr) : rawErr;
            const failed: SubagentToolResult = {
              status: context.abortSignal?.aborted ? 'aborted' : 'failed',
              summary: '',
              error: scrubbed,
              childId: childId === null ? '' : String(childId),
              runtime: 'pi',
              model: modelLabel,
              toolCalls: 0,
              durationMs: Math.max(0, now() - startedAt),
              usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
              label,
              mode: effectiveMode,
              ...(fallbackFromFork ? { fallbackFromFork: true } : {}),
            };
            return {
              output: [{ type: 'text', text: JSON.stringify(failed) }],
              isError: failed.status === 'failed',
              details: failed,
            };
          } finally {
            if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
            if (progressTimer !== undefined) clearInterval(progressTimer);
            if (childRegistered && childId !== null) {
              options.gate.set(String(childId), null);
              options.onChildLifecycle?.(String(childId), null);
            }
            release?.();
          }
        },
      }),
    ],
  });

  return extensionRef;
}
