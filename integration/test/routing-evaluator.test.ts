import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { decisionOutput, expectedOutput } from '../eval/coordinator-routing/contract.mts';

const source = readFileSync(
  new URL('../eval/coordinator-routing/evaluator/routing.ts', import.meta.url),
  'utf8',
);
const { handler } = (await import(
  pathToFileURL(
    new URL('../../ops/langfuse/code-eval-runner/code-based-eval-handler.mjs', import.meta.url)
      .pathname,
  ).href
)) as { handler: (event: unknown) => Promise<{ scores?: Score[]; error?: unknown }> };

interface Score {
  name: string;
  value: boolean;
  dataType: string;
  comment: string;
}

const expectedBase = { askCandidates: [], blockedBy: [] };
const observedBase = {
  questions: [],
  stepStatus: 'done',
  turnTraceId: 'a'.repeat(32),
  promptSha256: 'b'.repeat(64),
};

function run(expected: unknown, output: unknown) {
  return handler({
    code: { source },
    payload: {
      observation: { input: {}, output, metadata: null, toolCalls: [] },
      experiment: { itemExpectedOutput: expected, itemMetadata: null },
    },
  });
}

async function scoresOf(expected: unknown, output: unknown) {
  const result = await run(expected, output);
  expect(result.error).toBeUndefined();
  return Object.fromEntries((result.scores ?? []).map((s) => [s.name, s.value]));
}

function route(projects: string[], blockedBy: [number, number][] = []) {
  return decisionOutput.parse({
    ...observedBase,
    decision: 'route',
    parts: projects.map((project) => ({ project, title: `work in ${project}` })),
    askCandidates: [],
    blockedBy,
  });
}

function ask(candidates: string[]) {
  return decisionOutput.parse({
    ...observedBase,
    decision: 'ask',
    parts: [],
    askCandidates: candidates,
    blockedBy: [],
  });
}

function expectRoute(projects: string[], blockedBy: [number, number][] = []) {
  return expectedOutput.parse({
    decision: 'route',
    parts: projects.map((project) => ({ project })),
    askCandidates: [],
    blockedBy,
  });
}

describe('routing evaluator', () => {
  it('scores a routed turn on decision, projects and split, ignoring part order', async () => {
    expect(await scoresOf(expectRoute(['docs', 'api']), route(['api', 'docs']))).toEqual({
      'routing.decision_ok': true,
      'routing.projects_ok': true,
      'routing.split_ok': true,
    });
  });

  it('keeps a right part count and a right decision separate from the project verdict', async () => {
    expect(await scoresOf(expectRoute(['docs']), route(['api']))).toEqual({
      'routing.decision_ok': true,
      'routing.projects_ok': false,
      'routing.split_ok': true,
    });
  });

  it('compares projects as a multiset, not a set', async () => {
    expect(await scoresOf(expectRoute(['docs', 'docs']), route(['docs', 'api']))).toMatchObject({
      'routing.projects_ok': false,
      'routing.split_ok': true,
    });
    expect(await scoresOf(expectRoute(['docs', 'docs']), route(['docs']))).toMatchObject({
      'routing.projects_ok': false,
      'routing.split_ok': false,
    });
  });

  it('fails every applicable score when the Coordinator answered instead of routing', async () => {
    expect(
      await scoresOf(
        expectRoute(['docs']),
        decisionOutput.parse({
          ...observedBase,
          decision: 'answer',
          parts: [],
          askCandidates: [],
          blockedBy: [],
        }),
      ),
    ).toEqual({
      'routing.decision_ok': false,
      'routing.projects_ok': false,
      'routing.split_ok': false,
    });
  });

  it('scores an ask on the exact candidate set and nothing about projects', async () => {
    const expected = expectedOutput.parse({
      ...expectedBase,
      decision: 'ask',
      parts: [],
      askCandidates: ['api', 'docs'],
    });
    expect(await scoresOf(expected, ask(['docs', 'api']))).toEqual({
      'routing.decision_ok': true,
      'routing.ask_ok': true,
    });
    expect(await scoresOf(expected, ask(['docs', 'api', 'web']))).toEqual({
      'routing.decision_ok': true,
      'routing.ask_ok': false,
    });
    expect(await scoresOf(expected, route(['docs']))).toEqual({
      'routing.decision_ok': false,
      'routing.ask_ok': false,
    });
  });

  it('scores an expected answer on the decision alone', async () => {
    const expected = expectedOutput.parse({ ...expectedBase, decision: 'answer', parts: [] });
    expect(await scoresOf(expected, route(['docs']))).toEqual({ 'routing.decision_ok': false });
  });

  it('scores dependencies only for items that expect them, by part index and direction', async () => {
    expect(
      await scoresOf(expectRoute(['api', 'docs'], [[1, 0]]), route(['api', 'docs'], [[1, 0]])),
    ).toMatchObject({
      'routing.blocked_by_ok': true,
    });
    expect(
      await scoresOf(expectRoute(['api', 'docs'], [[1, 0]]), route(['api', 'docs'], [[0, 1]])),
    ).toMatchObject({
      'routing.blocked_by_ok': false,
    });
    expect(
      await scoresOf(expectRoute(['api', 'docs'], [[1, 0]]), route(['api', 'docs'])),
    ).toMatchObject({
      'routing.blocked_by_ok': false,
    });
    expect(
      await scoresOf(expectRoute(['api', 'docs']), route(['api', 'docs'], [[1, 0]])),
    ).not.toHaveProperty('routing.blocked_by_ok');
  });

  it('returns scores Langfuse accepts: unique names, boolean type and a comment', async () => {
    const result = await run(expectRoute(['docs', 'api'], [[1, 0]]), route(['docs']));
    const scores = result.scores ?? [];
    expect(new Set(scores.map((s) => s.name)).size).toBe(scores.length);
    for (const s of scores) {
      expect(s.dataType).toBe('BOOLEAN');
      expect(typeof s.value).toBe('boolean');
      expect(s.comment.length).toBeGreaterThan(0);
    }
  });

  it.each([
    ['a missing expected output', undefined, route(['docs'])],
    ['an expected output that is not a routing record', { decision: 'route' }, route(['docs'])],
    ['a missing output', expectRoute(['docs']), undefined],
    [
      'an output with an unknown decision',
      expectRoute(['docs']),
      { ...route(['docs']), decision: 'hold' },
    ],
  ])('fails the execution instead of scoring %s', async (_label, expected, output) => {
    const result = await run(expected, output);
    expect(result.scores).toBeUndefined();
    expect(result.error).toMatchObject({ code: 'USER_CODE_ERROR' });
  });
});
