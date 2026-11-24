import {
  type AntigravitySubscriptionModel,
  antigravitySubscriptionModelSchema,
  type ProviderFailure,
} from '@cairn/shared';
import { z } from 'zod';

const ANTIGRAVITY_ENTITLEMENTS_URL =
  'https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels';
const QUOTA_URL = 'https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary';
const MODEL_TIMEOUT_MS = 8_000;
const QUOTA_TIMEOUT_MS = 2_000;
const MAX_MODELS = 2000;

const availableModel = z.object({
  displayName: z.string().trim().min(1).max(256).optional().catch(undefined),
  label: z.string().trim().min(1).max(256).optional().catch(undefined),
  modelProvider: z.string().optional().catch(undefined),
  disabled: z.boolean().optional(),
});
const modelsEnvelope = z.object({ models: z.record(z.string(), z.unknown()) });
const quotaEnvelope = z.object({
  groups: z
    .array(
      z.object({
        displayName: z.string().trim().min(1).max(64).optional(),
        buckets: z
          .array(z.object({ modelId: z.string().optional(), disabled: z.boolean().optional() }))
          .optional(),
      }),
    )
    .optional(),
});

type Result =
  | { status: 'ok'; models: AntigravitySubscriptionModel[] }
  | { status: 'failed'; failure: ProviderFailure };

function poolOfModel(id: string, provider: string | undefined): string | undefined {
  if (provider === 'MODEL_PROVIDER_GOOGLE') return 'Gemini Models';
  if (provider === 'MODEL_PROVIDER_ANTHROPIC' || provider === 'MODEL_PROVIDER_OPENAI') {
    return 'Claude and GPT models';
  }
  if (id.startsWith('gemini-')) return 'Gemini Models';
  if (id.startsWith('claude-') || id.startsWith('gpt-')) return 'Claude and GPT models';
  return undefined;
}

export function labelAntigravityModel(
  id: string,
  name: string,
  pool = poolOfModel(id, undefined),
): string {
  if (pool === undefined) return name;
  const suffix = ` · ${pool}`;
  const displayName = name.endsWith(suffix) ? name.slice(0, -suffix.length) : name;
  return `${displayName.slice(0, 256 - suffix.length)}${suffix}`;
}

function accountRequest(url: string, accessToken: string, signal: AbortSignal) {
  return fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: 'application/json',
      'content-type': 'application/json',
      'user-agent': 'antigravity/cairn (aidev_client)',
    },
    body: '{}',
    redirect: 'error',
    signal,
  });
}

async function accountPools(
  accessToken: string,
  signal?: AbortSignal,
): Promise<Map<string, string>> {
  const pools = new Map<string, string>();
  const timeout = AbortSignal.timeout(QUOTA_TIMEOUT_MS);
  try {
    const res = await accountRequest(
      QUOTA_URL,
      accessToken,
      signal ? AbortSignal.any([signal, timeout]) : timeout,
    );
    if (!res.ok) return pools;
    const parsed = quotaEnvelope.safeParse(await res.json());
    if (!parsed.success) return pools;
    for (const group of parsed.data.groups ?? []) {
      if (group.displayName === undefined) continue;
      for (const bucket of group.buckets ?? []) {
        if (!bucket.disabled && bucket.modelId && !pools.has(bucket.modelId)) {
          pools.set(bucket.modelId, group.displayName);
        }
      }
    }
  } catch {}
  return pools;
}

export async function fetchAntigravityEntitlements(
  accessToken: string,
  signal?: AbortSignal,
): Promise<Result> {
  const timeout = AbortSignal.timeout(MODEL_TIMEOUT_MS);
  const deadline = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const poolsPromise = accountPools(accessToken, signal);
  try {
    const res = await accountRequest(ANTIGRAVITY_ENTITLEMENTS_URL, accessToken, deadline);
    if (!res.ok) {
      return {
        status: 'failed',
        failure: res.status === 401 || res.status === 403 ? 'auth' : 'upstream',
      };
    }
    const parsed = modelsEnvelope.safeParse(await res.json());
    if (!parsed.success) return { status: 'failed', failure: 'upstream' };
    const pools = await poolsPromise;
    const models: AntigravitySubscriptionModel[] = [];
    for (const [id, entry] of Object.entries(parsed.data.models)) {
      const model = availableModel.safeParse(entry);
      if (!model.success || model.data.disabled) continue;
      const displayName = model.data.displayName ?? model.data.label ?? id;
      const pool = pools.get(id) ?? poolOfModel(id, model.data.modelProvider);
      const name = labelAntigravityModel(id, displayName, pool);
      const validated = antigravitySubscriptionModelSchema.safeParse({ id, name });
      if (!validated.success || id.includes(accessToken) || name.includes(accessToken)) continue;
      models.push(validated.data);
      if (models.length >= MAX_MODELS) break;
    }
    return models.length > 0 ? { status: 'ok', models } : { status: 'failed', failure: 'no-model' };
  } catch {
    return { status: 'failed', failure: deadline.aborted ? 'timeout' : 'upstream' };
  }
}
