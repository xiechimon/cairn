import type { ProviderRecord, RoutingRuleRecord, TeamRoutingSettings } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { toAntigravityAccount } from '../src/api/antigravity-subscriptions.js';
import { toClaudeAccount } from '../src/api/claude-accounts.js';
import { toDevinAccount } from '../src/api/devin-subscriptions.js';
import { type ModelRouting, routingTargets, ruleGraphGroups } from '../src/api/model-routing.js';
import type { ModelOption } from '../src/fixtures/records.js';

const t = (source: string, vars?: Record<string, unknown>) =>
  source.replace(/\{(\w+)\}/g, (_, key: string) => String(vars?.[key] ?? ''));
const NOW = 1_000_000;

describe('toClaudeAccount', () => {
  test('a pre-#2331 subscription without the new fields still renders', () => {
    const account = toClaudeAccount(
      { id: 's1', kind: 'claude-subscription', label: 'A', expiresAt: null, createdAt: 1 },
      NOW,
    );
    expect(account).toMatchObject({ vendor: 'claude', state: 'ok', plan: null, windows: [] });
    expect(account.stepsLast24h).toBeNull();
  });

  test('an expired token without a server state reads as expired', () => {
    const account = toClaudeAccount(
      { id: 's1', kind: 'claude-subscription', label: 'A', expiresAt: NOW - 1, createdAt: 1 },
      NOW,
    );
    expect(account.state).toBe('expired');
  });
});

const provider = (id: string, providerId: string, label: string) =>
  ({ id, providerId, label }) as ProviderRecord;

const rule = (use: RoutingRuleRecord['use'], providerId: string, modelId: string) =>
  ({ id: `r-${use}`, use, provider: providerId, modelId }) as RoutingRuleRecord;

