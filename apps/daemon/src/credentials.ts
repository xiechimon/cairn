import {
  type BoundGitCredentials,
  type MachineTokenResponse,
  type ProviderConfig,
  SUBSCRIPTION_PI_PROVIDER_ID,
} from '@cairn/shared';

export interface SecretVault {
  names: readonly string[];
  take(name: string): string | null;
}

export const EMPTY_SECRET_VAULT: SecretVault = { names: [], take: () => null };

function openSecretVault(values: Record<string, string>): SecretVault {
  const held = new Map(Object.entries(values));
  return {
    names: [...held.keys()],
    take(name: string): string | null {
      const value = held.get(name);
      return value === undefined ? null : value;
    },
  };
}

export interface StepCredentials {
  claudeSubscriptionToken?: string;
  provider: ProviderConfig | null;
  secrets: SecretVault;
  git: BoundGitCredentials | null;
}

function withSubscriptionKey(
  provider: ProviderConfig | null,
  subscriptionToken: string | undefined,
): ProviderConfig | null {
  if (
    provider?.kind !== 'api_key' ||
    provider.providerId !== SUBSCRIPTION_PI_PROVIDER_ID ||
    provider.apiKey !== undefined ||
    subscriptionToken === undefined
  )
    return provider;
  return { ...provider, apiKey: subscriptionToken };
}

export function pushCredential(
  token: MachineTokenResponse,
  repoUrl: string | null,
): StepCredentials {
  return {
    provider: withSubscriptionKey(token.provider, token.claudeSubscriptionToken),
    claudeSubscriptionToken: token.claudeSubscriptionToken,
    secrets: openSecretVault(token.secrets),
    git: token.git === null || repoUrl === null ? null : { ...token.git, url: repoUrl },
  };
}

export function clearCredentials(creds: StepCredentials): void {
  creds.provider = null;
  delete creds.claudeSubscriptionToken;
  creds.secrets = EMPTY_SECRET_VAULT;
  creds.git = null;
}
