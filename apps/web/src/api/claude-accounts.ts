import type { ClaudeSubscription } from '@cairn/shared';

export const ACCOUNT_STATES = ['ok', 'cooling', 'exhausted', 'expired'] as const;
export type AccountState = (typeof ACCOUNT_STATES)[number];
export type AccountPlan = 'pro' | 'max';

export interface QuotaWindow {
  name: string;
  utilization: number;
  resetsAt: number | null;
  observedAt: number;
}

export type ClaudeSubscriptionWire = ClaudeSubscription & {
  plan?: AccountPlan | null;
  state?: AccountState;
  cooldownUntil?: number | null;
  windows?: QuotaWindow[];
  lastUsedAt?: number | null;
  stepsLast24h?: number;
};

export const ACCOUNT_VENDORS = ['claude', 'codex', 'grok'] as const;
export type AccountVendor = (typeof ACCOUNT_VENDORS)[number];

const PLAN_LABELS: Record<AccountPlan, string> = { pro: 'Pro', max: 'Max' };

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
}

const isAccountState = (value: unknown): value is AccountState =>
  typeof value === 'string' && (ACCOUNT_STATES as readonly string[]).includes(value);

export function toClaudeAccount(wire: ClaudeSubscriptionWire, now: number): SubscriptionAccount {
  const expired = wire.expiresAt !== null && wire.expiresAt <= now;
  return {
    id: wire.id,
    vendor: 'claude',
    label: wire.label,
    expiresAt: wire.expiresAt,
    createdAt: wire.createdAt,
    plan: wire.plan === 'pro' || wire.plan === 'max' ? PLAN_LABELS[wire.plan] : null,
    state: isAccountState(wire.state) ? wire.state : expired ? 'expired' : 'ok',
    cooldownUntil: wire.cooldownUntil ?? null,
    windows: Array.isArray(wire.windows) ? wire.windows : [],
    lastUsedAt: wire.lastUsedAt ?? null,
    stepsLast24h: typeof wire.stepsLast24h === 'number' ? wire.stepsLast24h : null,
  };
}

export const STEP_KINDS = ['build', 'plan', 'chief', 'review', 'merge'] as const;
export type AccountStepKind = (typeof STEP_KINDS)[number];
export type AccountStepOutcome = 'done' | 'failed' | 'rejected-rerun' | 'running';

export interface AccountStep {
  stepId: string;
  kind: AccountStepKind;
  threadId: string;
  todoId: string;
  title: string | null;
  startedAt: number;
  outcome: AccountStepOutcome;
}

export interface AccountStepsPage {
  steps: AccountStep[];
  hasEarlier: boolean;
}

export interface StickyThread {
  threadId: string;
  title: string;
  subscriptionId: string;
  since: number;
}

export interface AccountMachine {
  id: string;
  name: string;
}
