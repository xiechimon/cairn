import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { judgeAdoption, Z_THRESHOLD } from '../eval/adoption/judge.mts';
import {
  benchReport,
  casePairsFromJobs,
  minimumDetectableDifference,
  passPow,
  readHarborJob,
  wilsonInterval,
} from '../eval/harbor/score.mts';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function writeTrial(jobDir: string, name: string, body: unknown): void {
  const trialDir = join(jobDir, name);
  mkdirSync(trialDir, { recursive: true });
  writeFileSync(join(trialDir, 'result.json'), JSON.stringify(body));
}

function jobDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'harbor-score-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'result.json'), JSON.stringify({ trial_results: [] }));
  return dir;
}

const scored = (
  taskName: string,
  trialName: string,
  reward: number,
  startedAt: string,
  costUsd = 0,
) => ({
  task_name: taskName,
  trial_name: trialName,
  started_at: startedAt,
  verifier_result: { rewards: { reward } },
  exception_info: null,
  agent_result: {
    cost_usd: costUsd,
    n_input_tokens: 10,
    n_output_tokens: 4,
    n_cache_tokens: 1,
  },
});

describe('harbor score conversion', () => {
  test('an infrastructure failure is excluded and does not count as a miss', () => {
    const dir = jobDir();
    writeTrial(dir, 'alpha__1', scored('alpha', 'alpha__1', 1, '2026-10-26T00:00:00Z', 0.2));
    writeTrial(dir, 'beta__1', {
      task_name: 'beta',
      trial_name: 'beta__1',
      started_at: '2026-10-26T00:00:01Z',
      verifier_result: null,
      exception_info: {
        exception_type: 'EnvironmentStartTimeoutError',
        exception_message: 'Environment start timed out after 1200.0 seconds',
      },
      agent_result: {
        cost_usd: 0.5,
        n_input_tokens: 3,
        n_output_tokens: 0,
        n_cache_tokens: 0,
      },
    });
    const report = benchReport(readHarborJob(dir));
    expect(report.passAt1).toBe(1);
    expect(report.excludedInfra).toBe(1);
    expect(report.scoredTrials).toBe(1);
    expect(report.costUsd).toBeCloseTo(0.7, 12);
    expect(report.nInputTokens).toBe(13);
    const pairs = casePairsFromJobs(readHarborJob(dir), readHarborJob(dir));
    const beta = pairs.find((pair) => pair.caseId === 'beta');
    expect(beta?.before[0]).toEqual({
      kind: 'infra_failure',
      reason: 'sandbox_start',
      detail: 'EnvironmentStartTimeoutError',
    });
    expect(judgeAdoption(pairs).validity.excludedInfra).toBe(1);
  });

  test('a forged reward of zero stays a scored failure', () => {
    const dir = jobDir();
    writeTrial(dir, 'hidden__1', scored('hidden', 'hidden__1', 0, '2026-10-26T00:00:00Z'));
    const [trial] = readHarborJob(dir);
    expect(trial?.outcome).toEqual({ kind: 'scored', score: 0, triggered: true });
    expect(benchReport(readHarborJob(dir)).passAt1).toBe(0);
  });

  test('a reward written beside an exception does not count as a pass', () => {
    const dir = jobDir();
    writeTrial(dir, 'hidden__1', {
      ...scored('hidden', 'hidden__1', 1, '2026-10-26T00:00:00Z'),
      exception_info: {
        exception_type: 'RewardFileNotFoundError',
        exception_message: 'No reward file found',
      },
    });
    const report = benchReport(readHarborJob(dir));
    expect(report.passAt1).toBeNull();
    expect(report.excludedInfra).toBe(1);
    expect(report.scoredTrials).toBe(0);
  });

  test('pass@1 is the macro mean and pass^3 is the unbiased all-success rate', () => {
    const dir = jobDir();
    const rewards = [1, 1, 0, 1, 0];
    for (const [index, reward] of rewards.entries()) {
      writeTrial(
        dir,
        `gamma__${index}`,
        scored('gamma', `gamma__${index}`, reward, `2026-10-26T00:00:0${index}Z`),
      );
    }
    const report = benchReport(readHarborJob(dir));
    expect(report.passAt1).toBeCloseTo(0.6, 12);
    expect(report.passPow3).toBeCloseTo(passPow(3, 5, 3), 12);
    expect(report.passPow3).toBeCloseTo(0.1, 12);
    expect(report.perTask[0]?.scores).toEqual(rewards);
    expect(report.perTask[0]?.minimumDetectableDifference).toBeCloseTo(0.6789639165670001, 12);
  });

  test('wilson interval matches the 8/10 reference', () => {
    expect(wilsonInterval(8, 10, Z_THRESHOLD)).toEqual({
      low: expect.closeTo(0.49015684672072335, 12),
      high: expect.closeTo(0.9433190520193067, 12),
    });
  });

  test('five identical scores have no detectable difference', () => {
    expect(minimumDetectableDifference([1, 1, 1, 1, 1])).toBe(0);
    expect(minimumDetectableDifference([1])).toBeNull();
  });

  test('the gate threshold is the largest five-round difference', () => {
    const dir = jobDir();
    for (const [index, reward] of [1, 1, 0, 1, 0].entries()) {
      writeTrial(
        dir,
        `noisy__${index}`,
        scored('noisy', `noisy__${index}`, reward, `2026-10-26T00:00:0${index}Z`),
      );
    }
    for (let index = 0; index < 5; index += 1) {
      writeTrial(
        dir,
        `quiet__${index}`,
        scored('quiet', `quiet__${index}`, 1, `2026-10-26T00:01:0${index}Z`),
      );
    }
    const report = benchReport(readHarborJob(dir));
    expect(report.gateThreshold).toBeCloseTo(0.6789639165670001, 12);
    expect(report.passAt1).toBeCloseTo((0.6 + 1) / 2, 12);
  });

  test('paired jobs keep the mean score and drop a side with no score', () => {
    const before = jobDir();
    const after = jobDir();
    writeTrial(before, 'alpha__1', scored('alpha', 'alpha__1', 0, '2026-10-26T00:00:00Z'));
    writeTrial(before, 'alpha__2', scored('alpha', 'alpha__2', 0, '2026-10-26T00:00:01Z'));
    writeTrial(after, 'alpha__1', scored('alpha', 'alpha__1', 1, '2026-10-26T00:00:00Z'));
    writeTrial(after, 'alpha__2', scored('alpha', 'alpha__2', 0, '2026-10-26T00:00:01Z'));
    writeTrial(before, 'beta__1', {
      task_name: 'beta',
      trial_name: 'beta__1',
      started_at: '2026-10-26T00:00:02Z',
      verifier_result: null,
      exception_info: { exception_type: 'AgentTimeoutError', exception_message: 'timed out' },
      agent_result: null,
    });
    writeTrial(after, 'beta__1', scored('beta', 'beta__1', 1, '2026-10-26T00:00:02Z'));
    const pairs = casePairsFromJobs(readHarborJob(before), readHarborJob(after));
    expect(pairs).toEqual([
      {
        caseId: 'alpha',
        before: [{ kind: 'scored', score: 0, triggered: true }],
        after: [{ kind: 'scored', score: 0.5, triggered: true }],
      },
      {
        caseId: 'beta',
        before: [{ kind: 'infra_failure', reason: 'timeout', detail: 'AgentTimeoutError' }],
        after: [{ kind: 'scored', score: 1, triggered: true }],
      },
    ]);
    expect(judgeAdoption(pairs).validity.excludedCaseIds).toEqual(['beta']);
  });
});
