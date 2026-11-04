import { BOARD_COLUMNS, boardColumnFor, PHASE_VALUES, type Phase } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { canTransitionPhase, PHASE_TRANSITIONS } from '../src/services/phase.js';

describe('the nine-value authority (02 §4.1)', () => {
  test('the transition table key set = the nine phase values, no others', () => {
    expect(Object.keys(PHASE_TRANSITIONS).sort()).toEqual([...PHASE_VALUES].sort());
    for (const targets of Object.values(PHASE_TRANSITIONS)) {
      for (const to of targets) {
        expect(PHASE_VALUES).toContain(to);
      }
    }
  });

  test('the main timeline edges (the full 02 §4.2 chain) are legal one by one', () => {
    const spine: [Phase, Phase][] = [
      ['todo', 'queued'],
      ['queued', 'planning'],
      ['planning', 'confirm'],
      ['confirm', 'building'],
      ['building', 'review'],
      ['review', 'done'],
    ];
    for (const [from, to] of spine) {
      expect(canTransitionPhase(from, to), `${from}->${to}`).toBe(true);
    }
  });

  test('side edges: reject-and-replan / direct execution / failed rerun / close-reopen', () => {
    expect(canTransitionPhase('confirm', 'planning')).toBe(true);
    expect(canTransitionPhase('queued', 'building')).toBe(true);
    expect(canTransitionPhase('failed', 'queued')).toBe(true);
    expect(canTransitionPhase('todo', 'closed')).toBe(true);
    expect(canTransitionPhase('closed', 'todo')).toBe(true);
  });

  test('conditional edge: failed->review recovery (#702 / #519 B-C17, legal only when the build leg has delivered)', () => {
    expect(canTransitionPhase('failed', 'review')).toBe(true);
    expect(canTransitionPhase('failed', 'done')).toBe(false);
  });

  test('the scheduled rerun edge (02 §9.2 trigger -> a fresh rerun in a new build)', () => {
    expect(canTransitionPhase('done', 'queued')).toBe(true);
    expect(canTransitionPhase('review', 'queued')).toBe(true);
    expect(canTransitionPhase('confirm', 'queued')).toBe(true);
  });

  test('illegal edges rejected (skips / backwards / edges out of terminal states)', () => {
    expect(canTransitionPhase('todo', 'done')).toBe(false);
    expect(canTransitionPhase('todo', 'building')).toBe(false);
    expect(canTransitionPhase('building', 'confirm')).toBe(false);
    expect(canTransitionPhase('review', 'building')).toBe(false);
    expect(canTransitionPhase('done', 'todo')).toBe(false);
    expect(canTransitionPhase('done', 'building')).toBe(false);
    for (const from of PHASE_VALUES) {
      expect(canTransitionPhase(from, from)).toBe(false);
    }
  });
});

describe('the 4-column folding map (#351, single key)', () => {
  test('the column vocabulary = the workbench 4 columns', () => {
    expect(BOARD_COLUMNS).toHaveLength(4);
  });

  test('column position checked phase by phase (single key, no hasChanges)', () => {
    expect(boardColumnFor('todo')).toBe('待开始');
    expect(boardColumnFor('queued')).toBe('执行中');
    expect(boardColumnFor('planning')).toBe('执行中');
    expect(boardColumnFor('building')).toBe('执行中');
    expect(boardColumnFor('confirm')).toBe('待处理');
    expect(boardColumnFor('review')).toBe('待处理');
    expect(boardColumnFor('failed')).toBe('待处理');
    expect(boardColumnFor('done')).toBe('已完成');
    expect(boardColumnFor('closed')).toBe('已完成');
  });
});
