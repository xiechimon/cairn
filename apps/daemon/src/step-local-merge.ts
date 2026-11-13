import type { ClaimedStep, LocalMergeCommand, MachineDoneBody } from '@cairn/shared';
import { AGENT_TOOL_MERGE, AGENT_TOOL_PUSH } from '@cairn/shared';
import { landLocalMerge } from './local-merge.js';

export async function localMergeDoneBody(
  claimed: ClaimedStep,
  command: LocalMergeCommand,
  stopRequested: () => boolean,
): Promise<MachineDoneBody> {
  const repo = claimed.project?.repo;
  try {
    if (
      claimed.step.kind !== 'merge' ||
      repo?.kind !== 'local' ||
      claimed.project?.id !== command.projectId ||
      claimed.step.buildId !== command.buildId
    )
      throw new Error('Local merge command does not match the claim');
    if (
      claimed.agent?.tools !== undefined &&
      [AGENT_TOOL_MERGE, AGENT_TOOL_PUSH].some((tool) => !claimed.agent?.tools?.includes(tool))
    )
      throw new Error('Local merge requires merge and push permission');
    const result = stopRequested()
      ? { outcome: 'held' as const, reason: 'stopped' }
      : await landLocalMerge(repo.cloneUrl, command, stopRequested);
    return {
      status: 'success',
      localMerge: { command, result },
      ...(result.outcome === 'merged' ? { commit: result.commit } : {}),
    };
  } catch (err) {
    return {
      status: 'failed',
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}
