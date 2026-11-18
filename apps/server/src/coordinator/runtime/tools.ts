import { createHash } from 'node:crypto';
import {
  COMPUTER_DESKTOP_TOOLS,
  coordinatorToolSourceId,
  type MachineAskBody,
  type RemoteToolDef,
} from '@cairn/shared';
import {
  defineExtension,
  defineTool,
  GenerationTask,
  hook,
  type ToolRegistration,
} from '@earendil-works/pi-durable';
import { coordinatorToolDefs } from '../../services/coordinator-tool-defs.js';
import { createCutOffRecovery } from './cut-off-recovery.js';
import { attachmentImageText, type OcrRunner } from './image-text.js';
import { boundCoordinatorImages, prepareCoordinatorImage } from './images.js';
import type { MachineApi } from './machine-api.js';

export class ShutdownInterrupt extends Error {
  constructor() {
    super('Coordinator is shutting down');
    this.name = 'ShutdownInterrupt';
  }
}

export const COORDINATOR_CUT_OFF_MESSAGE =
  'Your last output was cut off at the length limit, so its tool call never ran. Retry with a shorter output, or split the work into smaller steps.';

export const COORDINATOR_TOOL_OUTPUT_MAX_BYTES = 32_768;

export type ToolChannel = Pick<MachineApi, 'relayTool' | 'relayComputer' | 'askUser'>;

const DESKTOP_TOOL_NAMES: ReadonlySet<string> = new Set(
  COMPUTER_DESKTOP_TOOLS.map((def) => def.name),
);

export const SCREENSHOT_UNAVAILABLE =
  'The current model cannot see screenshots, so screen actions are unavailable. Use browser_* or desktop_* tools; if they cannot do it, report that this step needs an image-capable model.';

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
  ocrRunner?: OcrRunner,
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
      let driving: Promise<Awaited<ReturnType<typeof api.models.getModel>>> | undefined;
      const drivingModel = () =>
        (driving ??= api
          .agent(context)
          .then((agent) =>
            agent.model === undefined
              ? undefined
              : api.models.getModel(agent.model.provider, agent.model.modelId),
          ));
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
        if (DESKTOP_TOOL_NAMES.has(def.name)) {
          const seesImages = (await drivingModel())?.input.includes('image') === true;
          if (!seesImages && (def.name === 'computer_observe' || def.name === 'computer_act')) {
            return { output: [{ type: 'text', text: SCREENSHOT_UNAVAILABLE }], isError: true };
          }
          const result = await channel.relayComputer(
            stepId,
            def.name,
            params,
            callId,
            context.abortSignal,
          );
          const images = await Promise.all(
            (result.images ?? []).map((image) =>
              prepareCoordinatorImage(image.data, image.mimeType),
            ),
          );
          return { output: [{ type: 'text', text: result.text }, ...images] };
        }
        const text = await channel.relayTool(stepId, def.name, params, callId, context.abortSignal);
        if (def.name === 'attachment') {
          const attachment = JSON.parse(text) as {
            fileName?: string;
            mimeType: string;
            sizeBytes?: number;
            encoding: string;
            content: string;
          };
          if (attachment.mimeType.startsWith('image/') && attachment.encoding === 'base64') {
            const model = await drivingModel();
            if (model?.input.includes('image') === true) {
              return {
                output: [await prepareCoordinatorImage(attachment.content, attachment.mimeType)],
              };
            }
            const imageText = await attachmentImageText({
              models: api.models,
              image: {
                fileName: attachment.fileName ?? 'attachment',
                mimeType: attachment.mimeType,
                sizeBytes: attachment.sizeBytes,
                content: attachment.content,
              },
              prepareImage: prepareCoordinatorImage,
              preferProvider: model?.provider,
              ocr: ocrRunner,
              signal: context.abortSignal,
            });
            return { output: [{ type: 'text', text: imageText }] };
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
    desktopTools?: boolean;
    vmComputer?: boolean;
    ownComputer?: boolean;
    connectorTools?: RemoteToolDef[];
    shuttingDown?: () => boolean;
    beforeTool?: (signal?: AbortSignal, conversationId?: string) => Promise<void>;
    storeId?: () => string | undefined;
    ocrRunner?: OcrRunner;
  } = {},
) {
  const defs = [...coordinatorToolDefs(options), ...(options.connectorTools ?? [])];
  return defineExtension({
    name: 'cairn-coordinator-tools',
    hooks: [
      createCutOffRecovery(COORDINATOR_CUT_OFF_MESSAGE).hook,
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
        options.ocrRunner,
      ),
    ),
  });
}
