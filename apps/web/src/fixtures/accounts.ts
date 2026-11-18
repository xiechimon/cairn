import { DEFAULT_DEVIN_MODELS, type ModelSource, type RoutingRuleRecord } from '@cairn/shared';
import type {
  AccountMachine,
  AccountStep,
  MachineWithProviders,
  SubscriptionAccount,
} from '../api/claude-accounts.js';
import type { ModelRouting } from '../api/model-routing.js';
import { MACHINE_ID, MACHINE_NAME, MACHINE_REMOTE_ID, MACHINE_REMOTE_NAME, r7 } from './core.js';
import type { FixtureSet } from './records.js';
import { RESOURCES, resourcesDefault } from './resources.js';

export interface AccountsContent {
  subscriptions: SubscriptionAccount[];
  devinSubscriptions: SubscriptionAccount[];
  otherAccounts: SubscriptionAccount[];
  stepsByAccount: Record<string, AccountStep[]>;
  machines: AccountMachine[];
  providers: { id: string; label: string }[];
  routing: ModelRouting;
}

const NOW = r7(13, 14);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const ACCOUNT_OK_ID = 'sub-personal';
export const ACCOUNT_COOLING_ID = 'sub-work';
export const ACCOUNT_EXPIRED_ID = 'sub-old-laptop';

export const ACCOUNT_SUBSCRIPTIONS: SubscriptionAccount[] = [
  {
    id: ACCOUNT_OK_ID,
    vendor: 'claude',
    label: 'Personal',
    expiresAt: NOW + 300 * DAY,
    createdAt: NOW - 40 * DAY,
    plan: 'Max',
    state: 'ok',
    cooldownUntil: null,
    windows: [
      {
        name: 'five_hour',
        utilization: 0.42,
        resetsAt: NOW + 2 * HOUR + 26 * MINUTE,
        observedAt: NOW - MINUTE,
      },
      { name: 'seven_day', utilization: 0.61, resetsAt: NOW + 3 * DAY, observedAt: NOW - MINUTE },
    ],
    lastUsedAt: NOW - 2 * MINUTE,
    stepsLast24h: 37,
  },
  {
    id: ACCOUNT_COOLING_ID,
    vendor: 'claude',
    label: 'Work',
    expiresAt: null,
    createdAt: NOW - 12 * DAY,
    plan: 'Pro',
    state: 'cooling',
    cooldownUntil: NOW + 51 * MINUTE,
    windows: [
      {
        name: 'five_hour',
        utilization: 1.04,
        resetsAt: NOW + 51 * MINUTE,
        observedAt: NOW - 3 * MINUTE,
      },
      {
        name: 'seven_day',
        utilization: 0.83,
        resetsAt: NOW + 5 * DAY,
        observedAt: NOW - 3 * MINUTE,
      },
    ],
    lastUsedAt: NOW - 48 * MINUTE,
    stepsLast24h: 112,
  },
  {
    id: ACCOUNT_EXPIRED_ID,
    vendor: 'claude',
    label: 'Old laptop',
    expiresAt: NOW - 2 * DAY,
    createdAt: NOW - 400 * DAY,
    plan: 'Pro',
    state: 'expired',
    cooldownUntil: null,
    windows: [],
    lastUsedAt: NOW - 5 * DAY,
    stepsLast24h: 0,
  },
];

export const DEVIN_SUBSCRIPTION_ID = 'sub-devin';

export const DEVIN_SUBSCRIPTIONS: SubscriptionAccount[] = [
  {
    id: DEVIN_SUBSCRIPTION_ID,
    vendor: 'devin',
    label: 'Devin',
    expiresAt: NOW + 180 * DAY,
    createdAt: NOW - 6 * DAY,
    plan: null,
    state: 'ok',
    cooldownUntil: null,
    windows: [],
    lastUsedAt: NOW - 3 * HOUR,
    stepsLast24h: 4,
    models: [
      {
        id: 'swe-2-high',
        name: 'SWE-2',
        contextTokens: 262_144,
        costTier: 'High cost',
      },
      {
        id: 'swe-2-flash-medium',
        name: 'SWE-2 Flash',
        contextTokens: 262_144,
        costTier: 'Free',
      },
      {
        id: 'adaptive',
        name: 'Adaptive',
        contextTokens: 262_144,
        costTier: 'Free',
      },
      {
        id: 'claude-opus-5-5-medium',
        name: 'Claude Opus 5.5',
        contextTokens: 1_000_000,
        costTier: 'High cost',
        costSummary: '$4 / 1M Input · $0.2 / 1M Cached input · $20 / 1M Output',
      },
      {
        id: 'gemini-4-carbon',
        name: 'Gemini 4 Carbon',
        contextTokens: 1_000_000,
        costTier: 'Med cost',
      },
    ],
  },
];

