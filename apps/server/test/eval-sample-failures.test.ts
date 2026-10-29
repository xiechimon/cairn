import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FAILURE_WHERE,
  FAILURE_WHY,
  failureReviewAnswersSchema,
  failureReviewRecordSchema,
  type TrajectoryPack,
} from '@cairn/shared';
import { afterEach, expect, test } from 'vitest';
import { sampleFailures } from '../src/eval-sample-failures.js';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function writeFlow(
  root: string,
  flow: string,
  rows: {
    prompt_id: string;
    rep: number;
    grade?: Record<string, number | boolean>;
    error?: string;
  }[],
  traces: string[] = [],
) {
  const baseline = join(root, flow, 'baseline');
  mkdirSync(join(baseline, 'traces'), { recursive: true });
  const results = rows.filter((row) => row.grade);
  const errors = rows.filter((row) => row.error);
  writeFileSync(
    join(baseline, 'results.jsonl'),
    `${results.map((row) => JSON.stringify(row)).join('\n')}${results.length ? '\n' : ''}`,
  );
  if (errors.length) {
    writeFileSync(
      join(baseline, 'errors.jsonl'),
      `${errors.map((row) => JSON.stringify({ ...row, failure_class: 'timeout' })).join('\n')}\n`,
    );
  }
  for (const promptId of traces) {
    writeFileSync(join(baseline, 'traces', `${promptId}_rep0.json`), '[{"role":"assistant"}]\n');
  }
}

function pack(input: {
  buildId: string;
  merged?: boolean | null;
  attribution?: TrajectoryPack['attribution'];
}): TrajectoryPack {
  return {
    buildId: input.buildId,
    input: {
      spec: `Task ${input.buildId}`,
      sourceRef: null,
      baseSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      persona: null,
      agentId: 'agent-1',
      model: 'anthropic/claude-sonnet-4',
      skillInjection: null,
      blockerHandoff: null,
      harnessHash: 'harness-v1',
    },
    process: {
      steps: [
        {
          stepId: `${input.buildId}-step-1`,
          kind: 'build',
          transcript: [],
          checkpointCommit: null,
        },
      ],
      plans: [],
      token_usage: [],
    },
    judgments: { plan: [], diff: [], gate_verdict: [], ciFixRounds: 0 },
    outcome: {
      merged: input.merged ?? false,
      revertedWithin7d: null,
      fixedByLaterPr: null,
      costTotal: 0.1,
    },
    attribution: input.attribution ?? null,
  };
}

function fixtureTree() {
  const root = mkdtempSync(join(tmpdir(), 'cairn-sample-failures-'));
  dirs.push(root);
  writeFlow(
    root,
    'flow-a',
    [
      { prompt_id: 'a-fail-ok', rep: 0, grade: { ok: 0, other: 1 } },
      { prompt_id: 'a-fail-other', rep: 0, grade: { ok: 1, other: 0 } },
      { prompt_id: 'a-fail-both', rep: 0, grade: { ok: 0, other: 0 } },
      { prompt_id: 'a-pass', rep: 0, grade: { ok: 1, other: 1 } },
      { prompt_id: 'a-err', rep: 0, error: 'timeout' },
    ],
    ['a-fail-ok', 'a-fail-other'],
  );
  writeFlow(
    root,
    'flow-b',
    [
      { prompt_id: 'b-fail-1', rep: 0, grade: { ok: 0 } },
      { prompt_id: 'b-fail-2', rep: 0, grade: { ok: 0 } },
      { prompt_id: 'b-fail-3', rep: 0, grade: { ok: false } },
      { prompt_id: 'b-fail-4', rep: 0, grade: { ok: 0 } },
      { prompt_id: 'b-pass', rep: 0, grade: { ok: 1 } },
    ],
    ['b-fail-1'],
  );
  writeFlow(root, 'flow-c', [{ prompt_id: 'c-pass', rep: 0, grade: { ok: 1 } }]);
  const packsPath = join(root, 'packs.jsonl');
  const packs = [
    pack({
      buildId: 'build-alpha-1',
      attribution: {
        where: 'prompt',
        why: 'ignored_instruction',
        evidence: [],
        labeler: 'openai/gpt-5',
        labeledAt: 1,
      },
    }),
    pack({
      buildId: 'build-alpha-2',
      attribution: {
        where: 'prompt',
        why: 'wrong_tool',
        evidence: [],
        labeler: 'openai/gpt-5',
        labeledAt: 1,
      },
    }),
    pack({
      buildId: 'build-beta-1',
      attribution: {
        where: 'runtime',
        why: 'premature_finish',
        evidence: [],
        labeler: 'openai/gpt-5',
        labeledAt: 1,
      },
    }),
    pack({
      buildId: 'build-beta-2',
      attribution: {
        where: 'runtime',
        why: 'thinking_runaway',
        evidence: [],
        labeler: 'openai/gpt-5',
        labeledAt: 1,
      },
    }),
    pack({
      buildId: 'build-gamma-1',
      attribution: {
        where: 'config',
        why: 'ci_misread',
        evidence: [],
        labeler: 'openai/gpt-5',
        labeledAt: 1,
      },
    }),
    pack({ buildId: 'build-unattributed', attribution: null }),
    pack({
      buildId: 'build-merged',
      merged: true,
      attribution: {
        where: 'prompt',
        why: 'ci_misread',
        evidence: [],
        labeler: 'openai/gpt-5',
        labeledAt: 1,
      },
    }),
  ];
  writeFileSync(packsPath, `${packs.map((row) => JSON.stringify(row)).join('\n')}\n`);
  return { root, packsPath };
}

