import { createHash } from 'node:crypto';
import {
  CHIEF_REMOTE_TOOLS,
  CHIEF_ROUTER_TOOLS,
  type MachineAskBody,
  type RemoteToolDef,
} from '@cairn/shared';
import { defineExtension, defineTool, type ToolRegistration } from '@earendil-works/pi-durable';
import type { MachineApi } from '../machine-api.js';

export const COORDINATOR_TOOL_OUTPUT_MAX_BYTES = 32_768;

export type ToolChannel = Pick<MachineApi, 'relayTool' | 'askUser'>;

export function askRequestId(stepId: string, callId: string): string {
  return `ask-${createHash('sha256').update(`${stepId}\0${callId}`).digest('hex').slice(0, 32)}`;
}

async function askThroughChannel(
  channel: ToolChannel,
  stepId: string,
  callId: string,
  args: Record<string, unknown>,
  signal: AbortSignal | undefined,
): Promise<string> {
  const requestId = askRequestId(stepId, callId);
  try {
    const body: MachineAskBody = {
      requestId,
      questions: (args.questions ?? []) as MachineAskBody['questions'],
      ...(typeof args.provenance === 'string'
        ? { provenance: args.provenance as MachineAskBody['provenance'] }
        : {}),
    };
    return JSON.stringify(await channel.askUser(stepId, body, signal));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return JSON.stringify({
      status: 'cancelled',
      requestId,
      answers: null,
      reason: `ask channel aborted: ${message}`,
    });
  }
}

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
  channel: ToolChannel,
  gate: StepGate,
): ToolRegistration {
  return defineTool({
    name: def.name,
    description: def.description,
    parameters: (def.parameters ?? EMPTY_PARAMETERS) as object,
    replay: def.replaySafe === true ? 'safe' : 'unsafe',
    outputLimits: { maxBytes: COORDINATOR_TOOL_OUTPUT_MAX_BYTES, retain: 'head' },
    execute: async (args, api, context) => {
      const stepId = await gate.current();
      const params = args as Record<string, unknown>;
      if (def.name === 'ask_user') {
        const text = await askThroughChannel(
          channel,
          stepId,
          api.callId,
          params,
          context.abortSignal,
        );
        return { output: [{ type: 'text', text }] };
      }
      try {
        const text = await channel.relayTool(stepId, def.name, params);
        return { output: [{ type: 'text', text }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { output: [{ type: 'text', text: message }], isError: true };
      }
    },
  });
}

export function coordinatorToolsExtension(
  channel: ToolChannel,
  gate: StepGate,
  options: { routerTools?: boolean } = {},
) {
  const defs =
    options.routerTools === true
      ? [...CHIEF_REMOTE_TOOLS, ...CHIEF_ROUTER_TOOLS]
      : CHIEF_REMOTE_TOOLS;
  return defineExtension({
    name: 'cairn-coordinator-tools',
    tools: defs.map((def) => coordinatorTool(def, channel, gate)),
  });
}
