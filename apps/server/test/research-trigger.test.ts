import { afterEach, describe, expect, test } from 'vitest';
import { build, buildFeedback, message, step, todo } from '../src/db/schema.js';
import { newRecordId, newUuidv7 } from '../src/lib/ids.js';
import { buildCiFixPrompt } from '../src/services/ci-loop.js';
import {
  isInfraFailure,
  readStuckBuildState,
  type StuckSignals,
  stuckResearchReason,
} from '../src/services/research-trigger.js';
import { bootServer, postProject, type TestServer } from './helpers.js';

const quiet: StuckSignals = {
  ciRed: false,
  ciFixRounds: 0,
  ciFixRoundsMax: 3,
  rejectionsInRound: 0,
  infraFailure: false,
  requestedInRound: false,
};

describe('stuckResearchReason', () => {
  test.each([
    ['red at round 1', { ciRed: true, ciFixRounds: 0 }, null],
    ['red after one fix round', { ciRed: true, ciFixRounds: 1 }, null],
    ['red at the last retry', { ciRed: true, ciFixRounds: 2 }, 'ci-last-retry'],
    ['green at the last retry', { ciRed: false, ciFixRounds: 2 }, null],
    ['red past the cap', { ciRed: true, ciFixRounds: 3 }, null],
    ['first rejection', { rejectionsInRound: 1 }, null],
    ['second rejection', { rejectionsInRound: 2 }, 'second-rejection'],
    ['infra-red CI at the last retry', { ciRed: true, ciFixRounds: 2, infraFailure: true }, null],
    ['infra failure on the second rejection', { rejectionsInRound: 2, infraFailure: true }, null],
    [
      'already requested this round (CI)',
      { ciRed: true, ciFixRounds: 2, requestedInRound: true },
      null,
    ],
    [
      'already requested this round (rejection)',
      { rejectionsInRound: 2, requestedInRound: true },
      null,
    ],
  ] satisfies [string, Partial<StuckSignals>, string | null][])('%s', (_name, patch, expected) => {
    expect(stuckResearchReason({ ...quiet, ...patch })).toBe(expected);
  });
});

describe('isInfraFailure', () => {
  test('provider and quota errors are infra; a plain failure and no error are not', () => {
    expect(isInfraFailure('Anthropic API overloaded (529)')).toBe(true);
    expect(isInfraFailure('HTTP 402 payment required')).toBe(true);
    expect(isInfraFailure('type error in src/a.ts')).toBe(false);
    expect(isInfraFailure('')).toBe(false);
    expect(isInfraFailure(null)).toBe(false);
  });
});

const disposables: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposables.splice(0)) dispose();
});

async function seedBuild(s: TestServer) {
  const projectId = await postProject(s.app, 'trigger');
  const buildId = newUuidv7();
  s.db
    .insert(todo)
    .values({
      id: 'todo-1',
      teamId: s.team.id,
      projectId,
      title: 'Fix it',
      phase: 'review',
      phaseAt: 1,
      seqNum: 5,
      latestBuildId: buildId,
    })
    .run();
  s.db
    .insert(build)
    .values({
      id: buildId,
      todoId: 'todo-1',
      withPlan: false,
      prevPhase: 'todo',
      triggerSource: 'user',
      createdAt: 1,
    })
    .run();
  return buildId;
}

function addFeedback(s: TestServer, buildId: string, kind: 'revision' | 'restart', at: number) {
  s.db
    .insert(buildFeedback)
    .values({
      id: newRecordId(),
      buildId,
      kind,
      side: 'build',
      feedback: 'no',
      actor: 'u',
      createdAt: at,
    })
    .run();
}

describe('readStuckBuildState', () => {
  test('counts CI fix rounds, rejections in the round, the round number and the infra flag from rows', async () => {
    const s = bootServer();
    disposables.push(() => s.dispose());
    const buildId = await seedBuild(s);
    for (const round of [1, 2]) {
      s.db
        .insert(step)
        .values({
          id: newRecordId(),
          buildId,
          kind: 'build',
          status: 'done',
          prompt: buildCiFixPrompt({
            prNumber: 3,
            prUrl: null,
            round,
            failures: [{ name: 'lint', conclusion: 'failure', summary: 'lint failed' }],
          }),
          createdAt: 10 + round,
        })
        .run();
    }
    addFeedback(s, buildId, 'revision', 20);
    addFeedback(s, buildId, 'revision', 21);
    expect(readStuckBuildState(s.db, buildId)).toEqual({
      round: 0,
      ciFixRounds: 2,
      rejectionsInRound: 2,
      infraFailure: false,
      requestedInRound: false,
    });
  });

  test('a restart opens a new round: earlier rejections no longer count and the round number advances', async () => {
    const s = bootServer();
    disposables.push(() => s.dispose());
    const buildId = await seedBuild(s);
    addFeedback(s, buildId, 'revision', 20);
    addFeedback(s, buildId, 'revision', 21);
    addFeedback(s, buildId, 'restart', 30);
    addFeedback(s, buildId, 'revision', 40);
    const state = readStuckBuildState(s.db, buildId);
    expect(state.round).toBe(1);
    expect(state.rejectionsInRound).toBe(1);
  });

  test('a provider outage on the build is an infra failure, and a request message for this round is seen', async () => {
    const s = bootServer();
    disposables.push(() => s.dispose());
    const buildId = await seedBuild(s);
    s.db.update(build).set({ errorMessage: 'API overloaded (529)' }).run();
    s.db
      .insert(message)
      .values({
        id: 'm1',
        conversationId: buildId,
        role: 'system',
        content: JSON.stringify({ kind: 'research-requested', todoId: 't', round: 0 }),
        createdAt: 5,
      })
      .run();
    const state = readStuckBuildState(s.db, buildId);
    expect(state.infraFailure).toBe(true);
    expect(state.requestedInRound).toBe(true);
  });
});
