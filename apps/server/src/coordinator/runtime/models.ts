import { createThinkingBindingGuard, type ProviderConfig } from '@cairn/shared';
import {
  type Api,
  type AssistantMessage,
  type AssistantMessageEvent,
  type AssistantMessageEventStream,
  type Context,
  createAssistantMessageEventStream,
  InMemoryCredentialStore,
  type Model,
  type Provider,
} from '@earendil-works/pi-ai';
import { createModels, type MutableModels } from '@earendil-works/pi-ai/models';
import { resolveCacheRetentionTier } from './cold-slim.js';
import { type KeyResolver, stepProvider } from './provider.js';

export const IMAGE_REQUEST_TIMEOUT_MS = 90_000;
export const IMAGE_OMITTED_NOTE = 'screenshot omitted: this model did not accept images';
const NOT_AN_IMAGE_FAILURE = /\b(401|403|429)\b|unauthori[sz]ed|forbidden|rate.?limit|quota/i;

type StreamArgs = Parameters<MutableModels['streamSimple']>;

function hasImages(context: Context): boolean {
  return context.messages.some(
    (message) =>
      message.role !== 'assistant' &&
      typeof message.content !== 'string' &&
      message.content.some((block) => block.type === 'image'),
  );
}

function carriesContent(event: AssistantMessageEvent): boolean {
  if (event.type === 'done' || event.type === 'toolcall_start') return true;
  return 'delta' in event && event.delta.length > 0;
}

function withoutImages(context: Context): Context {
  return {
    ...context,
    messages: context.messages.map((message) => {
      if (message.role === 'assistant' || typeof message.content === 'string') return message;
      return {
        ...message,
        content: message.content.map((block) =>
          block.type === 'image' ? { type: 'text' as const, text: IMAGE_OMITTED_NOTE } : block,
        ),
      };
    }) as Context['messages'],
  };
}

function failedStream(model: Model<Api>, error: unknown): AssistantMessage {
  return {
    role: 'assistant',
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'error',
    errorMessage: String(error),
    timestamp: Date.now(),
  };
}

function retriedBeforeContent(
  model: Model<Api>,
  start: () => AssistantMessageEventStream,
  retry: (error: AssistantMessage) => boolean,
): AssistantMessageEventStream {
  const out = createAssistantMessageEventStream();
  const run = async () => {
    const held: AssistantMessageEvent[] = [];
    let streaming = false;
    for await (const event of start()) {
      if (event.type === 'error' && !streaming) {
        if (retry(event.error)) {
          for await (const next of start()) out.push(next);
          return;
        }
        for (const earlier of held) out.push(earlier);
        out.push(event);
        return;
      }
      if (!streaming && carriesContent(event)) {
        streaming = true;
        for (const earlier of held.splice(0)) out.push(earlier);
      }
      if (streaming) out.push(event);
      else held.push(event);
    }
  };
  void run().catch((error) => out.end(failedStream(model, error)));
  return out;
}

interface ResponseTiming {
  at: number;
  endAt: number;
  firstTokenAt?: number;
}

const timings = new WeakMap<AssistantMessage, ResponseTiming>();

export function modelResponseTiming(message: AssistantMessage): ResponseTiming {
  return (
    timings.get(message) ?? {
      at: message.timestamp,
      endAt: message.timestamp + (message.durationMs ?? 0),
    }
  );
}

export interface CoordinatorModels {
  models: MutableModels;
  setApiKey(providerId: string, key: string): Promise<void>;
  useStepProvider(config: ProviderConfig): void;
  useProvider(config: ProviderConfig, resolveKey: KeyResolver): void;
  markTextOnly(providerId: string, modelId: string): void;
}

