import { expect, test } from 'vitest';
import {
  coordinatorCanAnswer,
  modelSourceCount,
  firstRunComplete,
  firstRunSteps,
  nextOpenStep,
} from '../src/board/first-run-checklist-model.js';

const done = { modelSources: 1, machinesOnline: 1, coordinatorCanAnswer: true };

test('nothing is configured on a fresh install: all three steps are open', () => {
  const steps = firstRunSteps({ modelSources: 0, machinesOnline: 0, coordinatorCanAnswer: false });
  expect(steps?.map((s) => [s.id, s.done])).toEqual([
    ['model-source', false],
    ['machine', false],
    ['coordinator', false],
  ]);
  expect(firstRunComplete(steps)).toBe(false);
});

test('each step reads its own fact', () => {
  expect(firstRunSteps({ ...done, machinesOnline: 0 })?.map((s) => s.done)).toEqual([
    true,
    false,
    true,
  ]);
  expect(firstRunSteps({ ...done, modelSources: 0 })?.map((s) => s.done)).toEqual([
    false,
    true,
    true,
  ]);
});

test('the checklist is complete, and so disappears, once every step is done', () => {
  expect(firstRunComplete(firstRunSteps(done))).toBe(true);
});

test('while any fact is still loading the checklist stays hidden instead of flashing', () => {
  expect(firstRunSteps({ ...done, machinesOnline: undefined })).toBeNull();
  expect(firstRunComplete(firstRunSteps({ ...done, modelSources: undefined }))).toBe(true);
});

test('the Coordinator needs a routing facade with a model to answer', () => {
  expect(coordinatorCanAnswer(undefined)).toBeUndefined();
  const base = { chief: {}, watches: [], wakes: [], context: null };
  expect(coordinatorCanAnswer({ ...base, agentActor: null } as never)).toBe(false);
  expect(coordinatorCanAnswer({ ...base, agentActor: { modelId: null } } as never)).toBe(false);
  expect(coordinatorCanAnswer({ ...base, agentActor: { modelId: 'm' } } as never)).toBe(true);
});

test('a team provider record is a model source', () => {
  expect(modelSourceCount([{ id: 'p1' }], [])).toBe(1);
});

test('a machine-local login reported as an available connection is a model source with no provider record', () => {
  expect(modelSourceCount([], [{ id: 'machine:m1', available: true }])).toBe(1);
});

test('an unavailable connection (expired login, offline machine) is not a model source', () => {
  expect(modelSourceCount([], [{ id: 'machine:m1', available: false }])).toBe(0);
});

test('a connection that does not report availability counts as usable', () => {
  expect(modelSourceCount([], [{ id: 'c1' }])).toBe(1);
});

test('nothing configured is zero sources, and still loading is unknown', () => {
  expect(modelSourceCount([], [])).toBe(0);
  expect(modelSourceCount(undefined, [])).toBeUndefined();
  expect(modelSourceCount([], undefined)).toBeUndefined();
});

test('the next open step follows the fixed order for every missing combination', () => {
  const next = (modelSources: number, machinesOnline: number, canAnswer: boolean) =>
    nextOpenStep(firstRunSteps({ modelSources, machinesOnline, coordinatorCanAnswer: canAnswer }));
  expect(next(0, 0, false)).toBe('model-source');
  expect(next(0, 1, true)).toBe('model-source');
  expect(next(1, 0, false)).toBe('machine');
  expect(next(1, 0, true)).toBe('machine');
  expect(next(1, 1, false)).toBe('coordinator');
  expect(next(1, 1, true)).toBeNull();
});

test('no step is named before the facts have loaded', () => {
  expect(
    nextOpenStep(
      firstRunSteps({ modelSources: undefined, machinesOnline: 1, coordinatorCanAnswer: true }),
    ),
  ).toBeNull();
});
