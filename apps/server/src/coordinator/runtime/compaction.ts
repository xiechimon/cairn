import {
  COORDINATOR_MEMORY_FLUSH_TRANSCRIPT_MAX_CHARS,
  COORDINATOR_SUMMARY_MAX_CHARS,
  COORDINATOR_SUMMARY_PROMPT_HEAD,
  COORDINATOR_SUMMARY_TRANSCRIPT_MAX_CHARS,
  shortEvent,
} from '@cairn/shared';
import type { Message } from '@earendil-works/pi-ai';
import type { Models } from '@earendil-works/pi-ai/models';
import {
  type CompactionSettings,
  CompactionTask,
  defineExtension,
  hook,
} from '@earendil-works/pi-durable';
import { reportCompactionFailure } from './failure-report.js';

export const BACKGROUND_COMPACTION_AT = 150_000;
export const COMPACTION_RESERVE_TOKENS = 16_384;
export const KEEP_RECENT_TOKENS = 8_000;
const TOOL_ARGS_CHARS = 200;
const SUMMARY_MEMO = 'cairn-c2-summary';
const FLUSH_MEMO = 'cairn-c4-memory-flush';
const SUMMARY_SYSTEM_PROMPT = "You are Cairn's Coordinator summarization step.";

export interface ModelRef {
  provider: string;
  modelId: string;
}

export type Summarize = (prompt: string) => Promise<string>;

export interface MemoryFlush {
  run(transcript: string, summarize: Summarize): Promise<void>;
}

export interface CompactionWindow {
  blockingAt: number;
  backgroundAt: number;
}

export function compactionWindow(contextWindow: number): CompactionWindow {
  const blockingAt = contextWindow - COMPACTION_RESERVE_TOKENS;
  return {
    blockingAt,
    backgroundAt: Math.min(BACKGROUND_COMPACTION_AT, Math.floor(blockingAt / 2)),
  };
}

export function coordinatorCompactionSettings(
  models: readonly { provider: string; id: string; contextWindow: number }[],
): CompactionSettings {
  const modelOverrides: Record<string, { backgroundTokens: number }> = {};
  for (const model of models) {
    const { blockingAt, backgroundAt } = compactionWindow(model.contextWindow);
    modelOverrides[`${model.provider}/${model.id}`] = {
      backgroundTokens: blockingAt - backgroundAt,
    };
  }
  return {
    enabled: true,
    reserveTokens: COMPACTION_RESERVE_TOKENS,
    keepRecentTokens: KEEP_RECENT_TOKENS,
    modelOverrides,
  };
}

function textOf(content: Message['content']): string {
  if (typeof content === 'string') return content;
  return content
    .flatMap((block) => (block.type === 'text' ? [block.text] : []))
    .join('\n')
    .trim();
}

export function splitPreviousSummary(messages: readonly Message[]): {
  previous: string | null;
  rest: readonly Message[];
} {
  const first = messages[0];
  if (first?.role !== 'user') return { previous: null, rest: messages };
  const match = /<summary>\n([\s\S]*)\n<\/summary>/.exec(textOf(first.content));
  return match?.[1] === undefined
    ? { previous: null, rest: messages }
    : { previous: match[1], rest: messages.slice(1) };
}

export function transcriptLines(messages: readonly Message[]): string[] {
  const lines: string[] = [];
  for (const message of messages) {
    if (message.role === 'user') {
      const text = textOf(message.content);
      const event = shortEvent(text);
      if (event !== null) lines.push(`事件：${event}`);
      else if (text !== '') lines.push(`用户：${text}`);
    } else if (message.role === 'assistant') {
      const text = textOf(message.content);
      if (text !== '') lines.push(`总管：${text}`);
      for (const block of message.content) {
        if (block.type === 'toolCall') {
          lines.push(
            `总管调用工具 ${block.name} ${JSON.stringify(block.arguments).slice(0, TOOL_ARGS_CHARS)}`,
          );
        }
      }
    }
  }
  return lines;
}

