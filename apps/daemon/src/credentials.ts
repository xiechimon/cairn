import type { BoundGitCredentials, MachineTokenResponse, ProviderConfig } from '@cairn/shared';

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
  provider: ProviderConfig | null;
  secrets: SecretVault;
  git: BoundGitCredentials | null;
}

export function pushCredential(
  token: MachineTokenResponse,
  repoUrl: string | null,
): StepCredentials {
  return {
    provider: token.provider,
    secrets: openSecretVault(token.secrets),
    git: token.git === null || repoUrl === null ? null : { ...token.git, url: repoUrl },
  };
}

export function clearCredentials(creds: StepCredentials): void {
  creds.provider = null;
  creds.secrets = EMPTY_SECRET_VAULT;
  creds.git = null;
}
