import type {
  AntigravitySubscription,
  AntigravitySubscriptionModel,
} from './antigravity-subscription.js';
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

export interface AntigravityRunnerLogin {
  runnerId: string;
  name: string;
  online: boolean;
  status: 'ok' | 'missing_local_login' | 'unavailable';
}

export interface AntigravitySubscriptionListEntry extends AntigravitySubscription {
  runnerName?: string | null;
  runnerLogin?: 'ok' | 'unavailable' | 'missing_local_login';
  runnerOffline?: boolean;
  runnerModels?: AntigravitySubscriptionModel[];
  runnerLogins?: AntigravityRunnerLogin[];
  lastUsedAt?: number | null;
  stepsLast24h?: number | null;
  lastCheck?: SubscriptionCheck | null;
}
