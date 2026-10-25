import { join } from 'node:path';
import type { ProviderConfig } from '@cairn/shared';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';

const learnedNoVision = new Map<string, true>();

export function noVisionKey(providerId: string, modelId: string): string {
  return `${providerId}/${modelId}`;
}

export function rememberNoVision(providerId: string, modelId: string): void {
  learnedNoVision.set(noVisionKey(providerId, modelId), true);
}

export function isLearnedNoVision(providerId: string, modelId: string): boolean {
  return learnedNoVision.has(noVisionKey(providerId, modelId));
}

export function declaredModelInput(
  provider: ProviderConfig,
  modelId: string,
): readonly ('text' | 'image')[] | undefined {
  return (provider.models ?? []).find((m) => m.id === modelId)?.input;
}

export async function probeModelImageSupport(
  agentDir: string,
  provider: ProviderConfig,
  modelId: string,
): Promise<boolean | null> {
  if (isLearnedNoVision(provider.providerId, modelId)) return false;
  if (provider.baseUrl) {
    const declared = declaredModelInput(provider, modelId);
    if (declared === undefined) return null;
    return declared.includes('image');
  }
  const runtime = await ModelRuntime.create({
    authPath: join(agentDir, 'auth.json'),
    modelsPath: join(agentDir, 'models.json'),
  });
  const model = runtime.getModel(provider.providerId, modelId);
  if (!model) return null;
  return (model.input ?? []).includes('image');
}