describe('routing targets and the rule graph', () => {
  const expired = toClaudeAccount(
    { id: 'old', kind: 'claude-subscription', label: 'Old', expiresAt: NOW - 1, createdAt: 1 },
    NOW,
  );
  const live = {
    ...toClaudeAccount(
      { id: 'main', kind: 'claude-subscription', label: 'Main', expiresAt: null, createdAt: 2 },
      NOW,
    ),
    windows: [{ name: 'five_hour', utilization: 0.25, resetsAt: null, observedAt: NOW }],
  };
  const routing: ModelRouting = {
    connections: [
      { id: 'rec-relay', vendor: 'openai', kind: 'api-key', models: [], available: false },
    ],
    quota: [],
    edges: [],
  };
  const targets = routingTargets({
    subscriptions: [expired, live],
    providers: [provider('rec-codex', 'openai-codex', 'ChatGPT'), provider('rec-relay', 'relay', 'Relay')],
    routing,
  });
  const options: ModelOption[] = [
    {
      runtime: 'pi',
      provider: 'openai-codex',
      providerLabel: 'ChatGPT',
      modelId: 'gpt-6.1-sol',
      modelName: 'GPT-6.1 Sol',
    },
  ];

  test('subscriptions, then providers, with unreachable ones marked', () => {
    expect(targets.map((target) => [target.id, target.runtime, target.unavailable])).toEqual([
      ['subscription:old', 'claude-code', true],
      ['subscription:main', 'claude-code', false],
      ['provider:rec-codex', 'pi', false],
      ['provider:rec-relay', 'pi', true],
    ]);
  });

  test('a rule wires to its provider by slug, Claude Code to the live subscription, and a missing provider breaks', () => {
    const settings: TeamRoutingSettings = {
      rules: [
        rule('coordinator', 'claude-code', 'claude-opus-5-5'),
        rule('review', 'openai-codex', 'gpt-6.1-sol'),
        rule('compaction', 'deleted-provider', 'glm-5.3'),
      ],
      policies: [],
    };
    const groups = ruleGraphGroups(settings, targets, options, t);
    expect(
      groups[0]?.nodes.map((node) => [node.id, node.target ?? null, node.broken, node.tag]),
    ).toEqual([
      ['coordinator', 'subscription:main', false, 'claude-opus-5-5'],
      ['review', 'provider:rec-codex', false, 'GPT-6.1 Sol'],
      ['compaction', null, true, 'glm-5.3'],
    ]);
    expect(groups.map((group) => group.label)).toEqual(['Coordinator 与任务']);
  });

  test('the all-Claude-models node is drawn only while a project runs on Claude Code', () => {
    const settings: TeamRoutingSettings = {
      rules: [rule('coordinator', 'claude-code', 'claude-opus-5-5')],
      policies: [],
    };
    const elsewhere = ruleGraphGroups(settings, targets, options, t, [
      {
        id: 'p1:coordinator',
        name: 'web · Coordinator',
        choice: { provider: 'openai-codex', modelId: 'gpt-6.1-sol', thinkingLevel: null },
      },
    ]);
    expect(elsewhere.some((group) => group.label === 'Claude Code')).toBe(false);
    const onClaude = ruleGraphGroups(settings, targets, options, t, [
      {
        id: 'p1:coordinator',
        name: 'web · Coordinator',
        choice: { provider: 'claude-code', modelId: 'claude-opus-5-5', thinkingLevel: null },
      },
    ]);
    expect(onClaude.find((group) => group.label === 'Claude Code')?.nodes).toEqual([
      { id: 'claude-models', name: '所有 Claude 模型', target: 'subscription:main' },
    ]);
  });

  test('with no session rule the session default is drawn and labelled as the default', () => {
    const [agents] = ruleGraphGroups(
      {
        rules: [],
        policies: [],
        sessionDefault: { reason: 'provider', provider: 'openai-codex', modelId: 'gpt-6.1-sol' },
      },
      targets,
      options,
      t,
    );
    expect(agents?.nodes).toEqual([
      {
        id: 'session',
        name: '任务',
        tag: 'GPT-6.1 Sol · 默认',
        target: 'provider:rec-codex',
        broken: false,
      },
    ]);
  });

  test('project model choices follow the team rules, each wired to its own provider, and one whose provider is gone breaks', () => {
    const groups = ruleGraphGroups({ rules: [], policies: [] }, targets, options, t, [
      {
        id: 'p1:session',
        name: 'web · 任务',
        choice: { provider: 'openai-codex', modelId: 'gpt-6.1-sol', thinkingLevel: 'medium' },
      },
      {
        id: 'p2:coordinator',
        name: 'site · Coordinator',
        choice: { provider: 'deleted-provider', modelId: 'glm-5.3', thinkingLevel: null },
      },
    ]);
    expect(groups.map((group) => group.label).slice(0, 1)).toEqual(['项目单独设置']);
    expect(groups[0]?.nodes.map((node) => [node.name, node.tag, node.target ?? null, node.broken])).toEqual([
      ['web · 任务', 'GPT-6.1 Sol', 'provider:rec-codex', false],
      ['site · Coordinator', 'glm-5.3', null, true],
    ]);
  });
});

