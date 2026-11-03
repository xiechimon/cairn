import { CHIEF_REMOTE_TOOLS, type RemoteToolDef } from '@cairn/shared';
import { defineExtension, defineTool, type ToolRegistration } from '@earendil-works/pi-durable';

export const COORDINATOR_TOOL_OUTPUT_MAX_BYTES = 32_768;

export type ToolRelay = (
  stepId: string,
  name: string,
  params: Record<string, unknown>,
) => Promise<string>;

export interface StepGate {
  current(): Promise<string>;
  set(stepId: string | null): void;
}

export function createStepGate(): StepGate {
  let stepId: string | null = null;
  let waiters: ((id: string) => void)[] = [];
  return {
    current: () =>
      stepId !== null ? Promise.resolve(stepId) : new Promise((resolve) => waiters.push(resolve)),
    set: (next) => {
      stepId = next;
      if (next === null) return;
      const ready = waiters;
      waiters = [];
      for (const resolve of ready) resolve(next);
    },
  };
}

const EMPTY_PARAMETERS = { type: 'object', properties: {} };

export function coordinatorTool(
  def: RemoteToolDef,
  relay: ToolRelay,
  gate: StepGate,
): ToolRegistration {
  return defineTool({
    name: def.name,
    description: def.description,
    parameters: (def.parameters ?? EMPTY_PARAMETERS) as object,
    replay: def.replaySafe === true ? 'safe' : 'unsafe',
    outputLimits: { maxBytes: COORDINATOR_TOOL_OUTPUT_MAX_BYTES, retain: 'head' },
    execute: async (args) => {
      const stepId = await gate.current();
      try {
        const text = await relay(stepId, def.name, args as Record<string, unknown>);
        return { output: [{ type: 'text', text }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { output: [{ type: 'text', text: message }], isError: true };
      }
    },
  });
}

export function coordinatorToolsExtension(relay: ToolRelay, gate: StepGate) {
  return defineExtension({
    name: 'cairn-coordinator-tools',
    tools: CHIEF_REMOTE_TOOLS.map((def) => coordinatorTool(def, relay, gate)),
  });
}
