import type { ProviderRecord, RoutingRuleRecord, TeamRoutingSettings } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { toClaudeAccount } from '../src/api/claude-accounts.js';
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

  test('subscriptions, then providers, with quota as what is left and unreachable ones marked', () => {
    expect(targets.map((target) => [target.id, target.runtime, target.unavailable])).toEqual([
      ['subscription:old', 'claude-code', true],
      ['subscription:main', 'claude-code', false],
      ['provider:rec-codex', 'pi', false],
      ['provider:rec-relay', 'pi', true],
    ]);
    expect(targets[1]?.quota).toEqual({ fiveHour: 75, week: null });
  });

  test('a rule wires to its provider by slug, Claude Code to the live subscription, and a missing provider breaks', () => {
    const settings: TeamRoutingSettings = {
      rules: [
        rule('coordinator', 'claude-code', 'claude-opus-5-5'),
        rule('review', 'openai-codex', 'gpt-6.1-sol'),
        rule('citation_check', 'deleted-provider', 'glm-5.3'),
        rule('digest', 'relay', 'x'),
      ],
      policies: [],
    };
    const [agents, claude] = ruleGraphGroups(settings, targets, options, t);
    expect(
      agents?.nodes.map((node) => [node.id, node.target ?? null, node.broken, node.tag]),
    ).toEqual([
      ['coordinator', 'subscription:main', false, 'claude-opus-5-5'],
      ['review', 'provider:rec-codex', false, 'GPT-6.1 Sol'],
      ['citation_check', null, true, 'glm-5.3'],
      ['digest', 'provider:rec-relay', true, 'x'],
    ]);
    expect(claude?.nodes).toEqual([
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
        name: '新任务',
        tag: 'GPT-6.1 Sol · 默认',
        target: 'provider:rec-codex',
        broken: false,
      },
    ]);
  });

  test('top models come first, each wired to its own provider, and one whose provider is gone breaks', () => {
    const groups = ruleGraphGroups({ rules: [], policies: [] }, targets, options, t, [
      { provider: 'openai-codex', modelId: 'gpt-6.1-sol', thinkingLevel: 'medium' },
      { provider: 'claude-code', modelId: 'claude-opus-5-5', thinkingLevel: 'high' },
      { provider: 'deleted-provider', modelId: 'glm-5.3', thinkingLevel: null },
    ]);
    expect(groups[0]?.label).toBe('常用模型');
    expect(groups[0]?.nodes.map((node) => [node.name, node.target ?? null, node.broken])).toEqual([
      ['GPT-6.1 Sol', 'provider:rec-codex', false],
      ['claude-opus-5-5', 'subscription:main', false],
      ['glm-5.3', null, true],
    ]);
  });
});
