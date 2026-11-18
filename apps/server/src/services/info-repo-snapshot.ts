import type { step, todo } from '../db/schema.js';
import { runGit } from '../lib/git.js';
import { githubRepoOfProject, projectOfTodo, repoDirFor } from './git.js';
import { githubReadToken } from './github-autonomous-token.js';
import type { MachineDeps } from './machine-deps.js';
import { requestRepoArchive } from './machine-repo-archive.js';
import { profileForStep } from './routing-rules.js';

export const INFO_SNAPSHOT_MAX_BYTES = 6 * 1024 * 1024;
const SNAPSHOT_TIMEOUT_MS = 60_000;

type TodoRow = typeof todo.$inferSelect;
type StepRow = typeof step.$inferSelect;

export function infoRepoOffered(deps: Pick<MachineDeps, 'db'>, todoRow: TodoRow): boolean {
  const project = projectOfTodo(deps.db, todoRow);
  return (
    project !== undefined &&
    ((project.repoKind === 'hosted' && project.repoName !== null) ||
      (project.repoKind === 'local' && project.localPath !== null) ||
      githubRepoOfProject(project) !== null)
  );
}

export async function infoRepoSnapshot(
  deps: MachineDeps,
  todoRow: TodoRow,
  stepRow: StepRow,
  signal: AbortSignal | undefined,
): Promise<{ tarGz: Buffer } | { reason: string } | null> {
  const project = projectOfTodo(deps.db, todoRow);
  if (project === undefined) return null;
  if (project.repoKind === 'local' && project.localPath !== null) {
    const ref = project.baseBranch ?? 'HEAD';
    if (ref.startsWith('-')) return { reason: 'the default branch name is not valid' };
    const holder = profileForStep(deps.db, todoRow, stepRow.kind, stepRow.id)?.machineId ?? null;
    if (holder === null) return { reason: 'no Runner is set for this project' };
    return requestRepoArchive(
      deps,
      holder,
      {
        stepId: stepRow.id,
        directory: project.localPath,
        ref,
        maxBytes: INFO_SNAPSHOT_MAX_BYTES,
      },
      signal,
    );
  }
  if (project.repoKind === 'hosted' && project.repoName !== null) {
    if (deps.reposDir === undefined) return { reason: 'hosted repositories are not configured' };
    const dir = repoDirFor(deps.reposDir, project.teamId, project.repoName);
    const ref = project.baseBranch ?? 'HEAD';
    if (ref.startsWith('-')) return { reason: 'the default branch name is not valid' };
    const verified = await runGit(
      ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`],
      {
        cwd: dir,
        timeoutMs: SNAPSHOT_TIMEOUT_MS,
      },
    );
    if (verified.code !== 0) return { reason: 'the default branch does not exist' };
    const ran = await runGit(
      ['archive', '--format=tar.gz', verified.stdout.toString('utf8').trim()],
      {
        cwd: dir,
        timeoutMs: SNAPSHOT_TIMEOUT_MS,
      },
    );
    if (ran.code !== 0) return { reason: ran.stderr.trim().slice(0, 300) || 'git archive failed' };
    return ran.stdout.length > INFO_SNAPSHOT_MAX_BYTES
      ? { reason: `the snapshot is larger than ${INFO_SNAPSHOT_MAX_BYTES} bytes` }
      : { tarGz: ran.stdout };
  }
  const github = githubRepoOfProject(project);
  if (github === null) return null;
  const token = await githubReadToken(deps, project.teamId, github);
  if (token === null) return { reason: 'no GitHub read access for this repository' };
  const response = await fetch(
    `https://api.github.com/repos/${github.owner}/${github.repo}/tarball/${encodeURIComponent(project.baseBranch ?? 'HEAD')}`,
    { headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' } },
  );
  if (!response.ok) return { reason: `GitHub answered ${response.status}` };
  const bytes = Buffer.from(await response.arrayBuffer());
  return bytes.length > INFO_SNAPSHOT_MAX_BYTES
    ? { reason: `the snapshot is larger than ${INFO_SNAPSHOT_MAX_BYTES} bytes` }
    : { tarGz: bytes };
}