export function createCoordinatorModels(
  providers: readonly Provider[] = [],
  onImagesRejected?: (providerId: string, modelId: string) => void,
): CoordinatorModels {
  const fixed = new Set(providers.map((p) => p.id));
  const credentials = new InMemoryCredentialStore();
  const models = createModels({ credentials });
  const baseStream = models.streamSimple.bind(models);
  const markTextOnly = (providerId: string, modelId: string) => {
    const model = models.getModel(providerId, modelId);
    if (model !== undefined) model.input = ['text'];
  };
  const streamSimple = (...[model, context, options]: StreamArgs) => {
    if (!model.input.includes('image') || !hasImages(context)) {
      return baseStream(model, context, options);
    }
    const out = createAssistantMessageEventStream();
    const run = async () => {
      const first = baseStream(model, context, {
        ...options,
        timeoutMs: options?.timeoutMs ?? IMAGE_REQUEST_TIMEOUT_MS,
        maxRetries: 0,
      });
      const held: AssistantMessageEvent[] = [];
      let streaming = false;
      for await (const event of first) {
        if (event.type === 'error') {
          const retriable =
            !streaming &&
            event.reason !== 'aborted' &&
            options?.signal?.aborted !== true &&
            !NOT_AN_IMAGE_FAILURE.test(event.error.errorMessage ?? '');
          if (!retriable) {
            for (const earlier of held) out.push(earlier);
            out.push(event);
            return;
          }
          const retry = baseStream(model, withoutImages(context), options);
          let recovered = false;
          for await (const next of retry) {
            if (next.type === 'done') recovered = true;
            out.push(next);
          }
          if (recovered) {
            markTextOnly(model.provider, model.id);
            onImagesRejected?.(model.provider, model.id);
          }
          return;
        }
        if (!streaming && carriesContent(event)) {
          streaming = true;
          for (const earlier of held.splice(0)) out.push(earlier);
        }
        if (streaming) out.push(event);
        else held.push(event);
      }
    };
    void run().catch((error) => out.end(failedStream(model, error)));
    return out;
  };
  const binding = createThinkingBindingGuard();
  const boundStream = (...[model, context, options]: StreamArgs) => {
    if (
      model.api !== 'anthropic-messages' ||
      options?.sessionId === undefined ||
      options.cacheRetention === 'none'
    ) {
      return streamSimple(model, context, options);
    }
    const key = `${options.sessionId}\n${model.provider}/${model.id}`;
    const onPayload = options.onPayload;
    const guarded = {
      ...options,
      cacheRetention: options.cacheRetention ?? resolveCacheRetentionTier(),
      onPayload: async (payload: unknown, payloadModel: typeof model) =>
        binding.apply(key, (await onPayload?.(payload, payloadModel)) ?? payload),
    };
    return retriedBeforeContent(
      model,
      () => streamSimple(model, context, guarded),
      (error) => binding.reject(key, error.errorMessage ?? ''),
    );
  };
  models.streamSimple = (...args) => {
    const at = Date.now();
    const started = performance.now();
    const stream = boundStream(...args);
    const push = stream.push.bind(stream);
    const end = stream.end.bind(stream);
    let firstTokenAt: number | undefined;
    let finished = false;
    const finish = (message: AssistantMessage) => {
      if (finished) return;
      finished = true;
      timings.set(message, {
        at,
        endAt: at + Math.max(0, performance.now() - started),
        ...(firstTokenAt === undefined ? {} : { firstTokenAt }),
      });
    };
    stream.push = (event) => {
      if (
        !finished &&
        firstTokenAt === undefined &&
        (event.type === 'text_delta' ||
          event.type === 'thinking_delta' ||
          event.type === 'toolcall_delta') &&
        event.delta.length > 0
      ) {
        firstTokenAt = at + Math.max(0, performance.now() - started);
      }
      if (event.type === 'done') finish(event.message);
      else if (event.type === 'error') finish(event.error);
      push(event);
    };
    stream.end = (message) => {
      if (message !== undefined) finish(message);
      end(message);
    };
    return stream;
  };
  for (const provider of providers) models.setProvider(provider);
  return {
    models,
    setApiKey: async (providerId, key) => {
      await credentials.modify(providerId, async () => ({ type: 'api_key', key }));
    },
    useStepProvider: (config) => {
      const provider = stepProvider(config);
      if (provider !== null) models.setProvider(provider);
    },
    markTextOnly,
    useProvider: (config, resolveKey) => {
      if (fixed.has(config.providerId)) return;
      const provider = stepProvider(config, resolveKey);
      if (provider !== null) models.setProvider(provider);
    },
  };
}

export type DeferTools = 'native' | 'generic';

export function deferToolsOf(model: Model<Api>): DeferTools {
  const compat = (model.compat ?? {}) as Record<string, unknown>;
  if (model.api === 'anthropic-messages')
    return compat.supportsMidConvoSystemMessages === true &&
      compat.supportsMidConvoToolChanges === true
      ? 'native'
      : 'generic';
  if (
    model.api === 'openai-responses' ||
    model.api === 'openai-codex-responses' ||
    model.api === 'azure-openai-responses'
  )
    return compat.supportsToolSearch === true ||
      (compat.supportsMidConvoSystemMessages === true && compat.supportsAdditionalTools === true)
      ? 'native'
      : 'generic';
  return 'generic';
}
