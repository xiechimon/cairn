import { createHash } from 'node:crypto';
import {
  COMPUTER_DESKTOP_TOOLS,
  coordinatorToolSourceId,
  type MachineAskBody,
  OWN_COMPUTER_TOOLS,
  type RemoteToolDef,
} from '@cairn/shared';
import type { ImageContent, TextContent } from '@earendil-works/pi-ai';
import {
  defineExtension,
  defineTool,
  GenerationTask,
  hook,
  type ToolRegistration,
} from '@earendil-works/pi-durable';
import { createToolSearchTool } from '@earendil-works/pi-durable/tool-search';
import { HttpError } from '../../lib/errors.js';
import { coordinatorToolDefs } from '../../services/coordinator-tool-defs.js';
import { createCutOffRecovery } from './cut-off-recovery.js';
import {
  type AttachmentImageTextResult,
  attachmentImageText,
  type ImageTextCacheEntry,
  type OcrRunner,
} from './image-text.js';
import { boundCoordinatorImages, prepareCoordinatorImage } from './images.js';
import type { MachineApi } from './machine-api.js';
import { deferToolsOf } from './models.js';
import { createToolArgsRepair } from './tool-args-repair.js';

export class ShutdownInterrupt extends Error {
  constructor() {
    super('Coordinator is shutting down');
    this.name = 'ShutdownInterrupt';
  }
}

export const COORDINATOR_CUT_OFF_MESSAGE =
  'Your last output was cut off at the length limit, so its tool call never ran. Retry with a shorter output, or split the work into smaller steps.';

export const COORDINATOR_TOOL_OUTPUT_MAX_BYTES = 32_768;

export type ToolChannel = Pick<
  MachineApi,
  'relayTool' | 'relayComputer' | 'askUser' | 'transcriptRow'
>;

function imageReadMarker(fileName: string | undefined, read: AttachmentImageTextResult): string {
  const name = fileName ?? 'attachment';
  switch (read.via) {
    case 'caption':
      return `图片附件 ${name}：当前模型看不到图片，已由视觉模型 ${read.attribution ?? ''} 转录为文字`;
    case 'ocr':
      return `图片附件 ${name}：当前模型看不到图片，已由 tesseract OCR 转录为文字`;
    case 'ocr-empty':
      return `图片附件 ${name}：当前模型看不到图片，tesseract OCR 未发现文字`;
    case 'unreadable':
      return `图片附件 ${name}：当前模型看不到图片，视觉模型与 OCR 均不可用，未能读取`;
  }
}

