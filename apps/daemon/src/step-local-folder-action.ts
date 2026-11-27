import type { ClaimedStep, LocalFolderActionCommand, MachineDoneBody } from '@cairn/shared';
import { type StepJournalEntry, TranscriptBuffer } from './journal.js';
import type { RunStepDeps } from './runner.js';
import { resumePendingUpload } from './step-final-upload.js';

export async function localFolderActionDoneBody(
  deps: Pick<RunStepDeps, 'workspace' | 'workspacesDir'>,
  claimed: ClaimedStep,
  command: LocalFolderActionCommand,
  stopRequested: () => boolean,
): Promise<MachineDoneBody> {
  const repo = claimed.project?.repo;
  try {
    if (
      claimed.step.kind !== 'merge' ||
      repo?.kind !== 'local' ||
      claimed.project?.id !== command.projectId ||
      claimed.step.buildId !== command.buildId
    ) {
      throw new Error('Local folder action command does not match the claim');
    }
    if (!deps.workspace?.runPlainFolderAction) {
      throw new Error('Plain folder workspace operations unavailable on this runner');
    }
    const result = stopRequested()
      ? { outcome: 'failed' as const, reason: 'stopped' }
      : await deps.workspace.runPlainFolderAction({
          workspacesRoot: deps.workspacesDir,
          projectId: command.projectId,
          buildId: command.buildId,
          stepId: claimed.step.id,
          realFolder: repo.cloneUrl,
          action: command.action,
        });
    return {
      status: 'success',
      localFolderAction: { command, result },
      generation: claimed.step.generation,
      ...(result.commit !== undefined ? { commit: result.commit } : {}),
    };
  } catch (err) {
    return {
      status: 'failed',
      errorMessage: err instanceof Error ? err.message : String(err),
      generation: claimed.step.generation,
    };
  }
}

export async function runLocalFolderActionStep(
  deps: Pick<
    RunStepDeps,
    'client' | 'journal' | 'logger' | 'paths' | 'workspace' | 'workspacesDir'
  >,
  claimed: ClaimedStep,
  command: LocalFolderActionCommand,
  claimedEntry: StepJournalEntry,
  opts: { stopRequested: () => boolean; now: () => number; running: number },
): Promise<void> {
  const stepId = claimed.step.id;
  const doneBody = await localFolderActionDoneBody(deps, claimed, command, opts.stopRequested);
  new TranscriptBuffer(deps.paths.outboxDir, stepId).upsert({
    id: `local-folder-action-${stepId}`,
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
