import {
  type AntigravityProbedModel,
  type AntigravitySubscriptionModel,
  antigravitySubscriptionModelSchema,
  isInternalAntigravityModelId,
  type ProviderFailure,
} from '@cairn/shared';
import { z } from 'zod';

const ANTIGRAVITY_ENTITLEMENTS_URL =
  'https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels';
const MODEL_TIMEOUT_MS = 8_000;
const MAX_MODELS = 2000;

const availableModel = z.object({
  displayName: z.string().trim().min(1).max(256).optional().catch(undefined),
  label: z.string().trim().min(1).max(256).optional().catch(undefined),
  modelProvider: z.string().optional().catch(undefined),
  apiProvider: z.string().optional().catch(undefined),
  isInternal: z.boolean().optional(),
  disabled: z.boolean().optional(),
});

const modelsEnvelope = z.object({
  models: z.record(z.string(), z.unknown()),
  agentModelSorts: z
    .array(
      z.object({
        groups: z.array(z.object({ modelIds: z.array(z.string()).optional() })).optional(),
      }),
    )
    .optional()
    .catch(undefined),
  tabModelIds: z.array(z.string()).optional().catch(undefined),
  imageGenerationModelIds: z.array(z.string()).optional().catch(undefined),
  audioTranscriptionModelIds: z.array(z.string()).optional().catch(undefined),
  tieredModelIds: z.record(z.string(), z.array(z.string())).optional().catch(undefined),
});

type Result =
  | { status: 'ok'; models: AntigravitySubscriptionModel[] }
  | { status: 'failed'; failure: ProviderFailure };

export function antigravityProbedCatalog(
  probed: readonly AntigravityProbedModel[],
  token: string,
): AntigravitySubscriptionModel[] {
  const models = new Map<string, AntigravitySubscriptionModel>();
  for (const { id, name } of probed) {
    if (
      isInternalAntigravityModelId(id) ||
      models.has(id) ||
      id.includes(token) ||
      name.includes(token)
    ) {
      continue;
    }
    const validated = antigravitySubscriptionModelSchema.safeParse({ id, name });
    if (!validated.success) continue;
    models.set(id, validated.data);
  }
  return [...models.values()];
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

function sortedAgentModelIds(sorts: z.infer<typeof modelsEnvelope>['agentModelSorts']): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const sort of sorts ?? []) {
    for (const group of sort.groups ?? []) {
      for (const id of group.modelIds ?? []) {
        if (seen.has(id)) continue;
        seen.add(id);
        ids.push(id);
      }
    }
  }
  return ids;
}

function parseVisibleModel(
  id: string,
  entry: unknown,
  excludedIds: ReadonlySet<string>,
  accessToken: string,
): AntigravitySubscriptionModel | null {
  if (excludedIds.has(id) || isInternalAntigravityModelId(id) || id.includes(accessToken)) {
    return null;
  }
  const model = availableModel.safeParse(entry);
  if (
    !model.success ||
    model.data.disabled === true ||
    model.data.isInternal === true ||
    model.data.apiProvider === 'API_PROVIDER_INTERNAL'
  ) {
    return null;
  }
  const displayName = model.data.displayName ?? model.data.label;
  if (displayName === undefined || displayName.includes(accessToken)) return null;
  const validated = antigravitySubscriptionModelSchema.safeParse({ id, name: displayName });
  return validated.success ? validated.data : null;
}

function hasUsableTieredFlash(
  models: Record<string, unknown>,
  tieredModelIds: Record<string, string[]> | undefined,
): boolean {
  const tierIds = [...(tieredModelIds?.flash ?? []), ...(tieredModelIds?.pro ?? [])];
  if (!tierIds.includes('gemini-3.8-flash-tiered')) return false;
  const raw = models['gemini-3.8-flash-tiered'];
  if (raw === undefined) return false;
  const parsed = availableModel.safeParse(raw);
  return parsed.success && parsed.data.disabled !== true;
}

export async function fetchAntigravityEntitlements(
  accessToken: string,
  signal?: AbortSignal,
): Promise<Result> {
  const timeout = AbortSignal.timeout(MODEL_TIMEOUT_MS);
  const deadline = signal ? AbortSignal.any([signal, timeout]) : timeout;
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
    const excludedIds = new Set([
      ...(parsed.data.tabModelIds ?? []),
      ...(parsed.data.imageGenerationModelIds ?? []),
      ...(parsed.data.audioTranscriptionModelIds ?? []),
    ]);
    const models: AntigravitySubscriptionModel[] = [];
    const seen = new Set<string>();
    const push = (model: AntigravitySubscriptionModel | null) => {
      if (model === null || seen.has(model.id) || models.length >= MAX_MODELS) return;
      seen.add(model.id);
      models.push(model);
    };

    const sortedIds = sortedAgentModelIds(parsed.data.agentModelSorts);
    if (sortedIds.length > 0) {
      if (hasUsableTieredFlash(parsed.data.models, parsed.data.tieredModelIds)) {
        push({ id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash' });
      }
      for (const id of sortedIds) {
        if (!Object.hasOwn(parsed.data.models, id)) continue;
        push(parseVisibleModel(id, parsed.data.models[id], excludedIds, accessToken));
      }
    } else {
      for (const [id, entry] of Object.entries(parsed.data.models)) {
        push(parseVisibleModel(id, entry, excludedIds, accessToken));
        if (models.length >= MAX_MODELS) break;
      }
    }
    return models.length > 0 ? { status: 'ok', models } : { status: 'failed', failure: 'no-model' };
  } catch {
    return { status: 'failed', failure: deadline.aborted ? 'timeout' : 'upstream' };
  }
}
