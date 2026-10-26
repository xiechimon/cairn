import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { trajectoryPackSchema } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { isReflectEligible } from '../../apps/server/src/trajectory-reflect.js';
import type { TurnEvidence } from '../eval/chief-dispatch/stack.mts';
import {
  gradeLearnDecision,
  gradeMemorySaved,
  gradeReflectCandidates,
  isLearnCase,
  type LearnCase,
  type LearnMemoryRow,
  learnCaseProblems,
  learnGradeRecord,
  learnHeadline,
  learnHeadlineFromRows,
} from '../eval/learn/grade.mts';
import { buildLearnPack } from '../eval/learn/pack.mts';
import { isMemoryCase } from '../eval/memory-regression/grade.mts';

const FLOW = join(import.meta.dirname, '../../.claude/hillclimb/learn/cases.json');

const branch: LearnCase = {
  id: 'k01',
  tags: ['learn'],
  family: 'learn',
  round1:
    'Create a task for eval-project: prepare the 0.6 release cut. The spec must name the branch pattern.',
  correction:
    'The release cut branch pattern is rel-x.y, for example rel-0.6. A release/ prefix is wrong.',
  round2:
    'Create a task for eval-project: write the checklist a release manager follows. The spec must name the branch pattern used for the cut.',
  expect: { include: [['rel-x.y', 'rel-']], exclude: ['release/'] },
  oracle: {
    title: 'Release branch pattern',
    content: 'Release cuts use rel-x.y, for example rel-0.6.',
  },
};

function turn(over: Partial<TurnEvidence> = {}): TurnEvidence {
  return {
    threadId: 't',
    stepStatus: 'done',
    toolCalls: [],
    runBuildsArgs: [],
    assistantText: '',
    createdTodoIds: [],
    createdTodoRows: [],
    buildRows: [],
    model: 'glm-5.3',
    usage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0 },
    wallMs: 1000,
    ...over,
  };
}

function withSpec(spec: string): TurnEvidence {
  return turn({
    createdTodoIds: ['t1'],
    createdTodoRows: [
      { id: 't1', title: 'Task', spec, buildAgentId: null, planAgentId: null, phase: 'todo' },
    ],
  });
}

function memory(over: Partial<LearnMemoryRow> = {}): LearnMemoryRow {
  return {
    title: 'Release branch pattern',
    content: 'Release cuts use rel-x.y.',
    projectId: 'proj-eval',
    invalidAt: null,
    ...over,
  };
}

describe('learn case shape', () => {
  test('a learn case is not a memory-regression case', () => {
    expect(isLearnCase(branch)).toBe(true);
    expect(isMemoryCase(branch as unknown as { expect: { kind: string } })).toBe(false);
  });

  test('round 2 is a different prompt and names neither fact', () => {
    expect(learnCaseProblems(branch)).toEqual([]);
  });

  test('identical round prompts are rejected', () => {
    expect(learnCaseProblems({ ...branch, round2: branch.round1 })).toContain('same text');
  });

  test('a round-2 prompt that names the corrected fact is rejected', () => {
    expect(learnCaseProblems({ ...branch, round2: `${branch.round2} Use rel-x.y.` })).toContain(
      'round2 names the fact',
    );
  });

  test('a round-1 prompt that names the corrected fact is rejected', () => {
    expect(learnCaseProblems({ ...branch, round1: `${branch.round1} Use rel-x.y.` })).toContain(
      'round1 names the fact',
    );
  });

  test('a correction that misses the fact is rejected', () => {
    expect(learnCaseProblems({ ...branch, correction: 'Try again.' })).toContain(
      'correction misses',
    );
  });

  test('an oracle memory that misses the fact or repeats the mistake is rejected', () => {
    expect(
      learnCaseProblems({ ...branch, oracle: { title: 'Branch', content: 'use release/0.6' } }),
    ).toEqual(expect.arrayContaining(['oracle misses', 'oracle repeats the mistake']));
  });
});

