import { describe, expect, test } from 'vitest';
import { toClaudeAccount } from '../src/api/claude-accounts.js';
import { type ModelRouting, toRoutingGraph } from '../src/api/model-routing.js';

const t = (source: string) => source;
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

describe('toRoutingGraph', () => {
  const routing: ModelRouting = {
    connections: [
      { id: 's1', vendor: 'anthropic', kind: 'subscription', models: [], available: true },
      { id: 'p1', vendor: 'anthropic', kind: 'api-key', models: [] },
      { id: 'p1', vendor: 'openai', kind: 'api-key', models: [] },
      { id: 'machine:m1', vendor: 'anthropic', kind: 'subscription', models: [], available: false },
    ],
    quota: [
      { connectionId: 'machine:m1', windows: [{ window: '5h', usedPercent: 130 }] },
    ],
    edges: [
      { use: 'coordinator', modelId: 'claude-opus-5-5', effort: 'high', connectionId: 's1' },
      { use: 'eval', modelId: 'x', effort: 'high', connectionId: null, reason: 'no-connection' },
    ],
    settings: { claudeUsage: 'subscription-only' },
  };
  const account = {
    ...toClaudeAccount(
      { id: 's1', kind: 'claude-subscription', label: 'Main', expiresAt: null, createdAt: 1 },
      NOW,
    ),
    plan: 'Max',
    windows: [{ name: 'five_hour', utilization: 0.25, resetsAt: null, observedAt: NOW }],
  };
  const graph = toRoutingGraph(routing, {
    accounts: [account],
    providers: [{ id: 'p1', label: 'OpenRouter' }],
    machineNames: new Map([['m1', 'omarchy']]),
    t,
  });

  test('names each connection once, from its account, provider or machine', () => {
    expect(graph.connections.map((c) => c.name)).toEqual([
      'Claude · Main',
      'OpenRouter',
      'Claude Code · omarchy',
    ]);
  });

  test('quota reads as what is left, never below zero, and only for reported windows', () => {
    expect(graph.connections[0]?.quota).toEqual({ fiveHour: 75, week: null });
    expect(graph.connections[2]?.quota).toEqual({ fiveHour: 0, week: null });
    expect(graph.connections[1]?.quota).toBeUndefined();
  });

  test('a use with no connection is drawn unavailable without a wire', () => {
    expect(graph.jobs[1]).toMatchObject({ id: 'eval', unavailable: true });
    expect(graph.jobs[1]?.connectionId).toBeUndefined();
    expect(graph.connections[2]?.unavailable).toBe(true);
  });
});