describe('devin subscription targets', () => {
  const expiredDevin = toDevinAccount(
    { id: 'd-old', kind: 'devin-subscription', label: 'Old Devin', expiresAt: NOW - 1, createdAt: 1 },
    NOW,
  );
  const liveDevin = toDevinAccount(
    { id: 'd-main', kind: 'devin-subscription', label: 'Devin', expiresAt: null, createdAt: 2 },
    NOW,
  );
  const targets = routingTargets({
    subscriptions: [],
    devinSubscriptions: [expiredDevin, liveDevin],
    providers: [],
    routing: { connections: [], quota: [], edges: [] },
  });

  test('devin accounts become devin targets, expired ones marked unavailable', () => {
    expect(targets.map((target) => [target.id, target.runtime, target.unavailable])).toEqual([
      ['subscription:d-old', 'devin', true],
      ['subscription:d-main', 'devin', false],
    ]);
  });

  test('a devin rule wires to the live devin subscription; the devin group waits for a project on Devin', () => {
    const settings: TeamRoutingSettings = {
      rules: [rule('session', 'devin', 'devin-swe-2')],
      policies: [],
    };
    const groups = ruleGraphGroups(settings, targets, [], t);
    const agents = groups.find((group) => group.label === 'Coordinator 与任务');
    expect(
      agents?.nodes.map((node) => [node.id, node.target ?? null, node.broken, node.tag]),
    ).toEqual([['session', 'subscription:d-main', false, 'devin-swe-2']]);
    expect(groups.some((group) => group.label === 'Devin')).toBe(false);
    const withProject = ruleGraphGroups(settings, targets, [], t, [
      {
        id: 'p1:coordinator',
        name: 'web · Coordinator',
        choice: { provider: 'devin', modelId: 'devin-swe-2', thinkingLevel: null },
      },
    ]);
    expect(withProject.find((group) => group.label === 'Devin')?.nodes).toEqual([
      { id: 'devin-models', name: '所有 Devin 模型', target: 'subscription:d-main' },
    ]);
    expect(withProject.some((group) => group.label === 'Claude Code')).toBe(false);
  });
});

describe('antigravity subscription targets', () => {
  const expiredAntigravity = toAntigravityAccount(
    {
      id: 'a-old',
      kind: 'antigravity-subscription',
      label: 'Old Antigravity',
      hasToken: false,
      expiresAt: NOW - 1,
      createdAt: 1,
    },
    NOW,
  );
  const liveAntigravity = toAntigravityAccount(
    {
      id: 'a-main',
      kind: 'antigravity-subscription',
      label: 'Antigravity',
      hasToken: false,
      expiresAt: null,
      createdAt: 2,
    },
    NOW,
  );
  const targets = routingTargets({
    subscriptions: [],
    antigravitySubscriptions: [expiredAntigravity, liveAntigravity],
    providers: [],
    routing: { connections: [], quota: [], edges: [] },
  });

  test('antigravity accounts become antigravity targets with expiry reflected', () => {
    expect(targets.map((target) => [target.id, target.runtime, target.unavailable])).toEqual([
      ['subscription:a-old', 'antigravity', true],
      ['subscription:a-main', 'antigravity', false],
    ]);
  });

  test.each(['unavailable', 'missing_local_login'] as const)(
    'a host subscription with Runner login %s is unavailable',
    (runnerLogin) => {
      expect(routingTargets({
        subscriptions: [],
        antigravitySubscriptions: [{ ...liveAntigravity, runnerLogin }],
        providers: [],
        routing: undefined,
      })[0]?.unavailable).toBe(true);
    },
  );

  test('an antigravity rule wires to the live antigravity subscription', () => {
    const settings: TeamRoutingSettings = {
      rules: [rule('coordinator', 'antigravity', 'gemini-4-carbon')],
      policies: [],
    };
    const groups = ruleGraphGroups(settings, targets, [], t, [
      {
        id: 'p1:coordinator',
        name: 'web · Coordinator',
        choice: { provider: 'antigravity', modelId: 'gemini-4-carbon', thinkingLevel: null },
      },
    ]);
    const agents = groups.find((group) => group.label === 'Coordinator 与任务');
    const antigravity = groups.find((group) => group.label === 'Antigravity');
    expect(
      agents?.nodes.map((node) => [node.id, node.target ?? null, node.broken, node.tag]),
    ).toEqual([['coordinator', 'subscription:a-main', false, 'gemini-4-carbon']]);
    expect(antigravity?.nodes).toEqual([
      {
        id: 'antigravity-models',
        name: '所有 Antigravity 模型',
        target: 'subscription:a-main',
      },
    ]);
  });
});
