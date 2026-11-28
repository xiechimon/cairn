import { describe, expect, test } from 'vitest';
import {
  type CapabilityCandidate,
  classifyDifficulty,
  type RouteWorkRequest,
  routeWork,
} from './capability-routing.js';
import { stepAttributes } from './genai-conventions.js';

const claudeOn = (machineId: string, over: Partial<CapabilityCandidate> = {}) =>
  ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'].map(
    (modelId): CapabilityCandidate => ({
      harness: 'claude-code',
      provider: 'claude-code',
      modelId,
      machineId,
      available: true,
      weeklyUsedPercent: null,
      ...over,
    }),
  );

const codexOn = (
  machineId: string,
  over: Partial<CapabilityCandidate> = {},
): CapabilityCandidate => ({
  harness: 'pi',
  provider: 'openai-codex',
  modelId: 'gpt-6.1-sol',
  machineId,
  available: true,
  weeklyUsedPercent: null,
  ...over,
});

const build = (difficulty: RouteWorkRequest['difficulty']): RouteWorkRequest => ({
  kind: 'build',
  difficulty,
});

describe('implementation routing across caller-ordered tier candidates', () => {
  test('primary source serves all tiers when healthy and secondary takes over on outage', () => {
    const orderedForHard: CapabilityCandidate[] = [
      {
        harness: 'pi',
        provider: 'primary-api',
        modelId: 'primary-pro',
        machineId: 'm1',
        available: true,
        weeklyUsedPercent: null,
      },
      {
        harness: 'pi',
        provider: 'primary-api',
        modelId: 'primary-mid',
        machineId: 'm1',
        available: true,
        weeklyUsedPercent: null,
      },
      codexOn('m1'),
    ];
    const healthy = routeWork(build('hard'), orderedForHard);
    expect(healthy.chosen).toMatchObject({ provider: 'primary-api', modelId: 'primary-pro' });
    expect(healthy.desired).toEqual({ provider: 'primary-api', modelId: 'primary-pro' });
    expect(healthy.fellBack).toBe(false);

    const degraded = routeWork(build('hard'), [
      { ...orderedForHard[0]!, available: false },
      { ...orderedForHard[1]!, available: false },
      codexOn('m1'),
    ]);
    expect(degraded.chosen).toMatchObject({ provider: 'openai-codex', modelId: 'gpt-6.1-sol' });
    expect(degraded.desired).toEqual({ provider: 'primary-api', modelId: 'primary-pro' });
    expect(degraded.fellBack).toBe(true);
  });

  test('standard and easy respect the ordered tier list passed in', () => {
    const standardOrder: CapabilityCandidate[] = [
      {
        harness: 'claude-code',
        provider: 'claude-code',
        modelId: 'claude-sonnet-5-5',
        machineId: 'm1',
        available: true,
        weeklyUsedPercent: null,
      },
      codexOn('m1'),
    ];
    expect(routeWork(build('standard'), standardOrder).chosen?.modelId).toBe('claude-sonnet-5-5');

    const easyOrder: CapabilityCandidate[] = [
      {
        harness: 'claude-code',
        provider: 'claude-code',
        modelId: 'claude-haiku-5-5',
        machineId: 'm1',
        available: true,
        weeklyUsedPercent: null,
      },
      ...standardOrder,
    ];
    expect(routeWork(build('easy'), easyOrder).chosen?.modelId).toBe('claude-haiku-5-5');
  });

  test('a banned model is never chosen even if a machine offers it', () => {
    const banned: CapabilityCandidate = { ...codexOn('m1'), modelId: 'gpt-6-astra' };
    const decision = routeWork(build('hard'), [banned, ...claudeOn('m1')]);
    expect(decision.chosen?.modelId).toBe('claude-opus-5-5');
    expect(decision.fellBack).toBe(true);
  });
});

