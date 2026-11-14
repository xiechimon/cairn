import type { ProviderConfig } from '@cairn/shared';
import {
  type AssistantMessage,
  InMemoryCredentialStore,
  type Provider,
} from '@earendil-works/pi-ai';
import { createModels, type MutableModels } from '@earendil-works/pi-ai/models';
import { type KeyResolver, stepProvider } from './provider.js';

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
}

export function createCoordinatorModels(providers: readonly Provider[] = []): CoordinatorModels {
  const fixed = new Set(providers.map((p) => p.id));
  const credentials = new InMemoryCredentialStore();
  const models = createModels({ credentials });
  const streamSimple = models.streamSimple.bind(models);
  models.streamSimple = (...args) => {
    const at = Date.now();
    const started = performance.now();
    const stream = streamSimple(...args);
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
    useProvider: (config, resolveKey) => {
      if (fixed.has(config.providerId)) return;
      const provider = stepProvider(config, resolveKey);
      if (provider !== null) models.setProvider(provider);
    },
  };
}