describe('grade round 2 from the task end state', () => {
  test('a spec that states the corrected fact passes', () => {
    const g = gradeLearnDecision(branch, withSpec('Cut the release from rel-x.y.'));
    expect(g.ok).toBe(true);
  });

  test('assistant text is ignored when no task was created', () => {
    const g = gradeLearnDecision(branch, turn({ assistantText: 'Use rel-x.y for the cut.' }));
    expect(g.ok).toBe(false);
    expect(g.why).toContain('no task');
  });

  test('an unfinished turn fails', () => {
    const unfinished = gradeLearnDecision(branch, { ...withSpec('rel-x.y'), stepStatus: 'failed' });
    expect(unfinished.ok).toBe(false);
    expect(unfinished.why).toContain('did not finish');
  });

  test('the mistake in the spec fails even if the corrected fact is also present', () => {
    const g = gradeLearnDecision(branch, withSpec('Use rel-x.y, not release/0.6.'));
    expect(g.ok).toBe(false);
    expect(g.why).toContain('mistake');
  });

  test('a spec that misses the fact fails', () => {
    const g = gradeLearnDecision(branch, withSpec('Cut the release from the default branch.'));
    expect(g.ok).toBe(false);
    expect(g.why).toContain('missing');
  });
});

describe('memory_saved_ok', () => {
  const projectId = 'proj-eval';

  test('a valid project-scoped memory that states the fact passes', () => {
    expect(gradeMemorySaved(branch, [memory()], projectId).ok).toBe(true);
  });

  test('the same fact stored globally or on another project fails', () => {
    expect(gradeMemorySaved(branch, [memory({ projectId: null })], projectId).why).toContain(
      'outside the project',
    );
    expect(gradeMemorySaved(branch, [memory({ projectId: 'other' })], projectId).why).toContain(
      'outside the project',
    );
  });

  test('a project memory that states the mistake fails', () => {
    const g = gradeMemorySaved(
      branch,
      [memory({ content: 'Use rel-x.y and also release/0.6.' })],
      projectId,
    );
    expect(g.ok).toBe(false);
    expect(g.why).toContain('mistake');
  });

  test('an invalidated memory does not count', () => {
    const g = gradeMemorySaved(branch, [memory({ invalidAt: 1 })], projectId);
    expect(g.ok).toBe(false);
    expect(g.why).toContain('invalidated');
  });

  test('a valid project memory saves the score when an older row was invalidated', () => {
    const g = gradeMemorySaved(branch, [memory({ invalidAt: 1 }), memory()], projectId);
    expect(g.ok).toBe(true);
  });

  test('no rows fails', () => {
    expect(gradeMemorySaved(branch, [], projectId).why).toContain('no memory');
  });
});

describe('reflection candidates', () => {
  test('a candidate that states the fact passes, and a wrong fact is flagged on its own', () => {
    const good = gradeReflectCandidates(branch, [
      { title: 'Release branch', content: 'Cut from rel-x.y.' },
    ]);
    expect(good.factOk).toBe(true);
    expect(good.wrong).toBe(false);
    const bad = gradeReflectCandidates(branch, [
      { title: 'Release branch', content: 'Cut from release/0.6.' },
    ]);
    expect(bad.factOk).toBe(false);
    expect(bad.wrong).toBe(true);
  });

  test('one candidate can state the fact and the mistake', () => {
    const both = gradeReflectCandidates(branch, [
      { title: 'rel-x.y', content: 'Do not use release/ anymore.' },
    ]);
    expect(both.factOk).toBe(true);
    expect(both.wrong).toBe(true);
  });

  test('no candidates states neither', () => {
    const none = gradeReflectCandidates(branch, []);
    expect(none.factOk).toBe(false);
    expect(none.wrong).toBe(false);
  });

  test('the fact in the title counts', () => {
    expect(
      gradeReflectCandidates(branch, [{ title: 'rel-x.y', content: 'Use this branch pattern.' }])
        .factOk,
    ).toBe(true);
  });
});

