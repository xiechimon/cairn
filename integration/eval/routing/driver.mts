import { mkdirSync } from 'node:fs';
import type { AgentSessionHandle, ProviderConfig } from '@cairn/shared';
import { createPiBackend } from '../../../apps/daemon/src/backend/pi.js';
import type { TokenCounts, ToolCallEvidence } from './grade.mts';

export interface BenchEndpoint {
  baseUrl: string;
  apiKey: string;
}

export interface BenchSessionEvidence {
  text: string;
  toolCalls: ToolCallEvidence[];
  usage: TokenCounts;
  wallMs: number;
  stopReason: 'done' | 'error' | 'timeout';
  error?: string;
}

const BENCH_PROVIDER_ID = 'cairn-bench';
const HARD_STOP_GRACE_MS = 30_000;

function textBlocksOf(content: unknown): string[] {
  const blocks = Array.isArray(content) ? content : [content];
  const parts: string[] = [];
  for (const block of blocks) {
    if (block === null || typeof block !== 'object') continue;
    const b = block as { type?: string; text?: unknown };
    if (b.type === 'text' && typeof b.text === 'string') parts.push(b.text);
  }
  return parts;
}

function sumUsage(
  entries: readonly { input?: number; output?: number; cacheRead?: number; cacheWrite?: number }[],
): TokenCounts {
  const total: TokenCounts = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  for (const entry of entries) {
    total.input += entry.input ?? 0;
    total.output += entry.output ?? 0;
    total.cacheRead += entry.cacheRead ?? 0;
    total.cacheWrite += entry.cacheWrite ?? 0;
  }
  return total;
}

export async function runBenchSession(opts: {
  endpoint: BenchEndpoint;
  modelId: string;
  models: readonly string[];
  prompt: string;
  workdir: string;
  agentDir: string;
  sessionDir: string;
  thinkingLevel?: string;
  timeoutMs: number;
}): Promise<BenchSessionEvidence> {
  mkdirSync(opts.agentDir, { recursive: true });
  mkdirSync(opts.sessionDir, { recursive: true });
  const provider: ProviderConfig = {
    kind: 'api_key',
    providerId: BENCH_PROVIDER_ID,
    baseUrl: opts.endpoint.baseUrl,
    api: 'openai-completions',
    authHeader: true,
    compat: { supportsDeveloperRole: false },
    models: opts.models.map((id) => ({ id, name: id })),
    apiKey: opts.endpoint.apiKey,
  };
  const backend = createPiBackend({ agentDir: opts.agentDir, sessionDir: opts.sessionDir });
  const handle: AgentSessionHandle = await backend.createSession({
    cwd: opts.workdir,
    provider,
    modelId: opts.modelId,
    prompt: opts.prompt,
    ...(opts.thinkingLevel !== undefined ? { thinkingLevel: opts.thinkingLevel } : {}),
  });

  const startedAt = Date.now();
  const toolCalls: ToolCallEvidence[] = [];
  const seenCallIds = new Set<string>();
  const textParts: string[] = [];
  let sawDone = false;
  let lastError: string | undefined;
  let timedOut = false;

  const consume = async (): Promise<void> => {
    for await (const ev of handle.events) {
      if (ev.type === 'toolcall_end') {
        if (!seenCallIds.has(ev.call.id)) {
          seenCallIds.add(ev.call.id);
          toolCalls.push({ name: ev.call.name, arguments: ev.call.arguments });
        }
      } else if (ev.type === 'message_end') {
        if (ev.message.role === 'assistant') textParts.push(...textBlocksOf(ev.message.content));
      } else if (ev.type === 'done') {
        sawDone = true;
      } else if (ev.type === 'error') {
        lastError = ev.error.message;
      }
    }
  };

  let stopTimer: NodeJS.Timeout | undefined;
  try {
    stopTimer = setTimeout(() => {
      timedOut = true;
      void handle.stop();
    }, opts.timeoutMs);
    const hardDeadline = new Promise<never>((_, reject) => {
      const timer = setTimeout(
        () => reject(new Error('bench session did not end after stop')),
        opts.timeoutMs + HARD_STOP_GRACE_MS,
      );
      timer.unref();
    });
    hardDeadline.catch(() => {});
    await Promise.race([consume(), hardDeadline]);
  } finally {
    if (stopTimer !== undefined) clearTimeout(stopTimer);
  }

  const usage = sumUsage(handle.usage());
  const stopReason: BenchSessionEvidence['stopReason'] = sawDone
    ? 'done'
    : timedOut
      ? 'timeout'
      : 'error';
  return {
    text: textParts.join('\n').trim(),
    toolCalls,
    usage,
    wallMs: Date.now() - startedAt,
    stopReason,
    ...(lastError !== undefined ? { error: lastError } : {}),
  };
}