export const OTHER_ACCOUNTS: SubscriptionAccount[] = [
  {
    id: 'codex-main',
    vendor: 'codex',
    label: 'Personal',
    expiresAt: null,
    createdAt: NOW - 30 * DAY,
    plan: 'Pro',
    state: 'ok',
    cooldownUntil: null,
    windows: [
      {
        name: 'five_hour',
        utilization: 0.18,
        resetsAt: NOW + 3 * HOUR + 40 * MINUTE,
        observedAt: NOW - 2 * MINUTE,
      },
      {
        name: 'seven_day',
        utilization: 0.47,
        resetsAt: NOW + 4 * DAY,
        observedAt: NOW - 2 * MINUTE,
      },
    ],
    lastUsedAt: NOW - 20 * MINUTE,
    stepsLast24h: null,
  },
  {
    id: 'grok-main',
    vendor: 'grok',
    label: 'Personal',
    expiresAt: null,
    createdAt: NOW - 9 * DAY,
    plan: 'SuperGrok',
    state: 'ok',
    cooldownUntil: null,
    windows: [
      {
        name: 'billing_period',
        utilization: 0.12,
        resetsAt: NOW + 21 * DAY,
        observedAt: NOW - 5 * MINUTE,
      },
    ],
    lastUsedAt: NOW - 6 * HOUR,
    stepsLast24h: null,
  },
];

const STEPS: AccountStep[] = [
  {
    stepId: 'st-1',
    kind: 'build',
    threadId: 'th-1',
    todoId: 'td-1',
    title: 'Fix flaky merge-gate test',
    startedAt: NOW - 12 * MINUTE,
    outcome: 'running',
  },
  {
    stepId: 'st-2',
    kind: 'review',
    threadId: 'th-2',
    todoId: 'td-2',
    title: 'Review the composer fold',
    startedAt: NOW - 27 * MINUTE,
    outcome: 'done',
  },
  {
    stepId: 'st-3',
    kind: 'chief',
    threadId: 'th-3',
    todoId: 'td-3',
    title: null,
    startedAt: NOW - 49 * MINUTE,
    outcome: 'done',
  },
  {
    stepId: 'st-4',
    kind: 'plan',
    threadId: 'th-4',
    todoId: 'td-4',
    title: 'Plan the account page',
    startedAt: NOW - 2 * HOUR,
    outcome: 'failed',
  },
  {
    stepId: 'st-5',
    kind: 'merge',
    threadId: 'th-5',
    todoId: 'td-5',
    title: 'Merge the daemon heartbeat fix',
    startedAt: NOW - 3 * HOUR,
    outcome: 'rejected-rerun',
  },
];

export const ACCOUNT_STEPS: Record<string, AccountStep[]> = {
  [ACCOUNT_OK_ID]: [STEPS[0], STEPS[2]].filter((s): s is AccountStep => s !== undefined),
  [ACCOUNT_COOLING_ID]: [STEPS[1], STEPS[3], STEPS[4]].filter(
    (s): s is AccountStep => s !== undefined,
  ),
  [ACCOUNT_EXPIRED_ID]: [],
  [DEVIN_SUBSCRIPTION_ID]: [STEPS[0]].filter((s): s is AccountStep => s !== undefined),
};

export const ACCOUNT_MACHINES: AccountMachine[] = [
  { id: MACHINE_REMOTE_ID, name: MACHINE_REMOTE_NAME },
  { id: MACHINE_ID, name: MACHINE_NAME },
];

export const PROVIDER_MACHINES: MachineWithProviders[] = [
  {
    id: MACHINE_REMOTE_ID,
    name: MACHINE_REMOTE_NAME,
    online: true,
    enabledRuntimes: ['pi', 'claude-code'],
    providers: [
      {
        runtime: 'claude-code',
        login: 'logged-in',
        plan: 'Max',
        version: '2.1.289',
        loginCommand: null,
        enabled: true,
        observedAt: NOW - MINUTE,
      },
      {
        runtime: 'codex',
        login: 'logged-in',
        plan: 'ChatGPT Pro',
        version: '0.98.0',
        loginCommand: null,
        enabled: true,
        observedAt: NOW - MINUTE,
      },
      {
        runtime: 'pi',
        login: 'unknown',
        plan: null,
        version: '0.9.3',
        loginCommand: null,
        enabled: true,
        observedAt: NOW - MINUTE,
      },
    ],
  },
  {
    id: MACHINE_ID,
    name: MACHINE_NAME,
    online: false,
    enabledRuntimes: ['pi'],
    providers: [
      {
        runtime: 'claude-code',
        login: 'logged-out',
        plan: null,
        version: '2.1.280',
        loginCommand: 'claude /login',
        enabled: false,
        observedAt: NOW - 2 * HOUR,
      },
      {
        runtime: 'codex',
        login: 'logged-out',
        plan: null,
        version: '0.97.2',
        loginCommand: 'codex login',
        enabled: false,
        observedAt: NOW - 2 * HOUR,
      },
      {
        runtime: 'pi',
        login: 'unknown',
        plan: null,
        version: '0.9.3',
        loginCommand: null,
        enabled: true,
        observedAt: NOW - 2 * HOUR,
      },
    ],
  },
];