test('samples at most per-flow items and covers every flow with failures', () => {
  const { root, packsPath } = fixtureTree();
  const out = join(root, 'out');
  const result = sampleFailures({
    week: '2026-W44',
    seed: 'seed-a',
    flowsDir: root,
    packPaths: [packsPath],
    perFlow: 2,
    packs: 4,
    out,
  });
  const evalItems = result.items.filter((item) => item.source === 'eval');
  const byFlow = new Map<string, number>();
  for (const item of evalItems) {
    expect(item.flow).toBeTruthy();
    byFlow.set(item.flow!, (byFlow.get(item.flow!) ?? 0) + 1);
  }
  expect(byFlow.get('flow-a')).toBeLessThanOrEqual(2);
  expect(byFlow.get('flow-b')).toBeLessThanOrEqual(2);
  expect(byFlow.has('flow-a')).toBe(true);
  expect(byFlow.has('flow-b')).toBe(true);
  expect(byFlow.has('flow-c')).toBe(false);
  expect(evalItems.length).toBeGreaterThanOrEqual(2);
  expect(result.items.filter((item) => item.source === 'pack').length).toBeLessThanOrEqual(4);
});

test('same seed and week give the same sample', () => {
  const { root, packsPath } = fixtureTree();
  const options = {
    week: '2026-W44',
    seed: 'seed-stable',
    flowsDir: root,
    packPaths: [packsPath],
    perFlow: 3,
    packs: 5,
  };
  const first = sampleFailures({ ...options, out: join(root, 'out-1') });
  const second = sampleFailures({ ...options, out: join(root, 'out-2') });
  expect(second.items.map((item) => item.itemId)).toEqual(first.items.map((item) => item.itemId));
  expect(readFileSync(join(root, 'out-2', 'review-2026-W44.blank.jsonl'), 'utf8')).toBe(
    readFileSync(join(root, 'out-1', 'review-2026-W44.blank.jsonl'), 'utf8'),
  );
});

test('neither review file contains labeler where or why values from answers', () => {
  const { root, packsPath } = fixtureTree();
  const out = join(root, 'out');
  sampleFailures({
    week: '2026-W44',
    seed: 'seed-blind',
    flowsDir: root,
    packPaths: [packsPath],
    perFlow: 3,
    packs: 5,
    out,
  });
  const answers = failureReviewAnswersSchema.parse(
    JSON.parse(readFileSync(join(out, 'answers-2026-W44.json'), 'utf8')),
  );
  const reviewMd = readFileSync(join(out, 'review-2026-W44.md'), 'utf8');
  const reviewBlank = readFileSync(join(out, 'review-2026-W44.blank.jsonl'), 'utf8');
  const whereValues = new Set<string>();
  const whyValues = new Set<string>();
  for (const item of Object.values(answers.items)) {
    whereValues.add(item.where);
    whyValues.add(item.why);
  }
  expect(whereValues.size).toBeGreaterThan(0);
  expect(whyValues.size).toBeGreaterThan(0);
  for (const value of whereValues) {
    expect(FAILURE_WHERE.includes(value as (typeof FAILURE_WHERE)[number])).toBe(true);
    expect(reviewMd.includes(value)).toBe(false);
    expect(reviewBlank.includes(value)).toBe(false);
  }
  for (const value of whyValues) {
    expect(FAILURE_WHY.includes(value as (typeof FAILURE_WHY)[number])).toBe(true);
    expect(reviewMd.includes(value)).toBe(false);
    expect(reviewBlank.includes(value)).toBe(false);
  }
  for (const line of reviewBlank.trim().split('\n')) {
    const record = failureReviewRecordSchema.parse(JSON.parse(line));
    expect(record.where).toBeNull();
    expect(record.why).toBeNull();
    expect(record.verdictClass).toBeNull();
    expect(record.note).toBe('');
  }
});

test('passing trials and unattributed packs are never sampled', () => {
  const { root, packsPath } = fixtureTree();
  const out = join(root, 'out');
  const result = sampleFailures({
    week: '2026-W44',
    seed: 'seed-filter',
    flowsDir: root,
    packPaths: [packsPath],
    perFlow: 10,
    packs: 20,
    out,
  });
  const ids = new Set(result.items.map((item) => item.itemId));
  expect(ids.has('eval:flow-a:a-pass:0')).toBe(false);
  expect(ids.has('eval:flow-b:b-pass:0')).toBe(false);
  expect(ids.has('eval:flow-c:c-pass:0')).toBe(false);
  expect(ids.has('pack:build-unattributed')).toBe(false);
  expect(ids.has('pack:build-merged')).toBe(false);
  expect(existsSync(join(out, 'review-2026-W44.md'))).toBe(true);
  expect(existsSync(join(out, 'review-2026-W44.blank.jsonl'))).toBe(true);
  expect(existsSync(join(out, 'answers-2026-W44.json'))).toBe(true);
});
