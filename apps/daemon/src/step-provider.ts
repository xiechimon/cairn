import type { BackendRuntimeId, ProviderConfig } from '@cairn/shared';
import { isBackendRuntimeId } from '@cairn/shared';

export function resolveStepProvider(
  agentProvider: string | null | undefined,
  credentialProvider: ProviderConfig | null,
): { runtimeId: BackendRuntimeId | null; provider: ProviderConfig | null } {
  if (isBackendRuntimeId(agentProvider)) {
    return { runtimeId: agentProvider, provider: { kind: 'api_key', providerId: agentProvider } };
  }
  return {
    runtimeId: null,
    provider:
      credentialProvider ?? (agentProvider ? { kind: 'api_key', providerId: agentProvider } : null),
  };
}
