import { describe, expect, test } from 'vitest';
import {
  canSelectSetupStep,
  hasAddedModelSource,
  holdFirstRunFrame,
  modelSourceKeys,
  resolvedSetupStep,
} from '../src/board/first-run-checklist-model.js';
import { homeStarters } from '../src/board/home-c.js';
import { composerPlusVisible } from '../src/chief/composer-surface.js';

const both = { coordinator: true, tasks: true };
const tasksOnly = { coordinator: false, tasks: true };

describe('first-run step 2 back-navigation and recovery', () => {
  test('stepping back from step 2 keeps the user on step 1 until they add a model or continue', () => {
    const unconfirmed = { models: both, confirmed: false };
    expect(resolvedSetupStep(unconfirmed)).toBe('confirm');
    expect(resolvedSetupStep(unconfirmed, { returnToModels: true })).toBe('models');
    expect(resolvedSetupStep(unconfirmed, { reviewing: true })).toBe('models');
    expect(resolvedSetupStep({ models: both, confirmed: true }, { returnToModels: true })).toBeNull();
    expect(resolvedSetupStep({ models: tasksOnly, confirmed: false }, { returnToModels: false })).toBe(
      'models',
    );
  });

  test('detects when a newly added provider or available connection should advance back to step 2', () => {
    const baseline = modelSourceKeys([{ id: 'p-bad' }], []);
    expect(hasAddedModelSource(baseline, modelSourceKeys([{ id: 'p-bad' }], []))).toBe(false);
    expect(
      hasAddedModelSource(baseline, modelSourceKeys([{ id: 'p-bad' }, { id: 'p-good' }], [])),
    ).toBe(true);
    expect(
      hasAddedModelSource(
        baseline,
        modelSourceKeys([{ id: 'p-bad' }], [{ id: 's-expired', available: false }]),
      ),
    ).toBe(false);
    expect(
      hasAddedModelSource(
        baseline,
        modelSourceKeys([{ id: 'p-bad' }], [{ id: 's-live', available: true }]),
      ),
    ).toBe(true);
  });

  test('allows clicking step 1 from step 2 and step 2 from step 1 when models are already connected', () => {
    const ready = { models: both, confirmed: false };
    const missing = { models: tasksOnly, confirmed: false };
    expect(canSelectSetupStep('models', 'confirm', ready, false)).toBe(true);
    expect(canSelectSetupStep('confirm', 'confirm', ready, false)).toBe(false);
    expect(canSelectSetupStep('confirm', 'models', ready, false)).toBe(true);
    expect(canSelectSetupStep('models', 'models', ready, false)).toBe(false);
    expect(canSelectSetupStep('confirm', 'models', ready, true)).toBe(false);
    expect(canSelectSetupStep('confirm', 'models', missing, false)).toBe(false);
  });
});

describe('blank newcomer home starters', () => {
  test('hides Pick up recent work when there are zero active projects and zero todos', () => {
    expect(homeStarters({ activeProjects: 0, todos: 0 })).toEqual(['做个计划', '接一个仓库']);
  });

  test('keeps Pick up recent work when projects or todos exist', () => {
    expect(homeStarters({ activeProjects: 1, todos: 0 })).toEqual([
      '做个计划',
      '接一个仓库',
      '接着最近的活',
    ]);
    expect(homeStarters({ activeProjects: 0, todos: 2 })).toEqual([
      '做个计划',
      '接一个仓库',
      '接着最近的活',
    ]);
    expect(homeStarters({ activeProjects: 2, todos: 3 })).toEqual([
      '做个计划',
      '接一个仓库',
      '接着最近的活',
    ]);
  });
});

describe('desktop disabled and no-model composer plus button', () => {
  test('hides the floating plus button on desktop when disabled, missing attachment handler, or no model', () => {
    expect(
      composerPlusVisible({
        editable: false,
        hasAttachment: false,
        narrow: false,
        showMeter: false,
      }),
    ).toBe(false);
    expect(
      composerPlusVisible({
        editable: true,
        hasAttachment: false,
        narrow: false,
        showMeter: false,
      }),
    ).toBe(false);
    expect(
      composerPlusVisible({
        editable: true,
        hasAttachment: true,
        narrow: false,
        showMeter: false,
        noModel: true,
      }),
    ).toBe(false);
    expect(
      composerPlusVisible({
        editable: true,
        hasAttachment: true,
        narrow: false,
        showMeter: false,
        noModel: false,
      }),
    ).toBe(true);
  });

  test('keeps the mobile plus button only when attachments or the context meter are available', () => {
    expect(
      composerPlusVisible({
        editable: false,
        hasAttachment: false,
        narrow: true,
        showMeter: true,
      }),
    ).toBe(true);
    expect(
      composerPlusVisible({
        editable: true,
        hasAttachment: true,
        narrow: true,
        showMeter: true,
        noModel: true,
      }),
    ).toBe(true);
    expect(
      composerPlusVisible({
        editable: false,
        hasAttachment: false,
        narrow: true,
        showMeter: false,
      }),
    ).toBe(false);
  });
});

describe('first-run frame holding before setupDecision resolves', () => {
  test('holds FirstRunFrame on a brand-new 0-project install before setupDecision resolves', () => {
    expect(
      holdFirstRunFrame({
        setupHome: true,
        decision: undefined,
        projects: 0,
        remembered: false,
        failed: false,
      }),
    ).toBe(true);
  });

  test('holds FirstRunFrame when first-run was remembered, but releases on error, decision, or normal loading', () => {
    expect(
      holdFirstRunFrame({
        setupHome: true,
        decision: undefined,
        projects: undefined,
        remembered: true,
        failed: false,
      }),
    ).toBe(true);
    expect(
      holdFirstRunFrame({
        setupHome: true,
        decision: undefined,
        projects: 0,
        remembered: false,
        failed: true,
      }),
    ).toBe(false);
    expect(
      holdFirstRunFrame({
        setupHome: true,
        decision: undefined,
        projects: undefined,
        remembered: false,
        failed: false,
      }),
    ).toBe(false);
    expect(
      holdFirstRunFrame({
        setupHome: true,
        decision: false,
        projects: 0,
        remembered: false,
        failed: false,
      }),
    ).toBe(false);
    expect(
      holdFirstRunFrame({
        setupHome: false,
        decision: undefined,
        projects: 0,
        remembered: true,
        failed: false,
      }),
    ).toBe(false);
  });
});
