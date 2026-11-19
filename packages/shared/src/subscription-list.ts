import type { AntigravitySubscription } from './antigravity-subscription.js';
import type { ClaudeSubscription } from './claude-subscription.js';
import type { DevinSubscription } from './devin-subscription.js';
import type { SubscriptionCheck } from './subscription-check.js';

export interface ClaudeSubscriptionQuotaWindow {
  name: string;
  utilization: number;
  resetsAt: number | null;
  observedAt: number;
}

export interface ClaudeSubscriptionListEntry extends ClaudeSubscription {
  state?: 'exhausted';
  cooldownUntil?: number | null;
  windows?: ClaudeSubscriptionQuotaWindow[];
  lastUsedAt?: number | null;
  stepsLast24h?: number | null;
  lastCheck?: SubscriptionCheck | null;
}

export interface DevinSubscriptionListEntry extends DevinSubscription {
  lastUsedAt?: number | null;
  stepsLast24h?: number | null;
  lastCheck?: SubscriptionCheck | null;
}

export interface AntigravitySubscriptionListEntry extends AntigravitySubscription {
  lastUsedAt?: number | null;
  stepsLast24h?: number | null;
  lastCheck?: SubscriptionCheck | null;
}
