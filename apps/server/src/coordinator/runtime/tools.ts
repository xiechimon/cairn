import { createHash } from 'node:crypto';
import {
  CHIEF_REMOTE_TOOLS,
  CHIEF_ROUTER_TOOLS,
  COMPUTER_REMOTE_TOOLS,
  coordinatorToolSourceId,
  type MachineAskBody,
  type RemoteToolDef,
  SLICE1_ACTIONS,
} from '@cairn/shared';
import {
  defineExtension,
  defineTool,
  GenerationTask,
  hook,
  type ToolRegistration,
} from '@earendil-works/pi-durable';
import { boundCoordinatorImages, prepareCoordinatorImage } from './images.js';
import type { MachineApi } from './machine-api.js';

export class ShutdownInterrupt extends Error {
  constructor() {
    super('Coordinator is shutting down');
    this.name = 'ShutdownInterrupt';
  }
}

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
  shuttingDown: () => boolean,
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
    const settled = await channel.askUser(stepId, body, signal);
    if (shuttingDown()) throw new ShutdownInterrupt();
    return JSON.stringify(settled);
  } catch (error) {
    if (shuttingDown()) throw new ShutdownInterrupt();
    const message = error instanceof Error ? error.message : String(error);
    return JSON.stringify({
      status: 'cancelled',
      requestId,
      answers: null,
      reason: `ask channel aborted: ${message}`,
    });
  }
}

export interface StepResolver {
  stepFor(conversationId: string): Promise<string>;
}

export interface StepGate extends StepResolver {
  current(): Promise<string>;
  set(stepId: string | null): void;
}

export interface ConversationGate extends StepResolver {
  set(conversationId: string, stepId: string | null): void;
}

export function createConversationGate(): ConversationGate {
  const steps = new Map<string, string>();
  return {
    stepFor: async (conversationId) => {
      const stepId = steps.get(conversationId);
      if (stepId === undefined) {
        throw new Error(
          `Coordinator tool call for conversation ${conversationId} has no live step`,
        );
      }
      return stepId;
    },
    set: (conversationId, stepId) => {
      if (stepId === null) steps.delete(conversationId);
      else steps.set(conversationId, stepId);
    },
  };
}

export function createStepGate(): StepGate {
  let stepId: string | null = null;
  let waiters: ((id: string) => void)[] = [];
  const current = () =>
    stepId !== null
      ? Promise.resolve(stepId)
      : new Promise<string>((resolve) => waiters.push(resolve));
  return {
    current,
    stepFor: current,
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
  gate: StepResolver,
  shuttingDown: () => boolean = () => false,
  beforeTool?: (signal?: AbortSignal, conversationId?: string) => Promise<void>,
  storeId?: () => string | undefined,
): ToolRegistration {
  return defineTool({
    name: def.name,
    description: def.description,
    parameters: (def.parameters ?? EMPTY_PARAMETERS) as object,
    replay: def.replaySafe === true || def.name === 'ask_user' ? 'safe' : 'unsafe',
    outputLimits: { maxBytes: COORDINATOR_TOOL_OUTPUT_MAX_BYTES, retain: 'head' },
    execute: async (args, api, context) => {
      const stepId = await gate.stepFor(String(api.conversationId));
      await beforeTool?.(context.abortSignal, String(api.conversationId));
      const store = storeId?.();
      const callId = store === undefined ? api.callId : coordinatorToolSourceId(store, api.callId);
      const params = args as Record<string, unknown>;
      if (def.name === 'ask_user') {
        const text = await askThroughChannel(
          channel,
          stepId,
          callId,
          params,
          context.abortSignal,
          shuttingDown,
        );
        return { output: [{ type: 'text', text }] };
      }
      try {
        const text = await channel.relayTool(stepId, def.name, params, callId, context.abortSignal);
        if (def.name === 'attachment') {
          const attachment = JSON.parse(text) as {
            mimeType: string;
            encoding: string;
            content: string;
          };
          if (attachment.mimeType.startsWith('image/') && attachment.encoding === 'base64') {
            return {
              output: [await prepareCoordinatorImage(attachment.content, attachment.mimeType)],
            };
          }
        }
        return { output: [{ type: 'text', text }] };
      } catch (error) {
        if (error instanceof ShutdownInterrupt) throw error;
        const message = error instanceof Error ? error.message : String(error);
        return { output: [{ type: 'text', text: message }], isError: true };
      }
    },
  });
}

export function coordinatorToolsExtension(
  channel: ToolChannel,
  gate: StepResolver,
  options: {
    routerTools?: boolean;
    shuttingDown?: () => boolean;
    beforeTool?: (signal?: AbortSignal, conversationId?: string) => Promise<void>;
    storeId?: () => string | undefined;
  } = {},
) {
  const actionCopy: Record<string, string> = {
    archive_project: 'Archive a project. It stays readable and can be unarchived.',
    unarchive_project: 'Unarchive a project so it can be changed again.',
    delete_project: 'Propose deleting a project. The owner confirms before the project is deleted.',
  };
  const actionTools: RemoteToolDef[] = SLICE1_ACTIONS.filter((entry) =>
    entry.surfaces.includes('coordinator'),
  ).map((entry) => {
    const description = actionCopy[entry.toolName];
    if (description === undefined) throw new Error(`no Coordinator copy for ${entry.toolName}`);
    return {
      name: entry.toolName,
      description,
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'Project id' },
        },
        required: ['projectId'],
      },
    };
  });
  const defs =
    options.routerTools === false
      ? [...CHIEF_REMOTE_TOOLS, ...COMPUTER_REMOTE_TOOLS, ...actionTools]
      : [...CHIEF_REMOTE_TOOLS, ...CHIEF_ROUTER_TOOLS, ...COMPUTER_REMOTE_TOOLS, ...actionTools];
  return defineExtension({
    name: 'cairn-coordinator-tools',
    hooks: [
      hook(GenerationTask, {
        beforeRequest: async ({ messages }, _api, context) => {
          await options.beforeTool?.(context.abortSignal, String(_api.conversationId));
          return { messages: boundCoordinatorImages(messages) };
        },
      }),
    ],
    tools: defs.map((def) =>
      coordinatorTool(
        def,
        channel,
        gate,
        options.shuttingDown,
        options.beforeTool,
        options.storeId,
      ),
    ),
  });
}
