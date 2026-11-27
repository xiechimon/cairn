import type {
  AgentSessionHandle,
  AgentTokenUsage,
  DeliveredImage,
  ProviderConfig,
  StepEvent,
  StepFailureCode,
  StepFailureDetail,
} from '@cairn/shared';
import {
  classifyAgentFailure,
  classifySkillFact,
  classifyStepFailure,
  failureEndsStepNow,
  noVisionSignalOf,
  parseRetryAfterMs,
  REMOTE_TOOL_RETRY_DELAYS_MS,
  skillCallName,
  sleep,
} from '@cairn/shared';
import type { ActivityTracker } from './activity.js';
import type { AgentTodoReporter } from './agent-todo.js';
import { MISSING_HOST_TOOL } from './backend/errors.js';
import type { QuotaTrip } from './claude-quota-trip.js';
import type { TranscriptBuffer } from './journal.js';
import type { DaemonLogger } from './log.js';
import type { MachineApi } from './machine-client.js';
import type { StepTranscriptStream } from './step-transcript-stream.js';
import type { StreamWatchdog } from './stream-watchdog.js';

export interface StepPassState {
  usage: AgentTokenUsage;
  lastError: string | null;
  lastModelError: string | null;
  lastErrorWasProcessCrash: boolean;
  failureCode: StepFailureCode | null;
  failureDetail: StepFailureDetail | null;
  sawChangeTool: boolean;
  sawDone: boolean;
  sawProgress: boolean;
  zeroProgressRetries: number;
  retryStorm: boolean;
  quotaTrip: QuotaTrip | null;
}

export interface StepPassEventContext {
  stepId: string;
  client: MachineApi;
  logger: DaemonLogger;
  modelKey: string;
  provider: ProviderConfig | null | undefined;
  handle: AgentSessionHandle;
  promptImages: DeliveredImage[] | undefined;
  retryStormMax: number;
  now: () => number;
  watchdog: StreamWatchdog;
  activity: ActivityTracker;
  stream: StepTranscriptStream;
  transcript: TranscriptBuffer;
  agentTodo: AgentTodoReporter;
  toolStartedAt: Map<string, number>;
}

const CHANGE_TOOLS = new Set(['edit', 'write', 'bash']);

