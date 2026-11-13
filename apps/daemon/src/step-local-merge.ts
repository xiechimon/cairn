import type { ClaimedStep, LocalMergeCommand, MachineDoneBody } from '@cairn/shared';
import { AGENT_TOOL_MERGE, AGENT_TOOL_PUSH } from '@cairn/shared';
import { type StepJournalEntry, TranscriptBuffer } from './journal.js';
import { landLocalMerge } from './local-merge.js';
import type { RunStepDeps } from './runner.js';
import { resumePendingUpload } from './step-final-upload.js';

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

export async function runLocalMergeStep(
  deps: Pick<RunStepDeps, 'client' | 'journal' | 'logger' | 'paths' | 'sessionHandles'>,
  claimed: ClaimedStep,
  command: LocalMergeCommand,
  claimedEntry: StepJournalEntry,
  opts: { stopRequested: () => boolean; now: () => number; running: number },
): Promise<void> {
  const stepId = claimed.step.id;
  const doneBody = await localMergeDoneBody(claimed, command, opts.stopRequested);
  new TranscriptBuffer(deps.paths.outboxDir, stepId).upsert({
    id: `local-merge-${stepId}`,
    role: 'system',
    content: JSON.stringify(doneBody),
    createdAt: opts.now(),
  });
  deps.journal.update(stepId, { state: 'awaiting-upload', doneBody });
  await resumePendingUpload(
    deps,
    deps.journal.get(stepId) ?? { ...claimedEntry, state: 'awaiting-upload', doneBody },
    { running: opts.running },
  );
}
