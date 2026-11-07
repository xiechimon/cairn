import type { ProviderConfig, ProviderTestError } from '@cairn/shared';
import { InMemoryCredentialStore } from '@earendil-works/pi-ai';
import { createModels } from '@earendil-works/pi-ai/models';
import { stepProvider } from './provider.js';

export type ProbeFetch = typeof globalThis.fetch;

export interface ProbeInput {
  config: ProviderConfig;
  apiKey: string;
  model: string;
  fetch: ProbeFetch;
  timeoutMs: number;
  maxTokens: number;
}

export interface ProbeOutcome {
  httpStatus: number | null;
  latencyMs: number;
  responseModel: string | null;
  error: { type: ProviderTestError['type']; raw: string } | null;
}

function errorTypeOf(status: number): ProviderTestError['type'] {
  if (status === 401 || status === 403) return 'auth';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'server';
  return 'other';
}

export async function probeProvider(input: ProbeInput): Promise<ProbeOutcome> {
  const started = Date.now();
  const elapsed = () => Date.now() - started;
  const configured = input.config.models?.find((m) => m.id === input.model);
  const provider = stepProvider(
    {
      ...input.config,
      models: [configured ?? { id: input.model, name: input.model }],
    },
    () => input.apiKey,
  );
  if (provider === null) {
    return {
      httpStatus: null,
      latencyMs: elapsed(),
      responseModel: null,
      error: { type: 'other', raw: 'the provider has no usable protocol or base URL' },
    };
  }
  const models = createModels({ credentials: new InMemoryCredentialStore() });
  models.setProvider(provider);
  const model = models.getModel(input.config.providerId, input.model);
  if (model === undefined) {
    return {
      httpStatus: null,
      latencyMs: elapsed(),
      responseModel: null,
      error: { type: 'no_model', raw: 'the model is not available on this provider' },
    };
  }
  let httpStatus: number | null = null;
  const recordingFetch: ProbeFetch = async (url, init) => {
    const res = await input.fetch(url, init);
    httpStatus = res.status;
    return res;
  };
  const failure = (type: ProviderTestError['type'], raw: string): ProbeOutcome => ({
    httpStatus,
    latencyMs: elapsed(),
    responseModel: null,
    error: { type, raw },
  });
  const signal = AbortSignal.timeout(input.timeoutMs);
  const reply = await models.complete(
    model,
    {
      messages: [{ role: 'user', content: 'ping', timestamp: Date.now() }],
    },
    {
      fetch: recordingFetch,
      signal,
      timeoutMs: input.timeoutMs,
      maxRetries: 0,
      maxTokens: input.maxTokens,
    },
  );
  const latencyMs = elapsed();
  if (signal.aborted) {
    return failure('timeout', 'the provider did not answer in time');
  }
  const answered = reply.content.length > 0 || reply.usage.output > 0;
  if (reply.stopReason === 'aborted' || (reply.stopReason !== 'error' && answered)) {
    return reply.stopReason === 'aborted'
      ? failure('network', reply.errorMessage ?? 'the request was aborted')
      : { httpStatus, latencyMs, responseModel: reply.responseModel ?? null, error: null };
  }
  if (reply.stopReason !== 'error') {
    return failure('invalid_response', 'the provider answered with an unexpected body');
  }
  const status = httpStatus as number | null;
  return failure(
    status === null ? 'network' : status < 400 ? 'invalid_response' : errorTypeOf(status),
    reply.errorMessage ?? 'the provider failed',
  );
}
