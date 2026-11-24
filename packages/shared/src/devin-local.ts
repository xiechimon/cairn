import type { DesktopSubscriptionMetadata } from './desktop-local-credentials.js';

export const DEVIN_TOKEN_LIFETIME_MS = 365 * 24 * 60 * 60 * 1000;

export interface DevinLocalStatus {
  loggedIn: boolean;
  canLogin: boolean;
}

export type DevinLoginFailure =
  | 'no-binary'
  | 'spawn'
  | 'exit'
  | 'timeout'
  | 'cancelled'
  | 'busy'
  | 'no-key'
  | 'save';

export type DevinLoginOutcome =
  | { ok: true; subscription: DesktopSubscriptionMetadata }
  | { ok: false; reason: DevinLoginFailure };

const DEVIN_KEY_LINE = /^windsurf_api_key\s*=\s*["']([^"']+)["']\s*$/m;

export function devinKeyFromToml(toml: string): string | null {
  return DEVIN_KEY_LINE.exec(toml)?.[1] ?? null;
}

export function devinCredentialsPath(home: string): string {
  return `${home}/.local/share/devin/credentials.toml`;
}
