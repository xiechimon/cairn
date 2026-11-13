import {
  type GitCredentialSource,
  gitCredentialRowContent,
  transcriptPromptRowId,
  type WorkspaceHookNoteData,
  workspaceHookRowContent,
} from '@cairn/shared';
import type { TranscriptBuffer } from './journal.js';

export interface StepTranscriptSeed {
  stepId: string;
  now: () => number;
  modelKey: string;
  skippedNoVisionCount: number;
  prompt: string | null;
  orbHookNotes: readonly WorkspaceHookNoteData[];
  orbStartedAt: number | undefined;
  workspaceHooks: readonly WorkspaceHookNoteData[];
  gitCredentialSource: GitCredentialSource | null;
  redact: (text: string) => string;
}

export function seedStepTranscript(
  transcript: Pick<TranscriptBuffer, 'upsert'>,
  seed: StepTranscriptSeed,
): void {
  const { stepId, now } = seed;
  if (seed.skippedNoVisionCount > 0) {
    transcript.upsert({
      id: `image-skip-${stepId}`,
      role: 'system',
      content: `图片未被模型读取：模型 ${seed.modelKey} 不支持图片输入，${seed.skippedNoVisionCount} 张图片未下载（步骤继续执行，请以文字描述或改用支持图片的模型）`,
      createdAt: now(),
    });
  }
  if (seed.prompt !== null) {
    transcript.upsert({
      id: transcriptPromptRowId(stepId),
      role: 'user',
      content: seed.prompt,
      createdAt: now(),
    });
  }
  for (const [index, hook] of [...seed.orbHookNotes, ...seed.workspaceHooks].entries()) {
    const isOrbNote = seed.orbHookNotes.includes(hook);
    const output =
      isOrbNote && hook.output.startsWith('orb: started in') && seed.orbStartedAt !== undefined
        ? `orb: started in ${Math.max(0, now() - seed.orbStartedAt)}ms`
        : hook.output;
    transcript.upsert({
      id: isOrbNote ? `orb-hook-${index}-${stepId}` : `hook-${hook.name}-${stepId}`,
      role: 'system',
      content: workspaceHookRowContent(hook, seed.redact(output)),
      createdAt: now(),
    });
  }
  if (seed.gitCredentialSource !== null) {
    transcript.upsert({
      id: `git-credential-${stepId}`,
      role: 'system',
      content: gitCredentialRowContent(seed.gitCredentialSource),
      createdAt: now(),
    });
  }
}
