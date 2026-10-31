import { expect, test } from 'vitest';
import { type RoutingConnection, resolveRouting } from './model-routing.js';

const connections = [
  { id: 'codex', vendor: 'openai', kind: 'subscription', models: ['gpt-6.1-sol'] },
  {
    id: 'claude',
    vendor: 'anthropic',
    kind: 'subscription',
    models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'],
  },
] as const satisfies readonly RoutingConnection[];

test.each([70, 71, 100])(
  'weekly usage %i routes new implementation and independent review',
  (usedPercent) => {
    const { edges } = resolveRouting(
      [{ use: 'review' }, { use: 'implementation' }],
      connections,
      [{ connectionId: 'codex', windows: [{ window: 'week', usedPercent }] }],
      {},
    );
    expect(edges[1]).toMatchObject({
      connectionId: 'claude',
      modelId: 'claude-sonnet-5-5',
      reason: 'codex-quota<=30%',
    });
    expect(edges[0]).toMatchObject({ connectionId: 'codex', modelId: 'gpt-6.1-sol' });
  },
);

test.each([
  { quota: [] },
  { quota: [{ connectionId: 'codex', windows: [{ window: 'week' as const, usedPercent: 69 }] }] },
  { quota: [{ connectionId: 'codex', windows: [{ window: '5h' as const, usedPercent: 99 }] }] },
  { quota: [{ connectionId: 'claude', windows: [{ window: 'week' as const, usedPercent: 99 }] }] },
])('unknown, sufficient or unrelated quotas do not switch implementation', ({ quota }) => {
  expect(
    resolveRouting([{ use: 'implementation' }], connections, quota, {}).edges[0],
  ).toMatchObject({ connectionId: 'codex' });
});

test('in-flight implementation preserves model, effort and connection even at exhaustion', () => {
  const use = {
    use: 'implementation' as const,
    inFlight: { modelId: 'gpt-6.1-sol', effort: 'high' as const, connectionId: 'codex' },
  };
  expect(
    resolveRouting(
      [use, { use: 'review' }],
      connections,
      [{ connectionId: 'codex', windows: [{ window: 'week', usedPercent: 100 }] }],
      {},
    ).edges,
  ).toMatchObject([{ ...use.inFlight, use: 'implementation' }, { connectionId: 'claude' }]);
  expect(resolveRouting([use], [], [], {}).edges[0]).toMatchObject({
    ...use.inFlight,
    unavailable: true,
  });
});

test.each(['manual', 'schedule'] as const)(
  '%s Claude use cannot select a paid key by default',
  (trigger) => {
    const paid: RoutingConnection[] = [{ ...connections[1], id: 'key', kind: 'api-key' }];
    expect(resolveRouting([{ use: 'coordinator', trigger }], paid, [], {}).edges[0]).toMatchObject({
      connectionId: null,
      unavailable: true,
      reason: 'subscription-only',
    });
    expect(
      resolveRouting([{ use: 'coordinator', trigger }], paid, [], { claudeUsage: 'allow-paid' })
        .edges[0],
    ).toMatchObject({ connectionId: 'key' });
  },
);

test('review parks rather than sharing the implementation vendor', () => {
  expect(
    resolveRouting([{ use: 'implementation' }, { use: 'review' }], [connections[0]], [], {})
      .edges[1],
  ).toMatchObject({ connectionId: null, unavailable: true });
});

test('an in-flight paid Claude use parks under subscription-only without changing its model', () => {
  const paid: RoutingConnection = { ...connections[1], id: 'key', kind: 'api-key' };
  const request = {
    use: 'coordinator' as const,
    inFlight: { modelId: 'claude-opus-5-5', effort: 'high' as const, connectionId: 'key' },
  };
  expect(resolveRouting([request], [paid], [], {}).edges[0]).toMatchObject({
    ...request.inFlight,
    unavailable: true,
    reason: 'subscription-only',
  });
});

test('a Claude-only team can implement while independent review remains unavailable', () => {
  expect(
    resolveRouting([{ use: 'implementation' }, { use: 'review' }], [connections[1]], [], {}).edges,
  ).toMatchObject([
    { connectionId: 'claude', modelId: 'claude-sonnet-5-5' },
    { connectionId: null, unavailable: true, modelId: 'gpt-6.1-sol' },
  ]);
});
