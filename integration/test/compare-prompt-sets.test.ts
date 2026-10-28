import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, test } from 'vitest';
import { wilsonInterval } from '../eval/chief-dispatch/baseline-record.mts';
import {
  buildComparisonMarkdown,
  CompareValidationError,
  formatCostDifference,
  meanWithInterval,
  type PromptSetResultRow,
  validateArms,
} from '../eval/chief-dispatch/compare-prompt-sets.mts';
import { REPO_ROOT } from '../eval/chief-dispatch/stack.mts';

const SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  '../eval/chief-dispatch/compare-prompt-sets.mts',
);
const require = createRequire(new URL('../package.json', import.meta.url));
const TSX_CLI = require.resolve('tsx/cli');
const FIXTURE_SMOKE = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures/compare-prompt-sets/smoke',
);

const SHA = 'a'.repeat(64);
const MODEL = 'glm-5.3';

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

function provenance(promptSet: 'current' | 'cut', extra: Record<string, unknown> = {}) {
  return {
    prompt_set: promptSet,
    prompt_set_identity: `${promptSet}-id`,
    harness_sha: SHA,
    model: MODEL,
    thinking: null,
    timeout_s: 30,
    ...extra,
  };
}

function row(
  partial: Partial<PromptSetResultRow> & { prompt_id: string; prompt_set: 'current' | 'cut' },
): PromptSetResultRow {
  const { prompt_set, ...rest } = partial;
  return {
    rep: 0,
    status: 'ok',
    in_tokens: 100,
    out_tokens: 20,
    cache_read_tokens: 0,
    cost_usd: 0.01,
    grade: { decision_ok: 1, receipt_ok: 1 },
    tags: ['dispatch'],
    provenance: provenance(prompt_set),
    ...rest,
  };
}

function writeArm(
  home: string,
  variant: string,
  rows: PromptSetResultRow[],
  errors: Record<string, unknown>[] = [],
): void {
  const dir = join(home, variant);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'results.jsonl'),
    rows.length === 0 ? '' : `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`,
  );
  writeFileSync(
    join(dir, 'errors.jsonl'),
    errors.length === 0 ? '' : `${errors.map((e) => JSON.stringify(e)).join('\n')}\n`,
  );
}

function tempFlow(name: string): string {
  const home = mkdtempSync(join(tmpdir(), `cairn-compare-${name}-`));
  homes.push(home);
  return home;
}

function runCli(
  flow: string,
  args: string[] = [],
  cwd: string = REPO_ROOT,
): { status: number | null; stdout: string; stderr: string } {
  const run = spawnSync(process.execPath, [TSX_CLI, SCRIPT, flow, ...args], {
    encoding: 'utf8',
    cwd,
    env: process.env,
  });
  return { status: run.status, stdout: run.stdout ?? '', stderr: run.stderr ?? '' };
}

