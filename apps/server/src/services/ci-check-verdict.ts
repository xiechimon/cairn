import type { GithubCheckRun } from '../lib/github.js';

export interface CiCheckFailure {
  name: string;
  conclusion: string;
  summary: string | null;
}

export type CheckVerdict =
  | { state: 'green' }
  | { state: 'pending'; missing?: string[] }
  | { state: 'empty' }
  | { state: 'red'; failures: CiCheckFailure[] }
  | { state: 'blocked'; checks: { name: string; conclusion: string }[] };

const FIXABLE = new Set(['failure', 'timed_out']);
const BLOCKING_UNREQUIRED = new Set(['cancelled', 'action_required']);

function newerCheckRun(candidate: GithubCheckRun, current: GithubCheckRun): boolean {
  if (typeof candidate.id === 'number' && typeof current.id === 'number') {
    return candidate.id > current.id;
  }
  const candidateAt = typeof candidate.completedAt === 'number' ? candidate.completedAt : null;
  const currentAt = typeof current.completedAt === 'number' ? current.completedAt : null;
  if (candidateAt !== null && currentAt !== null) return candidateAt > currentAt;
  if (candidateAt !== null) return true;
  if (currentAt !== null) return false;
  return candidate.conclusion === 'success' && current.conclusion !== 'success';
}

export function latestCompletedCheckRuns(runs: readonly GithubCheckRun[]): GithubCheckRun[] {
  const latest = new Map<string, GithubCheckRun>();
  for (const run of runs) {
    if (run.status !== 'completed') continue;
    const seen = latest.get(run.name);
    if (seen === undefined || newerCheckRun(run, seen)) latest.set(run.name, run);
  }
  return [...latest.values()];
}

export function verdictOfCheckRuns(runs: GithubCheckRun[], required: string[] = []): CheckVerdict {
  const counted = required.length > 0 ? runs.filter((r) => required.includes(r.name)) : runs;
  if (required.length === 0 && counted.length === 0) return { state: 'empty' };
  if (counted.some((r) => r.status !== 'completed')) return { state: 'pending' };
  const current = latestCompletedCheckRuns(counted);
  const failures = current
    .filter((r) => FIXABLE.has(r.conclusion ?? ''))
    .map((r) => ({
      name: r.name,
      conclusion: r.conclusion ?? '',
      summary: r.outputSummary ?? r.outputTitle,
    }));
  if (failures.length > 0) return { state: 'red', failures };
  const missing = required.filter((name) => !current.some((r) => r.name === name));
  if (missing.length > 0) return { state: 'pending', missing };
  const blocked = new Map<string, Set<string>>();
  for (const r of current) {
    if (r.conclusion === 'success') continue;
    if (required.length === 0 && !BLOCKING_UNREQUIRED.has(r.conclusion ?? '')) continue;
    blocked.set(r.name, (blocked.get(r.name) ?? new Set()).add(r.conclusion ?? ''));
  }
  if (blocked.size > 0) {
    return {
      state: 'blocked',
      checks: [...blocked].map(([name, c]) => ({ name, conclusion: [...c].join('/') })),
    };
  }
  return { state: 'green' };
}