export function flushTranscript(
  lines: readonly string[],
  maxChars = COORDINATOR_MEMORY_FLUSH_TRANSCRIPT_MAX_CHARS,
): string {
  const kept: string[] = [];
  let used = 0;
  for (const line of [...lines].reverse()) {
    const text = line.length > maxChars ? line.slice(0, maxChars) : line;
    if (kept.length > 0 && used + text.length + 1 > maxChars) break;
    kept.unshift(text);
    used += text.length + 1;
  }
  return kept.join('\n');
}

export function summaryBatches(
  lines: readonly string[],
  maxChars = COORDINATOR_SUMMARY_TRANSCRIPT_MAX_CHARS,
): string[] {
  const batches: string[] = [];
  let current: string[] = [];
  let used = 0;
  for (const line of lines) {
    const kept = line.length > maxChars ? `${line.slice(0, maxChars)} (cut for length)` : line;
    if (current.length > 0 && used + kept.length + 1 > maxChars) {
      batches.push(current.join('\n'));
      current = [];
      used = 0;
    }
    current.push(kept);
    used += kept.length + 1;
  }
  if (current.length > 0) batches.push(current.join('\n'));
  return batches;
}

export function summaryPrompt(previous: string | null, batch: string): string {
  return `${COORDINATOR_SUMMARY_PROMPT_HEAD}\n\nEarlier summary:\n${previous ?? '(none yet)'}\n\nNew messages:\n${batch}`;
}

export async function foldSummary(
  previous: string | null,
  batches: readonly string[],
  summarize: (prompt: string) => Promise<string>,
): Promise<string> {
  let summary = previous;
  for (const batch of batches) {
    const out = (await summarize(summaryPrompt(summary, batch))).trim();
    summary = out.slice(0, COORDINATOR_SUMMARY_MAX_CHARS);
  }
  return summary ?? '';
}

export function summarizerFor(
  models: Pick<Models, 'getModel' | 'completeSimple'>,
  ref: ModelRef | null,
): Summarize {
  const model = ref === null ? undefined : models.getModel(ref.provider, ref.modelId);
  if (model === undefined) {
    throw new Error(`summary model ${ref?.provider}/${ref?.modelId} is not available`);
  }
  return async (prompt) => {
    const reply = await models.completeSimple(
      model,
      {
        systemPrompt: SUMMARY_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: prompt, timestamp: Date.now() }],
      },
      { reasoning: 'low' },
    );
    if (reply.stopReason !== 'stop') {
      throw new Error(`summary request ended ${reply.stopReason}: ${reply.errorMessage ?? ''}`);
    }
    return textOf(reply.content);
  };
}

export function coordinatorCompactionExtension(
  summaryModel: () => ModelRef | null,
  flush: () => MemoryFlush | null = () => null,
  threadId?: string,
) {
  const scope = threadId === undefined ? {} : { threadId };
  return defineExtension({
    name: 'cairn-coordinator-compaction',
    hooks: [
      hook(CompactionTask, {
        beforeCompact: async (compaction, api, context) => {
          try {
            const cached = await api.memo<string>(SUMMARY_MEMO, context);
            if (cached !== undefined) return { summary: cached };
            const summarize = summarizerFor(api.models, summaryModel());
            const { previous, rest } = splitPreviousSummary(compaction.messages);
            const lines = transcriptLines(rest);
            const flusher = flush();
            if (flusher !== null && (await api.memo<boolean>(FLUSH_MEMO, context)) === undefined) {
              try {
                await flusher.run(flushTranscript(lines), summarize);
              } catch (error) {
                reportCompactionFailure(scope, 'memory-flush', error);
              }
              await api.memo(FLUSH_MEMO, true, context);
            }
            const summary = await foldSummary(previous, summaryBatches(lines), summarize);
            return { summary: await api.memo(SUMMARY_MEMO, summary, context) };
          } catch (error) {
            reportCompactionFailure(scope, 'summary-fold', error);
            throw error;
          }
        },
      }),
    ],
  });
}