describe('compare-prompt-sets statistics', () => {
  test('one passing row plus one truncated row reports 50% and sums both rows tokens and cost', () => {
    const current = [
      row({
        prompt_id: 'd01',
        prompt_set: 'current',
        status: 'ok',
        grade: { decision_ok: 1, receipt_ok: 1 },
        in_tokens: 100,
        out_tokens: 10,
        cost_usd: 0.04,
      }),
      row({
        prompt_id: 'd02',
        prompt_set: 'current',
        status: 'truncated',
        grade: { decision_ok: 0, receipt_ok: 0 },
        in_tokens: 50,
        out_tokens: 5,
        cost_usd: 0.01,
      }),
    ];
    const cut = [
      row({
        prompt_id: 'd01',
        prompt_set: 'cut',
        status: 'ok',
        grade: { decision_ok: 1, receipt_ok: 1 },
        in_tokens: 80,
        out_tokens: 8,
        cost_usd: 0.03,
      }),
      row({
        prompt_id: 'd02',
        prompt_set: 'cut',
        status: 'ok',
        grade: { decision_ok: 1, receipt_ok: 1 },
        in_tokens: 70,
        out_tokens: 7,
        cost_usd: 0.02,
      }),
    ];
    validateArms({ currentRows: current, cutRows: cut });
    const md = buildComparisonMarkdown({
      flow: 'fixture',
      currentLabel: 'current',
      cutLabel: 'cut',
      currentRows: current,
      cutRows: cut,
      currentInfraErrors: 0,
      cutInfraErrors: 0,
    });
    expect(md).toMatch(/50\.0%/);
    expect(md).toMatch(/0\.0250/);
    expect(md).not.toMatch(/truncated rows excluded/i);
    expect(md).toMatch(/in tok\/task/);
    expect(md).toContain('| d01 |');
    expect(md).toContain('| d02 |');
  });

  test('an all-truncated arm reports 0% and does not throw', () => {
    const current = [
      row({
        prompt_id: 'd01',
        prompt_set: 'current',
        status: 'truncated',
        grade: { decision_ok: 0, receipt_ok: 0 },
        cost_usd: 0.02,
      }),
    ];
    const cut = [
      row({
        prompt_id: 'd01',
        prompt_set: 'cut',
        status: 'ok',
        grade: { decision_ok: 1, receipt_ok: 1 },
        cost_usd: 0.01,
      }),
    ];
    expect(() =>
      buildComparisonMarkdown({
        flow: 'fixture',
        currentLabel: 'current',
        cutLabel: 'cut',
        currentRows: current,
        cutRows: cut,
        currentInfraErrors: 0,
        cutInfraErrors: 0,
      }),
    ).not.toThrow();
    const md = buildComparisonMarkdown({
      flow: 'fixture',
      currentLabel: 'current',
      cutLabel: 'cut',
      currentRows: current,
      cutRows: cut,
      currentInfraErrors: 0,
      cutInfraErrors: 0,
    });
    expect(md).toMatch(/\| current \|[^|]*\|[^|]*\| 0\.0%/);
  });

  test('an empty arm and an errors-only arm render unavailable with a diagnostic; output contains no NaN or Infinity', () => {
    const cut = [
      row({
        prompt_id: 'd01',
        prompt_set: 'cut',
        grade: { decision_ok: 1, receipt_ok: 1 },
      }),
    ];
    const md = buildComparisonMarkdown({
      flow: 'fixture',
      currentLabel: 'current',
      cutLabel: 'cut',
      currentRows: [],
      cutRows: cut,
      currentInfraErrors: 3,
      cutInfraErrors: 0,
    });
    expect(md.toLowerCase()).toMatch(/unavailable/);
    expect(md).toMatch(/infra|infrastructure|error/i);
    expect(md).toMatch(/3/);
    expect(md).not.toMatch(/\bNaN\b/);
    expect(md).not.toMatch(/\bInfinity\b/);
    expect(md).not.toMatch(/-Infinity/);
  });

  test('a singleton arm reports a wide interval, not measured certainty', () => {
    const interval = wilsonInterval(1, 1);
    expect(interval).not.toBeNull();
    expect(interval!.low).toBeLessThan(0.5);
    expect(interval!.high).toBe(1);
    const mean = meanWithInterval([0.05]);
    expect(mean.mean).toBeCloseTo(0.05);
    expect(mean.halfWidth).toBeNull();
    const current = [
      row({
        prompt_id: 'd01',
        prompt_set: 'current',
        cost_usd: 0.05,
      }),
    ];
    const cut = [
      row({
        prompt_id: 'd01',
        prompt_set: 'cut',
        cost_usd: 0.03,
      }),
    ];
    const md = buildComparisonMarkdown({
      flow: 'fixture',
      currentLabel: 'current',
      cutLabel: 'cut',
      currentRows: current,
      cutRows: cut,
      currentInfraErrors: 0,
      cutInfraErrors: 0,
    });
    expect(md).toMatch(/100\.0% \[/);
    const wilsonMatch = md.match(/100\.0% \[([0-9.]+)%, ([0-9.]+)%\]/);
    expect(wilsonMatch).not.toBeNull();
    expect(Number(wilsonMatch![1])).toBeLessThan(50);
    expect(Number(wilsonMatch![2])).toBe(100);
    expect(md).toMatch(/CI unavailable|interval unavailable|n=1/i);
  });

  test('cost 0.05 vs 0.03 renders -0.0200 $/task (-40.0%); zero current cost renders relative as unavailable', () => {
    expect(formatCostDifference(0.03, 0.05)).toBe('-0.0200 $/task (-40.0%)');
    expect(formatCostDifference(0.01, 0)).toMatch(/unavailable/i);
  });

  test('infrastructure errors are counted separately from task failures', () => {
    const current = [
      row({
        prompt_id: 'd01',
        prompt_set: 'current',
        grade: { decision_ok: 0, receipt_ok: 0 },
      }),
    ];
    const cut = [
      row({
        prompt_id: 'd01',
        prompt_set: 'cut',
        grade: { decision_ok: 1, receipt_ok: 1 },
      }),
    ];
    const md = buildComparisonMarkdown({
      flow: 'fixture',
      currentLabel: 'current',
      cutLabel: 'cut',
      currentRows: current,
      cutRows: cut,
      currentInfraErrors: 2,
      cutInfraErrors: 1,
    });
    expect(md).toMatch(/infra(?:structure)? errors?:?\s*2/i);
    expect(md).toMatch(/infra(?:structure)? errors?:?\s*1/i);
    expect(md).toMatch(/0\.0%/);
    expect(md).toMatch(/100\.0%/);
  });
});

describe('compare-prompt-sets provenance validation', () => {
  test('rows missing provenance, mixed provenance, or different model/harness_sha between arms: exit nonzero, no comparison table', () => {
    const okCurrent = [row({ prompt_id: 'd01', prompt_set: 'current' })];
    const okCut = [row({ prompt_id: 'd01', prompt_set: 'cut' })];

    expect(() =>
      validateArms({
        currentRows: [{ ...okCurrent[0]!, provenance: undefined }],
        cutRows: okCut,
      }),
    ).toThrow(CompareValidationError);

    expect(() =>
      validateArms({
        currentRows: [
          row({ prompt_id: 'd01', prompt_set: 'current' }),
          row({
            prompt_id: 'd02',
            prompt_set: 'current',
            provenance: provenance('cut'),
          }),
        ],
        cutRows: okCut,
      }),
    ).toThrow(CompareValidationError);

    expect(() =>
      validateArms({
        currentRows: okCurrent,
        cutRows: [
          row({
            prompt_id: 'd01',
            prompt_set: 'cut',
            provenance: provenance('cut', { model: 'other-model' }),
          }),
        ],
      }),
    ).toThrow(CompareValidationError);

    expect(() =>
      validateArms({
        currentRows: okCurrent,
        cutRows: [
          row({
            prompt_id: 'd01',
            prompt_set: 'cut',
            provenance: provenance('cut', { harness_sha: 'b'.repeat(64) }),
          }),
        ],
      }),
    ).toThrow(CompareValidationError);

    const home = tempFlow('bad-prov');
    writeArm(home, 'current', [{ ...okCurrent[0]!, provenance: undefined }]);
    writeArm(home, 'cut', okCut);
    const bad = runCli(home, ['--current', 'current', '--cut', 'cut']);
    expect(bad.status).not.toBe(0);
    expect(bad.stdout + bad.stderr).not.toMatch(/\| arm \|/);
    expect(bad.stdout + bad.stderr).not.toMatch(/## Summary/);
  });

  test('unequal case/rep coverage is reported per case', () => {
    const current = [
      row({ prompt_id: 'd01', prompt_set: 'current', rep: 0 }),
      row({ prompt_id: 'd01', prompt_set: 'current', rep: 1 }),
      row({ prompt_id: 'd02', prompt_set: 'current', rep: 0 }),
    ];
    const cut = [
      row({ prompt_id: 'd01', prompt_set: 'cut', rep: 0 }),
      row({ prompt_id: 'd03', prompt_set: 'cut', rep: 0 }),
    ];
    const md = buildComparisonMarkdown({
      flow: 'fixture',
      currentLabel: 'current',
      cutLabel: 'cut',
      currentRows: current,
      cutRows: cut,
      currentInfraErrors: 0,
      cutInfraErrors: 0,
    });
    expect(md).toMatch(/d01/);
    expect(md).toMatch(/2\/2|coverage/i);
    expect(md).toMatch(/d02/);
    expect(md).toMatch(/d03/);
    expect(md).toMatch(/unequal|missing|coverage/i);
  });
});

describe('compare-prompt-sets path resolution', () => {
  test('running from the repo root and through pnpm --filter @cairn/integration exec resolves the same flow dir', () => {
    const rel = 'integration/test/fixtures/compare-prompt-sets/smoke';
    const fromRoot = runCli(rel, ['--current', 'current', '--cut', 'cut'], REPO_ROOT);
    expect(fromRoot.status, fromRoot.stderr).toBe(0);

    const viaPnpm = spawnSync(
      'pnpm',
      [
        '--filter',
        '@cairn/integration',
        'exec',
        'tsx',
        SCRIPT,
        rel,
        '--current',
        'current',
        '--cut',
        'cut',
      ],
      { encoding: 'utf8', cwd: REPO_ROOT, env: process.env },
    );
    expect(viaPnpm.status, viaPnpm.stderr).toBe(0);

    const stripGenerated = (s: string) => s.replace(/generated: [^\n]+/, 'generated: STAMP');
    expect(stripGenerated(fromRoot.stdout)).toBe(stripGenerated(viaPnpm.stdout ?? ''));
    expect(fromRoot.stdout).toMatch(/Prompt-set/);
    expect(readFileSync(join(FIXTURE_SMOKE, 'current/results.jsonl'), 'utf8')).toContain(
      'prompt_set',
    );
  });

  test('absolute and relative flow paths resolve against REPO_ROOT not cwd', () => {
    const rel = 'integration/test/fixtures/compare-prompt-sets/smoke';
    const abs = resolve(REPO_ROOT, rel);
    const fromTmp = runCli(rel, ['--current', 'current', '--cut', 'cut'], tmpdir());
    const fromAbs = runCli(abs, ['--current', 'current', '--cut', 'cut'], tmpdir());
    expect(fromTmp.status, fromTmp.stderr).toBe(0);
    expect(fromAbs.status, fromAbs.stderr).toBe(0);
    const stripGenerated = (s: string) => s.replace(/generated: [^\n]+/, 'generated: STAMP');
    expect(stripGenerated(fromTmp.stdout)).toBe(stripGenerated(fromAbs.stdout));
  });
});
