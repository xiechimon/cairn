import {
  type FetchLike,
  type GithubCheckRun,
  githubCommitCheckRuns,
  githubRequiredChecks,
} from '../lib/github.js';
import type { AnonReadBudget } from './ci-anon-budget.js';
import { type CheckVerdict, verdictOfCheckRuns } from './ci-check-verdict.js';
import { CI_EMPTY_CHECKS_GRACE_MS } from './ci-loop-rows.js';

export const CI_REQUIRED_CHECKS_TTL_MS = 600_000;

interface CheckRunsEntry {
  sha: string;
  etag: string | null;
  runs: GithubCheckRun[];
  waitSince: number | null;
}

export type SettledCheckVerdict = Exclude<CheckVerdict, { state: 'pending' }>;

export type GrindChecksRead =
  | { kind: 'unreadable' }
  | { kind: 'pending' }
  | { kind: 'settled'; verdict: SettledCheckVerdict };

export class GrindCheckReader {
  private readonly runs = new Map<string, CheckRunsEntry>();
  private readonly required = new Map<string, { at: number; names: string[] | null }>();

  constructor(
    private readonly githubFetch: FetchLike,
    private readonly anonBudget: AnonReadBudget,
  ) {}

  private async requiredNames(
    target: { owner: string; repo: string; fullName: string },
    baseBranch: string,
    token: string | null,
    now: number,
  ): Promise<string[] | null> {
    const reqKey = `${target.fullName}\u0000${baseBranch}`;
    let required = this.required.get(reqKey);
    if (
      required === undefined ||
      (required.names === null
        ? required.at !== now
        : now - required.at >= CI_REQUIRED_CHECKS_TTL_MS)
    ) {
      if (token === null) this.anonBudget.recordShared(now, 2);
      const names = await githubRequiredChecks(
        this.githubFetch,
        token,
        target.owner,
        target.repo,
        baseBranch,
      );
      required = { at: now, names };
      this.required.set(reqKey, required);
    }
    return required.names;
  }

  async read(
    target: { owner: string; repo: string; fullName: string },
    key: string,
    baseBranch: string,
    ref: string,
    token: string | null,
    now: number,
  ): Promise<GrindChecksRead> {
    const requiredNames = await this.requiredNames(target, baseBranch, token, now);
    if (requiredNames === null) return { kind: 'unreadable' };
    const cached = this.runs.get(key);
    const entry = cached?.sha === ref ? cached : null;
    if (token === null) this.anonBudget.recordShared(now);
    const page = await githubCommitCheckRuns(
      this.githubFetch,
      token,
      target.owner,
      target.repo,
      ref,
      { etag: entry?.etag ?? null },
    );
    if (page === null) return { kind: 'unreadable' };
    const runs = page.notModified ? (entry?.runs ?? []) : page.checkRuns;
    const verdict = verdictOfCheckRuns(runs, requiredNames);
    const waiting =
      verdict.state === 'empty' ||
      (verdict.state === 'pending' &&
        (verdict.missing !== undefined || (entry?.waitSince ?? null) !== null));
    const waitSince = waiting ? (entry?.waitSince ?? now) : null;
    this.runs.set(key, { sha: ref, etag: page.etag, runs, waitSince });
    const inGrace = now - (waitSince ?? now) < CI_EMPTY_CHECKS_GRACE_MS;
    if (verdict.state === 'pending') {
      if (verdict.missing === undefined || inGrace) return { kind: 'pending' };
      return {
        kind: 'settled',
        verdict: {
          state: 'blocked',
          checks: verdict.missing.map((name) => ({ name, conclusion: 'missing' })),
        },
      };
    }
    if (verdict.state === 'empty' && inGrace) return { kind: 'pending' };
    return { kind: 'settled', verdict };
  }

  retain(keys: ReadonlySet<string>, now: number): void {
    for (const k of this.runs.keys()) if (!keys.has(k)) this.runs.delete(k);
    for (const [k, v] of this.required)
      if (now - v.at >= CI_REQUIRED_CHECKS_TTL_MS) this.required.delete(k);
  }
}
