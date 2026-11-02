import type {
  AccountMachine,
  AccountStep,
  ClaudeSubscriptionWire,
  StickyThread,
  SubscriptionAccount,
} from '../api/claude-accounts.js';
import type { ModelRouting } from '../api/model-routing.js';
import { MACHINE_ID, MACHINE_NAME, MACHINE_REMOTE_ID, MACHINE_REMOTE_NAME, r7 } from './core.js';
import type { FixtureSet } from './records.js';
import { RESOURCES, resourcesDefault } from './resources.js';

export interface AccountsContent {
  subscriptions: ClaudeSubscriptionWire[];
  otherAccounts: SubscriptionAccount[];
  stepsByAccount: Record<string, AccountStep[]>;
  stickiness: StickyThread[];
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

export const ACCOUNT_SUBSCRIPTIONS: ClaudeSubscriptionWire[] = [
  {
    id: ACCOUNT_OK_ID,
    kind: 'claude-subscription',
    label: 'Personal',
    expiresAt: NOW + 300 * DAY,
    createdAt: NOW - 40 * DAY,
    plan: 'max',
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
    kind: 'claude-subscription',
    label: 'Work',
    expiresAt: null,
    createdAt: NOW - 12 * DAY,
    plan: 'pro',
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
    kind: 'claude-subscription',
    label: 'Old laptop',
    expiresAt: NOW - 2 * DAY,
    createdAt: NOW - 400 * DAY,
    plan: 'pro',
    state: 'expired',
    cooldownUntil: null,
    windows: [],
    lastUsedAt: NOW - 5 * DAY,
    stepsLast24h: 0,
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
};

export const ACCOUNT_STICKINESS: StickyThread[] = [
  {
    threadId: 'th-1',
    title: 'Daemon claim loop rework',
    subscriptionId: ACCOUNT_OK_ID,
    since: NOW - 114 * MINUTE,
  },
  {
    threadId: 'th-4',
    title: 'Account management page',
    subscriptionId: ACCOUNT_COOLING_ID,
    since: NOW - 3 * HOUR - 16 * MINUTE,
  },
];

export const ACCOUNT_MACHINES: AccountMachine[] = [
  { id: MACHINE_REMOTE_ID, name: MACHINE_REMOTE_NAME },
  { id: MACHINE_ID, name: MACHINE_NAME },
];

const CLAUDE_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'];
const REMOTE_CLAUDE = `machine:${MACHINE_REMOTE_ID}`;

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
      id: REMOTE_CLAUDE,
      vendor: 'anthropic',
      kind: 'subscription',
      models: CLAUDE_MODELS,
      available: true,
    },
  ],
  quota: [
    {
      connectionId: REMOTE_CLAUDE,
      windows: [
        { window: '5h', usedPercent: 31, resetsAt: NOW + 3 * HOUR, reportedAt: NOW - MINUTE },
        { window: 'week', usedPercent: 54, resetsAt: NOW + 4 * DAY, reportedAt: NOW - MINUTE },
      ],
    },
  ],
  edges: [
    { use: 'coordinator', modelId: 'claude-opus-5-5', effort: 'high', connectionId: ACCOUNT_OK_ID },
    { use: 'implementation', modelId: 'gpt-6.1-sol', effort: 'high', connectionId: 'codex-main' },
    { use: 'review', modelId: 'claude-sonnet-5-5', effort: 'high', connectionId: ACCOUNT_OK_ID },
    { use: 'mechanical', modelId: 'claude-haiku-5-5', effort: 'low', connectionId: REMOTE_CLAUDE },
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
  settings: { claudeUsage: 'subscription-only' },
};

export const ACCOUNTS: AccountsContent = {
  subscriptions: ACCOUNT_SUBSCRIPTIONS,
  otherAccounts: OTHER_ACCOUNTS,
  stepsByAccount: ACCOUNT_STEPS,
  stickiness: ACCOUNT_STICKINESS,
  machines: ACCOUNT_MACHINES,
  providers: [
    { id: 'codex-main', label: 'ChatGPT · Personal' },
    { id: 'grok-main', label: 'SuperGrok' },
  ],
  routing: ACCOUNT_ROUTING,
};

export const accountsDefault: FixtureSet = {
  ...resourcesDefault,
  now: NOW,
  resources: { ...RESOURCES, accounts: ACCOUNTS },
};

export const accountsEmpty: FixtureSet = {
  ...resourcesDefault,
  now: NOW,
  resources: {
    ...RESOURCES,
    accounts: {
      subscriptions: [],
      otherAccounts: [],
      stepsByAccount: {},
      stickiness: [],
      machines: [],
      providers: [],
      routing: {
        connections: [],
        quota: [],
        edges: [],
        settings: { claudeUsage: 'subscription-only' },
      },
    },
  },
};
