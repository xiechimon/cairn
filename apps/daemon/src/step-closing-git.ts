import type {
  BoundGitCredentials,
  ClaimedStep,
  CommitIdentity,
  GitCredentialSource,
  GitIdentity,
  PreparedWorkspace,
  WorktreeOps,
} from '@cairn/shared';
import { AGENT_TOOL_PUSH, BRAND, gitCredentialRowContent, withCoAuthor } from '@cairn/shared';

export interface ClosingGitInput {
  git: WorktreeOps;
  ws: PreparedWorkspace;
  claimed: ClaimedStep;
  stepId: string;
  coAuthor: GitIdentity | null;
  identity: CommitIdentity;
  mergeCredential: BoundGitCredentials | null;
  headAtStart: string | null;
  stepStartMs: number;
  push: () => Promise<GitCredentialSource>;
  note: (id: string, content: string) => void;
  log: (message: string) => void;
  logRaw: (message: string) => void;
}

export interface ClosingGitOutcome {
  headCommit: string | null;
  branchDrift: { expected: string; actual: string } | null;
  artifactBranches: string[];
  hasChanges: boolean | null;
  error: unknown;
}

export async function commitAndPushStep(input: ClosingGitInput): Promise<ClosingGitOutcome> {
  const { git, ws, claimed, stepId, note, log } = input;
  const outcome: ClosingGitOutcome = {
    headCommit: null,
    branchDrift: null,
    artifactBranches: [],
    hasChanges: null,
    error: null,
  };
  try {
    const headBranch = (await git.currentBranch?.(ws.cwd)) ?? null;
    if (headBranch !== null && headBranch !== ws.branch) {
      outcome.branchDrift = { expected: ws.branch, actual: headBranch };
      log(`work branch drift: HEAD on ${headBranch}, contract branch ${ws.branch}`);
      note(
        `branch-drift-${stepId}`,
        `检测到工作分支偏离：收尾时 HEAD 在「${headBranch}」，契约工作分支是「${ws.branch}」。本步产物判定已按步窗口内有新提交的任意分支放宽；交付（提交/推送/PR head）应留在契约分支上。`,
      );
    }
    const commitMessage = `${claimed.step.kind}: ${claimed.todo?.title ?? claimed.conversationId}`;
    const committed = await git.commitAll(
      ws.cwd,
      withCoAuthor(commitMessage, input.coAuthor),
      input.identity,
    );
    if (committed.setupDrift.length > 0) {
      note(
        `setup-drift-${stepId}`,
        `Workspace setup changed ${committed.setupDrift.join(', ')}; these changes were left out of the commit because the agent did not make them.`,
      );
    }
    if (claimed.step.kind === 'merge') {
      const merged = await git.mergeDefaultBranch(ws.cwd, ws.defaultBranch, input.mergeCredential);
      note(
        `merge-${stepId}`,
        `git merge origin/${ws.defaultBranch} 结果为 "${merged.output || 'OK'}"`,
      );
    }
    const pushDenied =
      claimed.agent?.tools !== undefined && !claimed.agent.tools.includes(AGENT_TOOL_PUSH);
    const pushWarranted =
      committed.committed ||
      claimed.step.kind === 'merge' ||
      (await git.countAhead(ws.cwd, ws.defaultBranch)) > 0;
    if (pushWarranted && pushDenied) {
      note(
        `push-skip-${stepId}`,
        `Agent 未获「${AGENT_TOOL_PUSH}」授权——本轮提交保留在本地工作分支 ${ws.branch}，未推送到远端`,
      );
      log(`push skipped: agent lacks ${AGENT_TOOL_PUSH} permission`);
    } else if (pushWarranted) {
      const pushSource = await input.push();
      if (pushSource === 'machine') {
        note(`git-credential-${stepId}`, gitCredentialRowContent('machine'));
      }
      input.logRaw(`pushed ${ws.branch}`);
      try {
        const leaked = (await git.briefMarkerInRef?.(ws.cwd, ws.branch)) ?? [];
        if (leaked.length > 0) {
          log(`brief marker found in the pushed branch: ${leaked.join(', ')}`);
          note(
            `brief-in-history-${stepId}`,
            `分支 ${ws.branch} 的历史里带着运行简报的标记块（${leaked.join('、')}）——agent 在步内自行提交时 daemon 拦不住。合并前请确认这些文件不该进交付物`,
          );
        }
      } catch (err) {
        log(`brief marker scan failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    outcome.headCommit = await git.headCommit(ws.cwd);
    const headAhead = await git.countAhead(ws.cwd, ws.defaultBranch);
    if (headAhead === 0 && input.headAtStart !== null && git.branchesWithNewCommits) {
      try {
        const candidates = await git.branchesWithNewCommits(
          ws.cwd,
          input.headAtStart,
          input.stepStartMs,
        );
        outcome.artifactBranches = candidates.filter(
          (b) => b === ws.branch || !b.startsWith(BRAND.branchPrefix),
        );
      } catch (err) {
        log(`branch scan failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    outcome.hasChanges = headAhead > 0 || outcome.artifactBranches.length > 0;
  } catch (err) {
    outcome.error = err;
  }
  return outcome;
}
