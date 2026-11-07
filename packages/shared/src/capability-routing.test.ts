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

describe('implementation routing by difficulty', () => {
  const all = [...claudeOn('m1'), codexOn('m1')];

  test('hard work goes to the strongest available model', () => {
    const decision = routeWork(build('hard'), all);
    expect(decision.chosen).toMatchObject({ modelId: 'gpt-6.1-sol', harness: 'pi' });
    expect(decision.reason).toBe('hard: gpt-6.1-sol ranked first');
  });

  test('standard work goes to Sonnet', () => {
    expect(routeWork(build('standard'), all).chosen?.modelId).toBe('claude-sonnet-5-5');
  });

  test('easy work goes to Haiku', () => {
    expect(routeWork(build('easy'), all).chosen?.modelId).toBe('claude-haiku-5-5');
  });

  test('a banned model is never chosen even if a machine offers it', () => {
    const banned: CapabilityCandidate = { ...codexOn('m1'), modelId: 'gpt-6-astra' };
    const decision = routeWork(build('hard'), [banned, ...claudeOn('m1')]);
    expect(decision.chosen?.modelId).toBe('claude-opus-5-5');
  });
});

describe('failure modes', () => {
  test('no Codex connection: hard work falls to Opus and the decision says why', () => {
    const decision = routeWork(build('hard'), claudeOn('m1'));
    expect(decision.chosen?.modelId).toBe('claude-opus-5-5');
    expect(decision.rejected).toContainEqual({
      modelId: 'gpt-6.1-sol',
      machineId: null,
      why: 'no-candidate',
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
      ...claudeOn('m1', { available: false, unavailableWhy: 'harness-missing' }),
      ...claudeOn('m2'),
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
