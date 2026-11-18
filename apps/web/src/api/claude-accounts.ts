import type {
  ClaudeSubscriptionListEntry,
  ClaudeSubscriptionQuotaWindow,
  DevinSubscriptionModel,
  MachineRecord,
} from '@cairn/shared';

export const ACCOUNT_STATES = ['ok', 'cooling', 'exhausted', 'expired'] as const;
export type AccountState = (typeof ACCOUNT_STATES)[number];

export type QuotaWindow = ClaudeSubscriptionQuotaWindow;

export const ACCOUNT_VENDORS = ['claude', 'codex', 'grok', 'devin', 'antigravity'] as const;
export type AccountVendor = (typeof ACCOUNT_VENDORS)[number];

export type SubscriptionModel = DevinSubscriptionModel;

export interface SubscriptionAccount {
  id: string;
  vendor: AccountVendor;
  label: string;
  expiresAt: number | null;
  createdAt: number;
  plan: string | null;
  state: AccountState;
  cooldownUntil: number | null;
  windows: QuotaWindow[];
  lastUsedAt: number | null;
  stepsLast24h: number | null;
  models?: SubscriptionModel[];
}

const isAccountState = (value: unknown): value is AccountState =>
  typeof value === 'string' && (ACCOUNT_STATES as readonly string[]).includes(value);

export function toClaudeAccount(
  wire: ClaudeSubscriptionListEntry,
  now: number,
): SubscriptionAccount {
  const expired = wire.expiresAt !== null && wire.expiresAt <= now;
  return {
    id: wire.id,
    vendor: 'claude',
    label: wire.label,
    expiresAt: wire.expiresAt,
    createdAt: wire.createdAt,
    plan: null,
    state: isAccountState(wire.state) ? wire.state : expired ? 'expired' : 'ok',
    cooldownUntil: wire.cooldownUntil ?? null,
    windows: Array.isArray(wire.windows) ? wire.windows : [],
    lastUsedAt: wire.lastUsedAt ?? null,
    stepsLast24h: typeof wire.stepsLast24h === 'number' ? wire.stepsLast24h : null,
  };
}

export interface AccountMachine {
  id: string;
  name: string;
}

export type ProviderRuntime = 'claude-code' | 'codex' | 'pi' | 'devin' | 'antigravity';
export type ProviderLogin = 'logged-in' | 'logged-out' | 'unknown';

export interface MachineProvider {
  runtime: ProviderRuntime;
  login: ProviderLogin;
  plan: string | null;
  version: string | null;
  loginCommand: string | null;
  enabled: boolean;
  observedAt: number;
}

export type MachineWithProviders = Pick<
  MachineRecord,
  'id' | 'name' | 'online' | 'capabilities'
> & {
  enabledRuntimes: readonly string[];
  providers?: MachineProvider[];
};