describe('trajectory pack built from round 1', () => {
  const pack = buildLearnPack(branch, {
    text: 'I will cut from release/0.6.',
    model: 'glm-5.3',
    agentId: 'agent-1',
    buildId: 'build-k01',
  });

  test('the pack is a reflect-eligible trajectory and does not carry round 2', () => {
    expect(trajectoryPackSchema.parse(pack)).toEqual(pack);
    expect(isReflectEligible(pack)).toBe(true);
    expect(pack.input.spec).toBe(branch.round1);
    expect(pack.judgments.plan).toContainEqual({ action: 'revision', reason: branch.correction });
    expect(pack.process.plans[0]?.content).toBe('I will cut from release/0.6.');
    expect(JSON.stringify(pack)).not.toContain(branch.round2);
  });
});

describe('headline', () => {
  test('repeat rate is the correction-arm miss rate, and gap closed is the share of the oracle gap', () => {
    expect(learnHeadline({ noMemory: 0, correction: 0, oracle: 1 })).toEqual({
      repeatRate: 1,
      gapClosed: 0,
    });
    expect(learnHeadline({ noMemory: 0, correction: 1, oracle: 1 })).toEqual({
      repeatRate: 0,
      gapClosed: 1,
    });
    const mid = learnHeadline({ noMemory: 0.25, correction: 0.5, oracle: 1 });
    expect(mid.repeatRate).toBeCloseTo(0.5);
    expect(mid.gapClosed).toBeCloseTo(1 / 3);
  });

  test('gap closed is null when oracle and no-memory tie', () => {
    expect(learnHeadline({ noMemory: 1, correction: 1, oracle: 1 }).gapClosed).toBeNull();
  });

  test('rows from the all-arm grade collapse to the same headline', () => {
    const row = learnGradeRecord({
      arm: 'all',
      noMemory: { ok: false, why: 'missing' },
      correctionDecision: { ok: true, why: 'uses the fact' },
      memorySaved: { ok: true, why: 'stored' },
      oracle: { ok: true, why: 'seeded fact' },
      reflect: {
        factOk: true,
        wrong: false,
        whyFact: 'candidate states it',
        whyWrong: 'no candidate states the mistake',
      },
    });
    expect(row.grade).toEqual({
      decision_ok: 1,
      memory_saved_ok: 1,
      no_memory_ok: 0,
      oracle_ok: 1,
      reflect_fact_ok: 1,
      reflect_wrong: 0,
    });
    expect(
      learnHeadlineFromRows([{ grade: row.grade }, { grade: { ...row.grade, decision_ok: 0 } }]),
    ).toEqual({ repeatRate: 0.5, gapClosed: 0.5 });
  });

  test('a single arm records only the metrics that arm measured', () => {
    expect(
      learnGradeRecord({ arm: 'no-memory', noMemory: { ok: false, why: 'missing' } }).grade,
    ).toEqual({ decision_ok: 0 });
    expect(
      learnGradeRecord({
        arm: 'correction',
        correctionDecision: { ok: true, why: 'uses the fact' },
        memorySaved: { ok: false, why: 'no memory' },
      }).grade,
    ).toEqual({ decision_ok: 1, memory_saved_ok: 0 });
    expect(
      learnGradeRecord({ arm: 'oracle', oracle: { ok: true, why: 'seeded fact' } }).grade,
    ).toEqual({ decision_ok: 1 });
    expect(
      learnGradeRecord({
        arm: 'reflect',
        reflect: { factOk: false, wrong: true, whyFact: 'missing', whyWrong: 'states the mistake' },
      }).grade,
    ).toEqual({ reflect_fact_ok: 0, reflect_wrong: 1 });
  });

  test('an all-arm record without an arm result throws', () => {
    expect(() => learnGradeRecord({ arm: 'all' })).toThrow(/no-memory/);
  });
});

describe('committed learn cases', () => {
  const flow = JSON.parse(readFileSync(FLOW, 'utf8')) as { cases: LearnCase[] };

  test('the family has 8 to 10 cases and each one is safe to run', () => {
    expect(flow.cases.length).toBeGreaterThanOrEqual(8);
    expect(flow.cases.length).toBeLessThanOrEqual(10);
    const ids = flow.cases.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of flow.cases) {
      expect(isLearnCase(c), c.id).toBe(true);
      expect(learnCaseProblems(c), c.id).toEqual([]);
    }
  });
});