async function withRetries<T>(
  fn: () => Promise<T>,
  delaysMs: readonly number[],
  logger: DaemonLogger,
  label: string,
): Promise<T | null> {
  let lastErr: unknown;
  for (let i = 0; i <= delaysMs.length; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const delay = delaysMs[i - 1];
      if (delay === undefined) break;
      await sleep(delay);
    }
  }
  logger.step(
    `${label} retry exhausted: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
  );
  return null;
}

export function newStepPassState(): StepPassState {
  return {
    usage: [],
    lastError: null,
    lastModelError: null,
    lastErrorWasProcessCrash: false,
    failureCode: null,
    failureDetail: null,
    sawChangeTool: false,
    sawDone: false,
    sawProgress: false,
    zeroProgressRetries: 0,
    retryStorm: false,
    quotaTrip: null,
  };
}

export function resetStepPassForRetry(s: StepPassState): void {
  s.lastError = null;
  s.lastModelError = null;
  s.lastErrorWasProcessCrash = false;
  s.failureCode = null;
  s.failureDetail = null;
  s.sawDone = false;
  s.sawProgress = false;
  s.zeroProgressRetries = 0;
  s.retryStorm = false;
  s.usage = [];
}

export async function consumeStepPassEvent(
  ev: StepEvent,
  ctx: StepPassEventContext,
  s: StepPassState,
): Promise<void> {
  const {
    stepId,
    client,
    logger,
    modelKey,
    provider,
    handle,
    promptImages,
    retryStormMax,
    now,
    watchdog,
    activity,
    stream,
    transcript,
    agentTodo,
    toolStartedAt,
  } = ctx;
  const segments = stream.segments;
  switch (ev.type) {
    case 'text_delta': {
      watchdog.noteProgress();
      s.sawProgress = true;
      s.zeroProgressRetries = 0;
      activity.setPhase('responding');
      stream.pushText(ev.text);
      await segments.append('text', ev.text);
      break;
    }
    case 'thinking_delta': {
      watchdog.noteProgress();
      s.sawProgress = true;
      s.zeroProgressRetries = 0;
      activity.setPhase('thinking');
      stream.pushThinking(ev.text);
      await segments.append('thinking', ev.text);
      break;
    }
    case 'thinking': {
      watchdog.noteProgress();
      activity.setPhase('thinking');
      await segments.replace('thinking', ev.text);
      break;
    }
    case 'toolcall_end': {
      const eventTime = now();
      if (ev.call.result === undefined) {
        const startedAt = ev.call.startedAt ?? toolStartedAt.get(ev.call.id) ?? eventTime;
        toolStartedAt.set(ev.call.id, startedAt);
        ev.call = { ...ev.call, startedAt };
      } else {
        const startedAt = ev.call.startedAt ?? toolStartedAt.get(ev.call.id);
        ev.call = {
          ...ev.call,
          ...(startedAt !== undefined ? { startedAt } : {}),
          endedAt: ev.call.endedAt ?? eventTime,
        };
        toolStartedAt.delete(ev.call.id);
      }
      watchdog.noteProgress();
      s.sawProgress = true;
      s.zeroProgressRetries = 0;
      if (ev.call.name && CHANGE_TOOLS.has(ev.call.name.toLowerCase())) {
        s.sawChangeTool = true;
      }
      await segments.seal();
      if (ev.call.result === undefined) {
        const skillName = skillCallName(ev.call);
        activity.toolStarted(
          ev.call.id,
          skillName !== null ? `skill: ${skillName}` : ev.call.name || 'tool',
        );
      } else {
        activity.toolEnded(ev.call.id);
        if (ev.call.isError === true) {
          const text =
            typeof ev.call.result === 'string'
              ? ev.call.result
              : JSON.stringify(ev.call.result ?? '');
          if (MISSING_HOST_TOOL.test(text)) {
            activity.setPhase('tool', {
              tool: ev.call.name || 'tool',
              stallSignal: 'missing_tools',
              detail: text.slice(0, 400),
            });
          }
        }
        const skillFact = classifySkillFact(ev.call);
        if (skillFact !== null) activity.noteSkill(skillFact);
      }
      if (ev.call.todo !== undefined) agentTodo.report(ev.call.todo);
      transcript.upsert({
        id: ev.call.id,
        role: 'assistant',
        content: { kind: 'toolcall', call: ev.call },
        createdAt: stream.rowCreatedAt(),
      });
      if (ev.call.result === undefined) {
        await client.tool(stepId, ev.call).catch((err: unknown) => {
          logger.step(
            `tool start relay failed for ${ev.call.id}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        });
      } else {
        const ok = await withRetries(
          () => client.tool(stepId, ev.call),
          REMOTE_TOOL_RETRY_DELAYS_MS,
          logger,
          `tool relay ${ev.call.id}`,
        );
        if (ok === null)
          logger.step(`tool relay failed for ${ev.call.id} (transcript upload will carry it)`);
      }
      break;
    }
    case 'message_end': {
      if (ev.message.role === 'user') break;
      const messageUsage = ev.message.usage as
        | {
            input?: number;
            output?: number;
            cacheRead?: number;
            cacheWrite?: number;
            cost?: { total?: number };
          }
        | undefined;
      if (ev.message.role === 'assistant' && messageUsage !== undefined) {
        logger.step(
          `message usage: ${modelKey} input=${messageUsage.input ?? 0} output=${messageUsage.output ?? 0} cacheRead=${messageUsage.cacheRead ?? 0} cacheWrite=${messageUsage.cacheWrite ?? 0}${
            messageUsage.cost !== undefined ? ` cost=${messageUsage.cost.total ?? 0}` : ''
          }`,
        );
      }
      if (ev.message.role === 'assistant' && ev.message.stopReason !== 'error') {
        watchdog.noteProgress();
        s.sawProgress = true;
        s.zeroProgressRetries = 0;
      }
      if (ev.message.role !== 'assistant') {
        transcript.upsert({
          id: stream.nextMessageId(),
          role: ev.message.role,
          content: ev.message.content,
          createdAt: stream.rowCreatedAt(),
        });
        break;
      }
      if (ev.message.stopReason === 'error') stream.discardAttempt();
      else await segments.endAssistantMessage(ev.message.content);
      break;
    }
    case 'error': {
      const isTrailingExit =
        (ev.error.processCrash === true || ev.error.failureCode === 'runtime_exited') &&
        s.lastError !== null;
      logger.step(`error: ${ev.error.message} (retryable=${ev.error.retryable})`);
      if (isTrailingExit) break;
      s.lastError = ev.error.message;
      s.lastModelError = ev.error.message;
      s.lastErrorWasProcessCrash = ev.error.processCrash === true;
      if (
        ev.error.failureCode !== undefined &&
        (s.failureCode === null ||
          (s.failureCode === 'runtime_exited' && ev.error.failureCode !== 'runtime_exited'))
      ) {
        s.failureCode = ev.error.failureCode;
        s.failureDetail = ev.error.failureDetail ?? null;
      }
      {
        const failureKind = s.lastErrorWasProcessCrash
          ? 'other'
          : classifyAgentFailure(ev.error.message);
        if (!s.lastErrorWasProcessCrash && failureEndsStepNow(ev.error.message)) {
          if (ev.error.message.includes('Cairn host tools did not attach')) {
            activity.setPhase('tool', {
              stallSignal: 'missing_tools',
              detail: ev.error.message.slice(0, 400),
            });
          }
          logger.step(
            `${classifyStepFailure(ev.error.message)}: ${modelKey} — stopping session without retry`,
          );
          await handle.stop();
        } else if (failureKind === 'quota' || failureKind === 'capacity') {
          if (s.quotaTrip === null) {
            s.quotaTrip = {
              kind: failureKind,
              reason: ev.error.message,
              retryAfterMs: parseRetryAfterMs(ev.error.message),
            };
            logger.step(
              `quota circuit breaker: ${failureKind} on ${provider?.providerId ?? 'unknown'} — stopping session (no auto-retry spin)`,
            );
          }
          void handle.stop();
        }
        if (promptImages !== undefined && noVisionSignalOf(ev.error.message)) {
          logger.step(
            `image capability rejected by ${modelKey} — stopping session (no auto-retry spin)`,
          );
          void handle.stop();
        }
      }
      break;
    }
    case 'usage':
      activity.noteUsage(ev.usage);
      break;
    case 'bg_task': {
      const ok = await withRetries(
        async () => client.backgroundTask?.(stepId, ev.task),
        REMOTE_TOOL_RETRY_DELAYS_MS,
        logger,
        `background task relay ${ev.task.taskId}`,
      );
      if (ok === null) logger.step(`background task relay failed for ${ev.task.taskId}`);
      break;
    }
    case 'auto_retry_start': {
      const retryError = s.lastModelError ?? s.lastError ?? '';
      const retryKind = retryError !== '' ? classifyAgentFailure(retryError) : null;
      const retrySignal = retryKind === 'quota' || retryKind === 'capacity' ? retryKind : undefined;
      s.lastError = null;
      s.failureCode = null;
      s.failureDetail = null;
      s.zeroProgressRetries += 1;
      if (s.zeroProgressRetries > retryStormMax) {
        s.retryStorm = true;
        logger.step(
          `retry storm: ${s.zeroProgressRetries} consecutive zero-progress auto-retries (max ${retryStormMax}) — stopping session`,
        );
        void handle.stop();
      }
      logger.step(`auto_retry_start attempt=${ev.attempt}`);
      stream.discardAttempt();
      activity.setPhase('retrying', {
        attempt: ev.attempt,
        resetLive: true,
        ...(retrySignal !== undefined
          ? { stallSignal: retrySignal, detail: retryError.slice(0, 400) }
          : {}),
      });
      break;
    }
    case 'auto_retry_end':
      activity.setPhase('awaiting_model');
      break;
    case 'compaction_start':
      logger.step('compaction_start');
      activity.setPhase('compacting');
      break;
    case 'compaction_end':
      activity.setPhase('awaiting_model');
      break;
    case 'done':
      s.sawDone = true;
      s.usage = ev.usage;
      break;
    default:
      break;
  }
}