const CLAUDE_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'];

export const ACCOUNT_ROUTING: ModelRouting = {
  connections: [
    {
      id: ACCOUNT_OK_ID,
      vendor: 'anthropic',
      kind: 'subscription',
      models: CLAUDE_MODELS,
      available: true,
    },
    {
      id: ACCOUNT_COOLING_ID,
      vendor: 'anthropic',
      kind: 'subscription',
      models: CLAUDE_MODELS,
      available: true,
    },
    {
      id: ACCOUNT_EXPIRED_ID,
      vendor: 'anthropic',
      kind: 'subscription',
      models: CLAUDE_MODELS,
      available: false,
    },
    {
      id: 'codex-main',
      vendor: 'openai',
      kind: 'subscription',
      models: ['gpt-6.1-sol'],
      available: true,
    },
    {
      id: 'prov-copilot',
      vendor: 'openai',
      kind: 'api-key',
      models: ['gpt-4o'],
      available: false,
    },
  ],
  quota: [],
  edges: [
    { use: 'coordinator', modelId: 'claude-opus-5-5', effort: 'high', connectionId: ACCOUNT_OK_ID },
    { use: 'implementation', modelId: 'gpt-6.1-sol', effort: 'high', connectionId: 'codex-main' },
    { use: 'review', modelId: 'claude-sonnet-5-5', effort: 'high', connectionId: ACCOUNT_OK_ID },
    { use: 'mechanical', modelId: 'claude-haiku-5-5', effort: 'low', connectionId: ACCOUNT_OK_ID },
    { use: 'eval', modelId: 'claude-sonnet-5-5', effort: 'high', connectionId: ACCOUNT_COOLING_ID },
    {
      use: 'nightly-scan',
      modelId: 'claude-haiku-5-5',
      effort: 'low',
      connectionId: null,
      reason: 'no-connection',
      unavailable: true,
    },
  ],
};

export const ACCOUNTS: AccountsContent = {
  subscriptions: ACCOUNT_SUBSCRIPTIONS,
  devinSubscriptions: DEVIN_SUBSCRIPTIONS,
  otherAccounts: OTHER_ACCOUNTS,
  stepsByAccount: ACCOUNT_STEPS,
  machines: ACCOUNT_MACHINES,
  providers: [
    { id: 'codex-main', label: 'ChatGPT · Personal' },
    { id: 'grok-main', label: 'SuperGrok' },
  ],
  routing: ACCOUNT_ROUTING,
};

const routingRule = (
  use: RoutingRuleRecord['use'],
  provider: string,
  modelId: string,
  thinkingLevel: string | null,
): RoutingRuleRecord => ({
  id: `rule-${use}`,
  teamId: 't1',
  use,
  provider,
  modelId,
  thinkingLevel,
  fallbackModels: null,
  machineId: null,
  requiredCapabilities: null,
  seededFromAgentId: null,
  createdAt: NOW - DAY,
  updatedAt: NOW - DAY,
});

const DEVIN_SOURCE: ModelSource = {
  runtime: 'devin',
  installed: true,
  hostname: MACHINE_REMOTE_NAME,
  machineId: MACHINE_REMOTE_ID,
  models: [...DEFAULT_DEVIN_MODELS],
};

export const accountsDefault: FixtureSet = {
  ...resourcesDefault,
  now: NOW,
  resources: {
    ...RESOURCES,
    providerSources: [
      ...RESOURCES.providerSources.map((source) =>
        source.runtime === 'pi'
          ? { ...source, provider: 'r3-gateway', providerLabel: 'R3 网关' }
          : source,
      ),
      DEVIN_SOURCE,
    ],
    routingSettings: {
      rules: [
        routingRule('coordinator', 'claude-code', 'claude-sonnet-5', 'high'),
        routingRule('session', 'r3-gateway', 'gpt-5.2', 'medium'),
        routingRule('review', 'r3-gateway', 'claude-opus-4-5', 'high'),
      ],
      policies: [],
    },
    machines: RESOURCES.machines.map((machine) => {
      const providers = PROVIDER_MACHINES.find((m) => m.id === machine.id)?.providers;
      return providers === undefined ? machine : { ...machine, providers };
    }),
    accounts: ACCOUNTS,
  },
};

export const accountsNoRunner: FixtureSet = {
  ...accountsDefault,
  resources: accountsDefault.resources && {
    ...accountsDefault.resources,
    providerSources: accountsDefault.resources.providerSources.filter(
      (source) => source.runtime === 'pi',
    ),
  },
};

export const accountsEmpty: FixtureSet = {
  ...resourcesDefault,
  now: NOW,
  resources: {
    ...RESOURCES,
    accounts: {
      subscriptions: [],
      devinSubscriptions: [],
      otherAccounts: [],
      stepsByAccount: {},
      machines: [],
      providers: [],
      routing: {
        connections: [],
        quota: [],
        edges: [],
      },
    },
  },
};
