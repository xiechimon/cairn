import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  type CasePair,
  type InfraFailureReason,
  judgeAdoption,
  MAX_INFRA_RETRIES,
  type TrialOutcome,
  Z_THRESHOLD,
} from '../adoption/judge.mts';

export interface HarborTrialView {
  caseId: string;
  trialName: string;
  startedAt: string;
  outcome: TrialOutcome;
  costUsd: number;
  nInputTokens: number;
  nOutputTokens: number;
  nCacheTokens: number;
}

export interface WilsonInterval {
  low: number;
  high: number;
}

export interface TaskVariance {
  caseId: string;
  scores: number[];
  mean: number;
  sd: number;
  minimumDetectableDifference: number | null;
}

export interface BenchReport {
  passAt1: number | null;
  passPow3: number | null;
  wilson: WilsonInterval | null;
  scoredTrials: number;
  excludedInfra: number;
  costUsd: number;
  nInputTokens: number;
  nOutputTokens: number;
  nCacheTokens: number;
  perTask: TaskVariance[];
  gateThreshold: number | null;
}

interface RewardFile {
  rewards?: Record<string, unknown> | null;
}

interface ExceptionFile {
  exception_type?: string;
  exception_message?: string;
}

interface AgentFile {
  cost_usd?: number | null;
  n_input_tokens?: number | null;
  n_output_tokens?: number | null;
  n_cache_tokens?: number | null;
}

interface TrialFile {
  task_name?: string;
  trial_name?: string;
  started_at?: string | null;
  verifier_result?: RewardFile | null;
  exception_info?: ExceptionFile | null;
  agent_result?: AgentFile | null;
  trial_results?: TrialFile[];
}

function infraReason(exceptionType: string, message: string): InfraFailureReason {
  const text = `${exceptionType}\n${message}`.toLowerCase();
  if (text.includes('environmentstart') || text.includes('sandbox')) return 'sandbox_start';
  if (text.includes('timeout') || text.includes('timed out')) return 'timeout';
  if (
    /\b(429|500|502|503|504)\b/.test(text) ||
    text.includes('ratelimit') ||
    text.includes('rate limit') ||
    text.includes('provider')
  ) {
    return 'provider_5xx';
  }
  if (
    text.includes('network') ||
    text.includes('econn') ||
    text.includes('enotfound') ||
    text.includes('fetch failed')
  ) {
    return 'network';
  }
  return 'exception';
}

function rewardValue(rewards: Record<string, unknown> | null | undefined): number | null {
  if (!rewards) return null;
  const named = rewards.reward;
  if (typeof named === 'number') return named;
  const values = Object.values(rewards).filter((value) => typeof value === 'number');
  if (values.length !== 1) return null;
  return values[0] ?? null;
}

function outcomeOf(trial: TrialFile): TrialOutcome {
  const exceptionType = trial.exception_info?.exception_type;
  if (exceptionType) {
    return {
      kind: 'infra_failure',
      reason: infraReason(exceptionType, trial.exception_info?.exception_message ?? ''),
      detail: exceptionType,
    };
  }
  const reward = rewardValue(trial.verifier_result?.rewards);
  if (reward === null)
    return { kind: 'infra_failure', reason: 'exception', detail: 'missing reward' };
  if (!Number.isFinite(reward)) throw new Error(`non-finite harbor reward ${reward}`);
  return { kind: 'scored', score: reward, triggered: true };
}

function viewOf(trial: TrialFile): HarborTrialView | null {
  if (!trial.task_name || !trial.trial_name) return null;
  const agent = trial.agent_result;
  return {
    caseId: trial.task_name,
    trialName: trial.trial_name,
    startedAt: trial.started_at ?? '',
    outcome: outcomeOf(trial),
    costUsd: agent?.cost_usd ?? 0,
    nInputTokens: agent?.n_input_tokens ?? 0,
    nOutputTokens: agent?.n_output_tokens ?? 0,
    nCacheTokens: agent?.n_cache_tokens ?? 0,
  };
}

function readJson(path: string): TrialFile | null {
  try {
    if (!statSync(path).isFile()) return null;
  } catch {
    return null;
  }
  return JSON.parse(readFileSync(path, 'utf8')) as TrialFile;
}

export function readHarborJob(jobDir: string): HarborTrialView[] {
  const root = readJson(join(jobDir, 'result.json'));
  const embedded = root?.trial_results ?? [];
  const files =
    embedded.length > 0
      ? embedded
      : readdirSync(jobDir, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => readJson(join(jobDir, entry.name, 'result.json')))
          .filter((trial): trial is TrialFile => trial !== null);
  return files
    .map(viewOf)
    .filter((trial): trial is HarborTrialView => trial !== null)
    .sort(
      (a, b) => a.startedAt.localeCompare(b.startedAt) || a.trialName.localeCompare(b.trialName),
    );
}

export function passPow(correct: number, attempts: number, k: number): number {
  if (correct < k || attempts < k) return 0;
  let product = 1;
  for (let i = 0; i < k; i += 1) product *= (correct - i) / (attempts - i);
  return product;
}

export function wilsonInterval(
  successes: number,
  attempts: number,
  z: number,
): WilsonInterval | null {
  if (attempts <= 0) return null;
  const ratio = successes / attempts;
  const z2 = z * z;
  const denom = 1 + z2 / attempts;
  const center = (ratio + z2 / (2 * attempts)) / denom;
  const half =
    (z * Math.sqrt((ratio * (1 - ratio)) / attempts + z2 / (4 * attempts * attempts))) / denom;
  return { low: center - half, high: center + half };
}