const RELAY_COMPUTER_TOOL_NAMES: ReadonlySet<string> = new Set(
  [...COMPUTER_DESKTOP_TOOLS, ...OWN_COMPUTER_TOOLS].map((def) => def.name),
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
    if (error instanceof HttpError && error.status === 422) throw error;
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
  imageTextCache?: Map<string, ImageTextCacheEntry>,
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
      try {
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
        if (RELAY_COMPUTER_TOOL_NAMES.has(def.name)) {
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
          const images = seesImages
            ? await Promise.all(
                (result.images ?? []).map((image) =>
                  prepareCoordinatorImage(image.data, image.mimeType),
                ),
              )
            : [];
          return { output: [{ type: 'text', text: result.text }, ...images] };
        }
        const text = await channel.relayTool(stepId, def.name, params, callId, context.abortSignal);
        if (def.name === 'attachment' || def.name === 'read_file') {
          let attachment:
            | {
                id?: string;
                fileName?: string;
                mimeType?: unknown;
                sizeBytes?: number;
                encoding?: unknown;
                content?: unknown;
                attachmentToken?: string;
              }
            | undefined;
          try {
            attachment = JSON.parse(text) as typeof attachment;
          } catch {
            attachment = undefined;
          }
          if (
            attachment !== undefined &&
            typeof attachment.mimeType === 'string' &&
            attachment.mimeType.startsWith('image/') &&
            attachment.encoding === 'base64' &&
            typeof attachment.content === 'string'
          ) {
            const model = await drivingModel();
            if (model?.input.includes('image') === true) {
              const imageBlock = await prepareCoordinatorImage(
                attachment.content,
                attachment.mimeType,
              );
              const meta =
                attachment.attachmentToken === undefined
                  ? []
                  : [
                      {
                        type: 'text' as const,
                        text: JSON.stringify({
                          id: attachment.id,
                          fileName: attachment.fileName,
                          attachmentToken: attachment.attachmentToken,
                        }),
                      },
                    ];
              return { output: [imageBlock, ...meta] };
            }
            const read = await attachmentImageText({
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
              ...(imageTextCache === undefined ? {} : { cache: imageTextCache }),
            });
            const markerId = createHash('sha256')
              .update(attachment.content)
              .digest('hex')
              .slice(0, 10);
            await channel
              .transcriptRow(stepId, {
                id: `image-read-${stepId}-${markerId}`,
                role: 'system',
                content: imageReadMarker(attachment.fileName, read),
                createdAt: Date.now(),
              })
              .catch(() => undefined);
            const textOut =
              attachment.attachmentToken === undefined
                ? read.text
                : `${read.text}\nattachmentToken=${attachment.attachmentToken}`;
            return { output: [{ type: 'text', text: textOut }] };
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

export { CORE_COORDINATOR_TOOLS } from '@cairn/shared';

export const TOOL_SEARCH_TOOL = 'tool_search';
export const CALL_TOOL_TOOL = 'call_tool';

function firstSentence(text: string): string {
  const line = text.trim().split(/\r?\n/)[0] ?? '';
  const end = line.search(/[.。](\s|$)/);
  return end < 0 ? line : line.slice(0, end + 1);
}

export function toolSearchDescription(deferred: readonly RemoteToolDef[]): string {
  return [
    'Load tools that are not in your tool list yet. Search by what you want to do or by tool names; pass several names at once to load them together. The tools you can load:',
    ...deferred.map((def) => `- ${def.name}: ${firstSentence(def.description)}`),
    `A loaded tool is either added to your tool list from your next call, or, when the result says so, called through ${CALL_TOOL_TOOL}.`,
  ].join('\n');
}

function toolSearchTool(deferred: readonly RemoteToolDef[]): ToolRegistration {
  const native = createToolSearchTool();
  return defineTool({
    name: TOOL_SEARCH_TOOL,
    description: toolSearchDescription(deferred),
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What you want to do, or tool names.' },
        limit: { type: 'number', description: 'Most tools to load, default 8.' },
      },
      required: ['query'],
    },
    replay: 'safe',
    execute: async (args, api, context) => {
      const { query, limit } = args as { query: string; limit?: number };
      const agent = await api.agent(context);
      const model =
        agent.model === undefined
          ? undefined
          : api.models.getModel(agent.model.provider, agent.model.modelId);
      const named = deferred
        .filter((def) => new RegExp(`\\b${def.name}\\b`).test(query))
        .map((def) => def.name);
      const names =
        named.length > 0
          ? named
          : (
              (
                (
                  await native.execute(
                    { query, ...(limit === undefined ? {} : { limit }) },
                    api,
                    context,
                  )
                ).details as { loaded?: string[] } | undefined
              )?.loaded ?? []
            ).slice(0, limit ?? 8);
      if (model !== undefined && deferToolsOf(model) === 'native') {
        const offered = new Set(agent.tools.map((tool) => tool.name));
        const load = names.filter((name) => !offered.has(name));
        const text =
          names.length === 0
            ? 'No matching tools found.'
            : `Available from your next call:\n${names
                .map(
                  (name) =>
                    `- ${name}: ${firstSentence(deferred.find((def) => def.name === name)?.description ?? '')}`,
                )
                .join('\n')}`;
        return {
          output: [{ type: 'text', text }],
          details: { loaded: load },
          ...(load.length === 0 ? {} : { control: { addTools: load } }),
        };
      }
      const defs = names.flatMap((name) => deferred.filter((def) => def.name === name));
      const text =
        defs.length === 0
          ? 'No matching tools found.'
          : named.length === 0
            ? `Matching tools; search again with the names you need to load them:\n${defs
                .map((def) => `- ${def.name}: ${firstSentence(def.description)}`)
                .join('\n')}`
            : `Call these with ${CALL_TOOL_TOOL} {name, arguments}; they are not in your tool list.\n\n${defs
                .map(
                  (def) =>
                    `## ${def.name}\n${def.description}\nParameters: ${JSON.stringify(def.parameters ?? EMPTY_PARAMETERS)}`,
                )
                .join('\n\n')}`;
      return { output: [{ type: 'text', text }], details: { loaded: [] } };
    },
  });
}

function nestedOutput(value: unknown): (TextContent | ImageContent)[] {
  if (typeof value === 'string') return [{ type: 'text', text: value }];
  const items = Array.isArray(value) ? value : value === undefined ? [] : [value];
  return items.flatMap((item): (TextContent | ImageContent)[] => {
    if (typeof item === 'object' && item !== null && 'type' in item) {
      if (item.type === 'text' || item.type === 'image')
        return [item as TextContent | ImageContent];
    }
    return [{ type: 'text', text: JSON.stringify(item) }];
  });
}

function callToolTool(deferred: readonly RemoteToolDef[]): ToolRegistration {
  const names = new Set(deferred.map((def) => def.name));
  return defineTool({
    name: CALL_TOOL_TOOL,
    description: `Call a tool that ${TOOL_SEARCH_TOOL} returned with its parameters instead of adding it to your tool list. Pass its name and its arguments as an object.`,
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: `Tool name from ${TOOL_SEARCH_TOOL}.` },
        arguments: { type: 'object', description: 'The tool arguments.' },
      },
      required: ['name'],
    },
    execute: async (args, api, context) => {
      const { name, arguments: params } = args as { name: string; arguments?: unknown };
      if (!names.has(name)) {
        return {
          output: [
            {
              type: 'text',
              text: `${name} is not a tool ${CALL_TOOL_TOOL} can run; find one with ${TOOL_SEARCH_TOOL}.`,
            },
          ],
          isError: true,
        };
      }
      const result = await api.executeTool(
        name,
        (typeof params === 'object' && params !== null ? params : {}) as never,
        context,
      );
      const output = nestedOutput(result.structuredOutput);
      const diagnostics = result.diagnostics.map((d) => d.message).filter((m) => m !== '');
      return {
        output:
          output.length > 0 || diagnostics.length === 0
            ? output
            : [{ type: 'text', text: diagnostics.join('\n') }],
        isError: result.isError,
      };
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
    ownerChrome?: boolean;
    phoneComputer?: readonly string[];
    connectorTools?: RemoteToolDef[];
    remoteTools?: readonly RemoteToolDef[];
    loaded?: ReadonlySet<string>;
    shuttingDown?: () => boolean;
    beforeTool?: (signal?: AbortSignal, conversationId?: string) => Promise<void>;
    onToolRound?: (conversationId: string, active: boolean) => void;
    storeId?: () => string | undefined;
    ocrRunner?: OcrRunner;
    imageTextCache?: Map<string, ImageTextCacheEntry>;
  } = {},
) {
  const defs =
    options.remoteTools !== undefined
      ? [...options.remoteTools]
      : [...coordinatorToolDefs(options), ...(options.connectorTools ?? [])];
  const loaded = options.loaded;
  const deferred = loaded === undefined ? [] : defs.filter((def) => !loaded.has(def.name));
  return defineExtension({
    name: 'cairn-coordinator-tools',
    hooks: [
      createCutOffRecovery(COORDINATOR_CUT_OFF_MESSAGE).hook,
      createToolArgsRepair(),
      hook(GenerationTask, {
        beforeRequest: async ({ messages }, api, context) => {
          options.onToolRound?.(String(api.conversationId), false);
          await options.beforeTool?.(context.abortSignal, String(api.conversationId));
          return { messages: boundCoordinatorImages(messages) };
        },
        afterResponse: (message, api) => {
          if (
            message.stopReason === 'toolUse' &&
            message.content.some((block) => block.type === 'toolCall')
          ) {
            options.onToolRound?.(String(api.conversationId), true);
          }
        },
        afterTools: (_assistant, _results, api) => {
          options.onToolRound?.(String(api.conversationId), false);
        },
      }),
    ],
    tools: [
      ...defs.map((def): ToolRegistration => {
        const tool = coordinatorTool(
          def,
          channel,
          gate,
          options.shuttingDown,
          options.beforeTool,
          options.storeId,
          options.ocrRunner,
          options.imageTextCache,
        );
        return deferred.includes(def) ? { ...tool, deferred: true } : tool;
      }),
      ...(deferred.length > 0 ? [toolSearchTool(deferred), callToolTool(deferred)] : []),
    ],
  });
}
