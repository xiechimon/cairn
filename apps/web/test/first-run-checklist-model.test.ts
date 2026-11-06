import { expect, test } from 'vitest';
import {
  coordinatorCanAnswer,
  firstRunComplete,
  firstRunSteps,
} from '../src/board/first-run-checklist-model.js';

const done = { providerCount: 1, machinesOnline: 1, coordinatorCanAnswer: true };

test('nothing is configured on a fresh install: all three steps are open', () => {
  const steps = firstRunSteps({ providerCount: 0, machinesOnline: 0, coordinatorCanAnswer: false });
  expect(steps?.map((s) => [s.id, s.done])).toEqual([
    ['provider', false],
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
  expect(firstRunSteps({ ...done, providerCount: 0 })?.map((s) => s.done)).toEqual([
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
  expect(firstRunComplete(firstRunSteps({ ...done, providerCount: undefined }))).toBe(true);
});

test('the Coordinator needs a bound agent with a model to answer', () => {
  expect(coordinatorCanAnswer(undefined)).toBeUndefined();
  const base = { chief: {}, watches: [], wakes: [], context: null };
  expect(coordinatorCanAnswer({ ...base, agentActor: null } as never)).toBe(false);
  expect(coordinatorCanAnswer({ ...base, agentActor: { modelId: null } } as never)).toBe(false);
  expect(coordinatorCanAnswer({ ...base, agentActor: { modelId: 'm' } } as never)).toBe(true);
});
