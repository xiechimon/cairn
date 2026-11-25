import {
  type AgentBackend,
  buildSubagentUserPrompt,
  clampSubagentMaxTurns,
  clampSubagentTimeoutSec,
  resolveSubagentAllowedTools,
  type SessionOpts,
  SUBAGENT_CHILD_STEPS_MAX,
  SUBAGENT_MAX_CONCURRENT,
  SUBAGENT_MAX_PER_TURN,
  SUBAGENT_SYSTEM_PROMPT,
  type SubagentChildStep,
  type SubagentToolResult,
  type SubagentUsage,
  sanitizeSubagentSummary,
  subagentLabelOf,
  subagentToolInputSchema,
} from '@cairn/shared';

export interface DaemonSubagentExecutorOptions {
  backend: AgentBackend;
  parentSessionOpts: SessionOpts;
  parentSignal: AbortSignal;
  untrustedTurn: boolean;
  readOnlyConnectorNames?: ReadonlySet<string>;
  scrubError?: (message: string) => string;
  now?: () => number;
  minTimeoutMs?: number;
}

export function createDaemonSubagentExecutor(
  options: DaemonSubagentExecutorOptions,
): (params: Record<string, unknown>) => Promise<string> {
  const now = options.now ?? Date.now;
  let active = 0;
  let total = 0;
  const waiters: Array<() => void> = [];

  const acquire = async (): Promise<() => void> => {
    if (total >= SUBAGENT_MAX_PER_TURN) {
      throw new Error(`max subagents per turn (${SUBAGENT_MAX_PER_TURN}) reached`);
    }
    total += 1;
    if (active < SUBAGENT_MAX_CONCURRENT) {
      active += 1;
    } else {
      await new Promise<void>((resolve) => waiters.push(resolve));
    }
    return () => {
      const next = waiters.shift();
      if (next !== undefined) next();
      else active = Math.max(0, active - 1);
    };
  };

  return async (params: Record<string, unknown>): Promise<string> => {
    const startedAt = now();
    const modelLabel = `${options.parentSessionOpts.provider.providerId}/${options.parentSessionOpts.modelId}`;
    const runtime = options.backend.capabilities.name;
    const parsed = subagentToolInputSchema.safeParse(params);
    if (!parsed.success) {
      const invalid: SubagentToolResult = {
        status: 'failed',
        summary: '',
        error: `Invalid subagent arguments: ${parsed.error.message}`,
        childId: '',
        runtime,
        model: modelLabel,
        toolCalls: 0,
        durationMs: Math.max(0, now() - startedAt),
        usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      };
      return JSON.stringify(invalid);
    }

    const input = parsed.data;
    const label = subagentLabelOf(input);
    const timeoutSec = clampSubagentTimeoutSec(input.timeoutSec);
    const timeoutMs =
      options.minTimeoutMs !== undefined && input.timeoutSec !== undefined && input.timeoutSec < 10
        ? options.minTimeoutMs
        : timeoutSec * 1000;
    const maxTurns = clampSubagentMaxTurns(input.maxTurns);

    let release: (() => void) | null = null;
    try {
      release = await acquire();
    } catch (error) {
      const rejected: SubagentToolResult = {
        status: 'failed',
        summary: '',
        error: error instanceof Error ? error.message : String(error),
        childId: '',
        runtime,
        model: modelLabel,
        toolCalls: 0,
        durationMs: Math.max(0, now() - startedAt),
        usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
        label,
        mode: 'fresh',
      };
      return JSON.stringify(rejected);
    }

    let childId = '';
    let timedOut = false;
    let maxTurnsHit = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const textChunks: string[] = [];
    const childSteps: SubagentChildStep[] = [];
    let toolCalls = 0;
    let assistantTurns = 0;

    try {
      const parentRemote = options.parentSessionOpts.remoteTools ?? [];
      const allowedNames = new Set(
        resolveSubagentAllowedTools(
          input.tools,
          parentRemote.map((def) => def.name),
          {
            readOnlyConnectors: options.readOnlyConnectorNames,
            untrustedTurn: options.untrustedTurn,
          },
        ),
      );
      const childRemoteTools = parentRemote
        .filter((def) => allowedNames.has(def.name))
        .map((def) => ({ ...def, deferred: false }));
      const parentExec = options.parentSessionOpts.executeRemoteTool;
      const childOpts: SessionOpts = {
        provider: options.parentSessionOpts.provider,
        modelId: options.parentSessionOpts.modelId,
        ...(options.parentSessionOpts.thinkingLevel !== undefined
          ? { thinkingLevel: options.parentSessionOpts.thinkingLevel }
          : {}),
        cwd: options.parentSessionOpts.cwd,
        systemPrompt: SUBAGENT_SYSTEM_PROMPT,
        prompt: buildSubagentUserPrompt(input.task, input.context),
        lockedDown: true,
        readOnly: true,
        ...(options.parentSessionOpts.remoteToolsOnly === true ? { remoteToolsOnly: true } : {}),
        ...(options.parentSessionOpts.env !== undefined
          ? { env: options.parentSessionOpts.env }
          : {}),
        ...(options.parentSessionOpts.secrets !== undefined
          ? { secrets: options.parentSessionOpts.secrets }
          : {}),
        remoteTools: childRemoteTools,
        ...(parentExec !== undefined
          ? {
              executeRemoteTool: async (name, toolParams) => {
                if (!allowedNames.has(name)) {
                  throw new Error(`Sub-agent is not allowed to call tool '${name}'`);
                }
                return parentExec(name, toolParams);
              },
            }
          : {}),
      };

      const handle = await options.backend.createSession(childOpts);
      childId = handle.sessionId;

      const onParentAbort = () => {
        void handle.stop().catch(() => undefined);
      };
      if (options.parentSignal.aborted) {
        await handle.stop().catch(() => undefined);
      } else {
        options.parentSignal.addEventListener('abort', onParentAbort, { once: true });
      }
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        void handle.stop().catch(() => undefined);
      }, timeoutMs);

      try {
        for await (const event of handle.events) {
          if (event.type === 'text_delta') {
            textChunks.push(event.text);
          } else if (event.type === 'toolcall_end') {
            toolCalls += 1;
            if (childSteps.length < SUBAGENT_CHILD_STEPS_MAX) {
              const durationMs =
                event.call.startedAt !== undefined &&
                event.call.endedAt !== undefined &&
                event.call.endedAt >= event.call.startedAt
                  ? event.call.endedAt - event.call.startedAt
                  : undefined;
              childSteps.push({
                name: event.call.name.replace(/^mcp__cairn__/, ''),
                ...(event.call.isError === true ? { isError: true } : {}),
                ...(durationMs !== undefined ? { durationMs } : {}),
              });
            }
          } else if (event.type === 'message_end') {
            assistantTurns += 1;
            if (assistantTurns >= maxTurns) {
              maxTurnsHit = true;
              await handle.stop().catch(() => undefined);
              break;
            }
          }
        }
      } finally {
        options.parentSignal.removeEventListener('abort', onParentAbort);
      }

      const usageRows = handle.usage();
      const usage: SubagentUsage = {
        inputTokens: usageRows.reduce((sum, row) => sum + row.input, 0),
        outputTokens: usageRows.reduce((sum, row) => sum + row.output, 0),
        cacheReadTokens: usageRows.reduce((sum, row) => sum + row.cacheRead, 0),
        cacheWriteTokens: usageRows.reduce((sum, row) => sum + row.cacheWrite, 0),
      };
      const rawText = textChunks.join('').trim();
      const status: SubagentToolResult['status'] = timedOut
        ? 'timed_out'
        : options.parentSignal.aborted
          ? 'aborted'
          : 'completed';
      const partial = timedOut || maxTurnsHit;
      const sanitized = sanitizeSubagentSummary(
        rawText || (partial ? 'No partial findings were captured before stopping.' : ''),
        childId,
      );
      const result: SubagentToolResult = {
        status,
        summary: sanitized.summary,
        ...(partial ? { partial: true } : {}),
        childId,
        runtime,
        model: modelLabel,
        toolCalls,
        durationMs: Math.max(0, now() - startedAt),
        usage,
        ...(childSteps.length > 0 ? { childSteps } : {}),
        label,
        mode: 'fresh',
      };
      return JSON.stringify(result);
    } catch (error) {
      const rawErr = error instanceof Error ? error.message : String(error);
      const scrubbed = options.scrubError ? options.scrubError(rawErr) : rawErr;
      const failed: SubagentToolResult = {
        status: options.parentSignal.aborted ? 'aborted' : 'failed',
        summary: '',
        error: scrubbed,
        childId,
        runtime,
        model: modelLabel,
        toolCalls,
        durationMs: Math.max(0, now() - startedAt),
        usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
        label,
        mode: 'fresh',
      };
      return JSON.stringify(failed);
    } finally {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
      release?.();
    }
  };
}