export function minimumDetectableDifference(scores: number[]): number | null {
  const n = scores.length;
  if (n < 2) return null;
  const mean = scores.reduce((sum, score) => sum + score, 0) / n;
  const sd = Math.sqrt(scores.reduce((sum, score) => sum + (score - mean) ** 2, 0) / (n - 1));
  if (sd === 0) return 0;
  return Z_THRESHOLD * sd * Math.sqrt(2 / n);
}

function scoredValue(trial: HarborTrialView): number | null {
  return trial.outcome.kind === 'scored' ? trial.outcome.score : null;
}

export function benchReport(trials: HarborTrialView[]): BenchReport {
  const excludedInfra = trials.filter((trial) => trial.outcome.kind === 'infra_failure').length;
  const scored = trials.flatMap((trial) => {
    const score = scoredValue(trial);
    return score === null ? [] : [{ trial, score }];
  });
  const binary = scored.every((row) => row.score === 0 || row.score === 1);
  const byTask = new Map<string, number[]>();
  for (const row of scored) {
    const scores = byTask.get(row.trial.caseId) ?? [];
    scores.push(row.score);
    byTask.set(row.trial.caseId, scores);
  }
  const perTask = [...byTask.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([caseId, scores]): TaskVariance => {
      const mean = scores.reduce((sum, score) => sum + score, 0) / scores.length;
      const sd =
        scores.length < 2
          ? 0
          : Math.sqrt(
              scores.reduce((sum, score) => sum + (score - mean) ** 2, 0) / (scores.length - 1),
            );
      return {
        caseId,
        scores,
        mean,
        sd,
        minimumDetectableDifference: minimumDetectableDifference(scores),
      };
    });
  const passAt1 =
    binary && perTask.length > 0
      ? perTask.reduce((sum, task) => {
          const passes = task.scores.filter((score) => score === 1).length;
          return sum + passes / task.scores.length;
        }, 0) / perTask.length
      : null;
  const powered = perTask.filter((task) => task.scores.length >= 3);
  const passPow3 =
    binary && powered.length > 0
      ? powered.reduce((sum, task) => {
          const passes = task.scores.filter((score) => score === 1).length;
          return sum + passPow(passes, task.scores.length, 3);
        }, 0) / powered.length
      : null;
  const successes = scored.filter((row) => row.score === 1).length;
  const thresholds = perTask
    .filter((task) => task.scores.length >= 5)
    .map((task) => task.minimumDetectableDifference)
    .filter((value): value is number => value !== null);
  return {
    passAt1,
    passPow3,
    wilson: binary ? wilsonInterval(successes, scored.length, Z_THRESHOLD) : null,
    scoredTrials: scored.length,
    excludedInfra,
    costUsd: trials.reduce((sum, trial) => sum + trial.costUsd, 0),
    nInputTokens: trials.reduce((sum, trial) => sum + trial.nInputTokens, 0),
    nOutputTokens: trials.reduce((sum, trial) => sum + trial.nOutputTokens, 0),
    nCacheTokens: trials.reduce((sum, trial) => sum + trial.nCacheTokens, 0),
    perTask,
    gateThreshold: thresholds.length === 0 ? null : Math.max(...thresholds),
  };
}

function sideOutcomes(trials: HarborTrialView[]): TrialOutcome[] {
  const ordered = [...trials].sort(
    (a, b) => a.startedAt.localeCompare(b.startedAt) || a.trialName.localeCompare(b.trialName),
  );
  const scored = ordered.flatMap((trial) => {
    const score = scoredValue(trial);
    return score === null ? [] : [score];
  });
  if (scored.length === 0) {
    return ordered
      .filter((trial) => trial.outcome.kind === 'infra_failure')
      .map((trial) => trial.outcome)
      .slice(0, MAX_INFRA_RETRIES + 1);
  }
  return [
    {
      kind: 'scored',
      score: scored.reduce((sum, score) => sum + score, 0) / scored.length,
      triggered: true,
    },
  ];
}

export function casePairsFromJobs(before: HarborTrialView[], after: HarborTrialView[]): CasePair[] {
  const caseIds = [...new Set([...before, ...after].map((trial) => trial.caseId))].sort((a, b) =>
    a.localeCompare(b),
  );
  return caseIds.map((caseId) => ({
    caseId,
    before: sideOutcomes(before.filter((trial) => trial.caseId === caseId)),
    after: sideOutcomes(after.filter((trial) => trial.caseId === caseId)),
  }));
}

export function reportText(paths: string[]): string {
  const [beforePath, afterPath] = paths;
  if (!beforePath || paths.length > 2) throw new Error('usage: score.mts <job> [other-job]');
  if (!afterPath) return `${JSON.stringify(benchReport(readHarborJob(beforePath)), null, 2)}\n`;
  const before = readHarborJob(beforePath);
  const after = readHarborJob(afterPath);
  return `${JSON.stringify(
    {
      before: benchReport(before),
      after: benchReport(after),
      verdict: judgeAdoption(casePairsFromJobs(before, after)),
    },
    null,
    2,
  )}\n`;
}

const invoked = process.argv[1];
if (invoked && import.meta.url === pathToFileURL(invoked).href) {
  process.stdout.write(reportText(process.argv.slice(2)));
}
