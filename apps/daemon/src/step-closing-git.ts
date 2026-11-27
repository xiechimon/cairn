import type {
  BoundGitCredentials,
  ClaimedStep,
  CommitIdentity,
  GitCredentialSource,
  PreparedWorkspace,
  WorktreeOps,
} from '@cairn/shared';
import { AGENT_TOOL_PUSH, BRAND, gitCredentialRowContent, isBuildStepKind } from '@cairn/shared';

export interface ClosingGitInput {
  git: WorktreeOps;
  ws: PreparedWorkspace;
  claimed: ClaimedStep;
  stepId: string;
  identity: CommitIdentity;
  mergeCredential: BoundGitCredentials | null;
  headAtStart: string | null;
  stepStartMs: number;
  push: () => Promise<GitCredentialSource>;
  env?: NodeJS.ProcessEnv;
  note: (id: string, content: string) => void;
  log: (message: string) => void;
  logRaw: (message: string) => void;
}

export interface ClosingGitOutcome {
  headCommit: string | null;
  branchDrift: { expected: string; actual: string } | null;
  artifactBranches: string[];
  hasChanges: boolean | null;
  unpushedCommits?: number | null;
  error: { cause: unknown; duringPush: boolean } | null;
}

async function countObserveOnlyUnpushed(
  git: WorktreeOps,
  cwd: string,
  refs: readonly string[],
  log: (message: string) => void,
): Promise<number | null> {
  if (refs.length === 0) return 0;
  if (git.unpushedCommitCount === undefined) return null;
  try {
    let total = 0;
    for (const ref of refs) {
      total += await git.unpushedCommitCount(cwd, ref);
    }
    return total;
  } catch (err) {
    log(`unpushed commit count failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
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
  let duringPush = false;
  try {
    const repoKind = claimed.project?.repo?.kind;
    const headBranch = (await git.currentBranch?.(ws.cwd)) ?? null;
    const observeOnly =
      claimed.step.kind !== 'merge' &&
      (repoKind === 'github' ||
        (repoKind === 'local' && headBranch !== null && headBranch !== ws.branch));
    if (observeOnly) {
      let fetchFailed = false;
      if (git.fetchBranch !== undefined) {
        const fetched = await git.fetchBranch(ws.cwd, ws.defaultBranch).catch(() => false);
        if (!fetched) fetchFailed = true;
      }
      const headCommit = await git.headCommit(ws.cwd);
      outcome.headCommit = headCommit;
      const headAhead = await git.countAhead(ws.cwd, ws.defaultBranch);
      const scanned: string[] = [];
      let scanProbeFailed = false;
      if (
        (headAhead === 0 || repoKind === 'github') &&
        input.headAtStart !== null &&
        git.branchesWithNewCommits
      ) {
        try {
          const candidates = await git.branchesWithNewCommits(
            ws.cwd,
            input.headAtStart,
            input.stepStartMs,
          );
          scanned.push(
            ...candidates.filter((b) => b === ws.branch || !b.startsWith(BRAND.branchPrefix)),
          );
        } catch (err) {
          scanProbeFailed = true;
          log(`branch scan failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      const artifactScanned = headAhead === 0 ? scanned : [];
      const probeBranches: string[] = [];
      if (
        headBranch !== null &&
        headBranch !== ws.branch &&
        !headBranch.startsWith(BRAND.branchPrefix)
      ) {
        probeBranches.push(headBranch);
      }
      for (const b of artifactScanned) {
        if (!probeBranches.includes(b)) probeBranches.push(b);
      }
      outcome.artifactBranches = probeBranches;
      const landed =
        headCommit !== null &&
        input.headAtStart !== null &&
        headCommit !== input.headAtStart &&
        (await git.isAncestor?.(ws.cwd, headCommit, `refs/remotes/origin/${ws.defaultBranch}`)) ===
          true &&
        (await git.hasCommitsSince?.(ws.cwd, input.headAtStart, input.stepStartMs)) === true;
      if (landed) {
        log(`observed landed commit ${headCommit} on origin/${ws.defaultBranch}`);
        note(
          `landed-${stepId}`,
          `Observed landed commit ${headCommit.slice(0, 7)} on origin/${ws.defaultBranch}.`,
        );
      }
      outcome.hasChanges = headAhead > 0 || artifactScanned.length > 0 || landed;
      if (repoKind === 'github') {
        if (landed) {
          outcome.unpushedCommits = 0;
        } else {
          const refsToCheck = ['HEAD', ...scanned.filter((b) => b !== headBranch)];
          const counted = await countObserveOnlyUnpushed(
            git,
            ws.cwd,
            [...new Set(refsToCheck)],
            log,
          );
          outcome.unpushedCommits =
            counted === null
              ? null
              : counted > 0
                ? counted
                : fetchFailed || scanProbeFailed
                  ? null
                  : 0;
        }
      }
      return outcome;
    }
    const commitMessage = `${claimed.step.kind}: ${claimed.todo?.title ?? claimed.conversationId}`;
    const committed = await git.commitAll(ws.cwd, commitMessage, input.identity);
    if (committed.setupDrift.length > 0) {
      note(
        `setup-drift-${stepId}`,
        `Workspace setup changed ${committed.setupDrift.join(', ')}; these changes were left out of the commit because the agent did not make them.`,
      );
    }
    if (claimed.step.kind === 'merge') {
      const merged = await git.mergeDefaultBranch(
        ws.cwd,
        ws.defaultBranch,
        input.mergeCredential,
        input.env,
      );
      note(
        `merge-${stepId}`,
        `git merge origin/${ws.defaultBranch} 结果为 "${merged.output || 'OK'}"`,
      );
    }
    const pushDenied =
      ws.plainFolder === undefined &&
      claimed.agent?.tools !== undefined &&
      !claimed.agent.tools.includes(AGENT_TOOL_PUSH);
    const pushWarranted =
      ws.plainFolder !== undefined
        ? isBuildStepKind(claimed.step.kind)
        : committed.committed ||
          claimed.step.kind === 'merge' ||
          (await git.countAhead(ws.cwd, ws.defaultBranch)) > 0;
    if (pushWarranted && pushDenied) {
      note(
        `push-skip-${stepId}`,
        `Agent 未获「${AGENT_TOOL_PUSH}」授权——本轮提交保留在本地工作分支 ${ws.branch}，未推送到远端`,
      );
      log(`push skipped: agent lacks ${AGENT_TOOL_PUSH} permission`);
    } else if (pushWarranted) {
      duringPush = true;
      const pushSource = await input.push();
      duringPush = false;
      if (ws.plainFolder !== undefined) {
        const plainMeta = git.plainFolderMeta?.(ws.cwd) ?? null;
        if (plainMeta?.status === 'conflict') {
          const list = plainMeta.conflictFiles?.join('、') ?? '';
          note(
            `plain-folder-conflict-${stepId}`,
            `以下文件在你的本地文件夹里也有冲突改动，未自动覆盖原文件夹：${list}。任务改动已保留在本次任务记录中。`,
          );
        } else if (plainMeta?.status === 'disabled') {
          note(
            `plain-folder-disabled-${stepId}`,
            '本地文件夹快照超时，本轮已停用保护快照（未中断任务运行）。',
          );
        } else if (
          plainMeta !== null &&
          plainMeta.status !== 'merged' &&
          plainMeta.status !== 'no-changes'
        ) {
          note(
            `plain-folder-status-${stepId}`,
            plainMeta.reason ?? `本地文件夹写回未完成（${plainMeta.status}）。`,
          );
        }
      } else {
        if (pushSource === 'machine' && repoKind === 'github') {
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
    outcome.error = { cause: err, duringPush };
  }
  return outcome;
}

export interface PreservedBuild {
  headCommit: string | null;
  commits: string[];
}

export async function preserveFailedBuild(input: {
  git: WorktreeOps;
  ws: PreparedWorkspace;
  claimed: ClaimedStep;
  push: () => Promise<GitCredentialSource>;
  log: (message: string) => void;
  logRaw: (message: string) => void;
}): Promise<PreservedBuild | null> {
  const { git, ws, claimed } = input;
  if (claimed.project?.repo?.kind === 'github' || ws.plainFolder !== undefined) return null;
  try {
    const currentBranch = await git.currentBranch?.(ws.cwd);
    const pushAllowed =
      claimed.agent?.tools === undefined || claimed.agent.tools.includes(AGENT_TOOL_PUSH);
    if (
      currentBranch !== ws.branch ||
      !pushAllowed ||
      (await git.countAhead(ws.cwd, ws.defaultBranch)) <= 0
    )
      return null;
    await input.push();
    const headCommit = await git.headCommit(ws.cwd);
    const commits =
      (await git.commitsAhead?.(ws.cwd, ws.defaultBranch)) ??
      (headCommit === null ? [] : [headCommit]);
    input.logRaw(`pushed ${ws.branch}`);
    return { headCommit, commits };
  } catch (err) {
    input.log(
      `failed build preservation failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}
