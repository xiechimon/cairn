import { isDeepStrictEqual } from 'node:util';
import type { AgentBackend, AgentSessionHandle, SessionOpts, StepEvent } from '@cairn/shared';
import { afterEach } from 'vitest';

const pendingScripts = new Set<() => void>();
afterEach(() => {
  const checks = [...pendingScripts];
  pendingScripts.clear();
  for (const check of checks) check();
});

export interface ModelStep {
  name: string;
  tool: string;
  arguments: Record<string, unknown>;
  response: string;
}

export function scriptedModel(script: readonly ModelStep[]) {
  const steps = structuredClone(script);
  let consumed = 0;
  let unexpected: Error | undefined;
  const assertConsumed = () => {
    if (unexpected !== undefined) throw unexpected;
    const pending = steps.slice(consumed);
    if (pending.length > 0) {
      throw new Error(`Unconsumed model steps: ${pending.map((step) => step.name).join(', ')}`);
    }
  };
  pendingScripts.add(assertConsumed);
  const callTool = (tool: string, args: Record<string, unknown>): string => {
    const step = steps[consumed];
    if (step === undefined || tool !== step.tool || !isDeepStrictEqual(args, step.arguments)) {
      unexpected ??= new Error(
        `Unexpected tool call ${tool}; expected ${step?.name ?? 'end of script'}`,
      );
      throw unexpected;
    }
    consumed += 1;
    return step.response;
  };
  const session = async (id: string, opts: SessionOpts): Promise<AgentSessionHandle> => {
    let stopped = false;
    return {
      sessionId: id,
      events: (async function* (): AsyncGenerator<StepEvent> {
        while (consumed < steps.length && !stopped) {
          const step = steps[consumed];
          if (step === undefined) break;
          const local = opts.localTools?.find((tool) => tool.name === step.tool);
          const response =
            local === undefined
              ? await opts.executeRemoteTool?.(step.tool, step.arguments)
              : await local.execute(step.arguments);
          if (response !== step.response)
            throw new Error(`Model step ${step.name}: unexpected response`);
          const result = callTool(step.tool, step.arguments);
          yield {
            type: 'toolcall_end',
            call: { id: `script-${consumed}`, name: step.tool, arguments: step.arguments, result },
          };
        }
        assertConsumed();
        yield { type: 'done', usage: [] };
      })(),
      steer: async () => {
        throw new Error('Unexpected steer in scripted model');
      },
      stop: async () => {
        stopped = true;
      },
      usage: () => [],
    };
  };
  const backend: AgentBackend = {
    capabilities: {
      name: 'scripted-model',
      thinkingLevels: [],
      oauthProviders: [],
      compaction: false,
      sessionResume: true,
    },
    createSession: (opts) => session('scripted-session', opts),
    continueSession: session,
  };
  return { backend, callTool, assertConsumed };
}
