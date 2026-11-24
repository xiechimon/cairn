import type { LocalProvider } from './local-providers.js';

export interface DesktopSubscriptionInput {
  teamId: string;
  label: string;
}

export interface DesktopSubscriptionMetadata {
  id: string;
  label: string;
}

export interface DesktopProviderImportInput {
  teamId: string;
  providerIds: string[];
}

export type DesktopLocalProvider = Pick<LocalProvider, 'providerId' | 'label' | 'state'>;

export type DesktopProviderImportResult =
  | { providerId: string; status: 'saved'; id: string }
  | { providerId: string; status: 'missing' | 'failed' };
