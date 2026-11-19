import { expect, test } from 'vitest';
import {
  coordinatorCanAnswer,
  firstRunComplete,
  firstRunSteps,
  modelSides,
  modelSourceCount,
  modelsConfirmed,
  nextOpenStep,
  projectCreationBlocked,
  setupOpenStep,
  setupShown,
} from '../src/board/first-run-checklist-model.js';

const both = { coordinator: true, tasks: true };
const tasksOnly = { coordinator: false, tasks: true };
const none = { coordinator: false, tasks: false };

test('the models step needs a model on both sides, not just any model source', () => {
  expect(firstRunSteps({ models: tasksOnly, machinesOnline: 1 })?.map((s) => [s.id, s.done])).toEqual([
    ['models', false],
    ['machine', true],
  ]);
  expect(firstRunSteps({ models: both, machinesOnline: 1 })?.every((s) => s.done)).toBe(true);
});

test('the composer chip names models before an offline Runner', () => {
  expect(nextOpenStep(firstRunSteps({ models: tasksOnly, machinesOnline: 0 }))).toBe('models');
  expect(nextOpenStep(firstRunSteps({ models: both, machinesOnline: 0 }))).toBe('machine');
  expect(nextOpenStep(firstRunSteps({ models: both, machinesOnline: 1 }))).toBeNull();
});

test('while any fact is still loading nothing is named', () => {
  expect(firstRunSteps({ models: undefined, machinesOnline: 1 })).toBeNull();
  expect(firstRunSteps({ models: both, machinesOnline: undefined })).toBeNull();
  expect(firstRunComplete(firstRunSteps({ models: undefined, machinesOnline: 0 }))).toBe(true);
});

test('model sides come from whether the Coordinator can answer and whether any source exists', () => {
  expect(modelSides(false, 1)).toEqual(tasksOnly);
  expect(modelSides(true, 0)).toEqual({ coordinator: true, tasks: false });
  expect(modelSides(undefined, 1)).toBeUndefined();
  expect(modelSides(true, undefined)).toBeUndefined();
});

test('the Coordinator needs a routing facade with a model to answer', () => {
  expect(coordinatorCanAnswer(undefined)).toBeUndefined();
  const base = { chief: {}, watches: [], wakes: [], context: null };
  expect(coordinatorCanAnswer({ ...base, agentActor: null } as never)).toBe(false);
  expect(coordinatorCanAnswer({ ...base, agentActor: { modelId: null } } as never)).toBe(false);
  expect(coordinatorCanAnswer({ ...base, agentActor: { modelId: 'm' } } as never)).toBe(true);
});

test('provider records and available connections are model sources; unavailable ones are not', () => {
  expect(modelSourceCount([{ id: 'p1' }], [])).toBe(1);
  expect(modelSourceCount([], [{ id: 'sub-1', available: true }])).toBe(1);
  expect(modelSourceCount([], [{ id: 'sub-1', available: false }])).toBe(0);
  expect(modelSourceCount([], [{ id: 'c1' }])).toBe(1);
  expect(modelSourceCount(undefined, [])).toBeUndefined();
});

test('models are confirmed once the coordinator rule is stored; tasks follow it', () => {
  const rule = (use: string) => ({ use }) as never;
  expect(modelsConfirmed({ rules: [], policies: [] })).toBe(false);
  expect(modelsConfirmed({ rules: [rule('session'), rule('review')], policies: [] })).toBe(false);
  expect(modelsConfirmed({ rules: [rule('coordinator')], policies: [] })).toBe(true);
});

test('the setup page opens the models step first, then confirm, then nothing', () => {
  expect(setupOpenStep({ models: tasksOnly, confirmed: true })).toBe('models');
  expect(setupOpenStep({ models: both, confirmed: false })).toBe('confirm');
  expect(setupOpenStep({ models: both, confirmed: true })).toBeNull();
});

test('the setup page shows for a team with no projects until both steps are done, with no way to skip it', () => {
  const progress = { models: none, confirmed: false };
  const base = { projects: 0, progress };
  expect(setupShown(base)).toBe(true);
  expect(setupShown({ ...base, projects: 1 })).toBe(false);
  expect(setupShown({ ...base, projects: undefined })).toBeUndefined();
  expect(setupShown({ ...base, progress: undefined })).toBeUndefined();
  const done = { models: both, confirmed: true };
  expect(setupShown({ ...base, progress: { models: both, confirmed: false } })).toBe(true);
  expect(setupShown({ ...base, progress: done })).toBe(false);
});

test('creating the first project is blocked until both steps are done; later projects never are', () => {
  const open = { models: both, confirmed: false };
  const done = { models: both, confirmed: true };
  expect(projectCreationBlocked({ projects: 0, progress: open })).toBe(true);
  expect(projectCreationBlocked({ projects: 0, progress: done })).toBe(false);
  expect(projectCreationBlocked({ projects: 2, progress: open })).toBe(false);
  expect(projectCreationBlocked({ projects: undefined, progress: open })).toBe(false);
  expect(projectCreationBlocked({ projects: 0, progress: undefined })).toBe(false);
});
