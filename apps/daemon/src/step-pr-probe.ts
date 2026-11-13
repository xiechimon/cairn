import type { BoundGitCredentials } from '@cairn/shared';
import { CHANGES_DIFF_MAX_BYTES } from '@cairn/shared';
import { type GithubPrProbe, githubRepoRefOf, probeGithubPr } from './github-probe.js';

const PROBE_HEADS_MAX = 3;

export interface StepPrProbeInput {
  cloneUrl: string;
  branch: string;
  driftBranch: string | null;
  artifactBranches: readonly string[];
  baseBranch: string;
  credential: BoundGitCredentials | null;
  refreshToken: (() => Promise<string>) | null;
  log: (message: string) => void;
}

export function stepProbeHeads(
  branch: string,
  driftBranch: string | null,
  artifactBranches: readonly string[],
): string[] {
  const heads: string[] = [branch];
  if (driftBranch !== null) heads.push(driftBranch);
  for (const b of artifactBranches) {
    if (heads.length >= PROBE_HEADS_MAX) break;
    if (!heads.includes(b)) heads.push(b);
  }
  return heads;
}

export async function probeStepPr(input: StepPrProbeInput): Promise<GithubPrProbe | null> {
  const ghRef = githubRepoRefOf(input.cloneUrl);
  if (ghRef === null) return null;
  const refreshToken = input.refreshToken;
  for (const head of stepProbeHeads(input.branch, input.driftBranch, input.artifactBranches)) {
    const probe = await probeGithubPr({
      owner: ghRef.owner,
      repo: ghRef.repo,
      branch: head,
      baseBranch: input.baseBranch,
      token: input.credential?.password ?? null,
      tokenKind: input.credential?.kind,
      ...(refreshToken !== null ? { refreshToken } : {}),
    }).catch((err: unknown) => {
      input.log(
        `pr probe failed: ${err instanceof Error ? err.message : String(err)} (panel will show branch without PR)`,
      );
      return null;
    });
    if (probe !== null) {
      input.log(`pr probe: #${probe.number} for ${head}`);
      return probe;
    }
  }
  return null;
}

export async function boundedChangesDiff(
  diffAgainstDefault: (cwd: string, defaultBranch: string) => Promise<string>,
  cwd: string,
  defaultBranch: string,
  log: (message: string) => void,
): Promise<string | null> {
  try {
    const diff = await diffAgainstDefault(cwd, defaultBranch);
    if (diff.length <= CHANGES_DIFF_MAX_BYTES) return diff;
    if (diff.length > 0) {
      log(
        `changes diff ${diff.length}B over ${CHANGES_DIFF_MAX_BYTES}B cap — projection falls back to empty`,
      );
    }
    return null;
  } catch (err) {
    log(`changes diff failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