describe('failure modes', () => {
  test('primary source unavailable: falls back to secondary tier/source and records rejection', () => {
    const decision = routeWork(build('hard'), [
      codexOn('m1', { available: false }),
      ...claudeOn('m1'),
    ]);
    expect(decision.chosen?.modelId).toBe('claude-opus-5-5');
    expect(decision.fellBack).toBe(true);
    expect(decision.rejected).toContainEqual({
      modelId: 'gpt-6.1-sol',
      machineId: 'm1',
      why: 'unavailable',
    });
  });

  test('quota exhausted: a candidate at 70% weekly use is rejected', () => {
    const decision = routeWork(build('hard'), [
      codexOn('m1', { weeklyUsedPercent: 70 }),
      ...claudeOn('m1'),
    ]);
    expect(decision.chosen?.modelId).toBe('claude-opus-5-5');
    expect(decision.rejected).toContainEqual({
      modelId: 'gpt-6.1-sol',
      machineId: 'm1',
      why: 'quota',
    });
  });

  test('harness missing on the machine: the candidate is rejected with a harness reason', () => {
    const decision = routeWork(build('standard'), [
      {
        harness: 'claude-code',
        provider: 'claude-code',
        modelId: 'claude-sonnet-5-5',
        machineId: 'm1',
        available: false,
        unavailableWhy: 'harness-missing',
        weeklyUsedPercent: null,
      },
      {
        harness: 'claude-code',
        provider: 'claude-code',
        modelId: 'claude-sonnet-5-5',
        machineId: 'm2',
        available: true,
        weeklyUsedPercent: null,
      },
    ]);
    expect(decision.chosen).toMatchObject({ modelId: 'claude-sonnet-5-5', machineId: 'm2' });
    expect(decision.rejected).toContainEqual({
      modelId: 'claude-sonnet-5-5',
      machineId: 'm1',
      why: 'harness-missing',
    });
  });

  test('nothing available at all is unroutable with a reason', () => {
    expect(routeWork(build('standard'), []).chosen).toBeNull();
  });

  test('an in-flight step keeps its model even when it is now the worst choice', () => {
    const pinned = codexOn('m1', { weeklyUsedPercent: 100, available: false });
    const decision = routeWork(
      {
        ...build('easy'),
        inFlight: { provider: 'openai-codex', modelId: 'gpt-6.1-sol', machineId: 'm1' },
      },
      [pinned, ...claudeOn('m1')],
    );
    expect(decision.chosen).toMatchObject({ provider: 'openai-codex', modelId: 'gpt-6.1-sol' });
    expect(decision.reason).toBe('in-flight: keeps recorded model');
  });
});

describe('classifyDifficulty', () => {
  test('a stored request difficulty wins over markers and length', () => {
    for (const difficulty of ['easy', 'standard', 'hard'] as const) {
      expect(
        classifyDifficulty({
          title: 't',
          spec: 'x'.repeat(5000),
          request: { difficulty },
        }),
      ).toBe(difficulty);
    }
    expect(
      classifyDifficulty({ title: 't', spec: 'difficulty:hard', request: { difficulty: 'easy' } }),
    ).toBe('easy');
  });

  test('an explicit marker wins', () => {
    expect(classifyDifficulty({ title: 't', spec: 'difficulty:hard fix the typo' })).toBe('hard');
    expect(classifyDifficulty({ title: 't', spec: `difficulty:easy ${'x'.repeat(5000)}` })).toBe(
      'easy',
    );
  });

  test('long specs are hard, short are easy, the rest standard', () => {
    expect(classifyDifficulty({ title: 't', spec: 'x'.repeat(4000) })).toBe('hard');
    expect(classifyDifficulty({ title: 'Fix typo', spec: 'one line' })).toBe('easy');
    expect(classifyDifficulty({ title: 't', spec: 'x'.repeat(800) })).toBe('standard');
  });
});

describe('the decision reaches the step span', () => {
  test('stepAttributes carries harness, model, difficulty, reason and rejected candidates', () => {
    const attributes = stepAttributes({
      stepId: 's1',
      kind: 'session',
      checkpointCommit: null,
      route: {
        harness: 'pi',
        provider: 'openai-codex',
        modelId: 'gpt-6.1-sol',
        difficulty: 'hard',
        reason: 'hard: gpt-6.1-sol ranked first',
        rejected: [{ modelId: 'claude-opus-5-5', machineId: 'm1', why: 'quota' }],
      },
    });
    expect(attributes).toMatchObject({
      'cairn.route.harness': 'pi',
      'cairn.route.model': 'gpt-6.1-sol',
      'cairn.route.difficulty': 'hard',
      'cairn.route.reason': 'hard: gpt-6.1-sol ranked first',
      'cairn.route.rejected': '[{"modelId":"claude-opus-5-5","machineId":"m1","why":"quota"}]',
    });
  });
});
