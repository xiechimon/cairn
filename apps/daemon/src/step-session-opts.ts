import type { RemoteToolDef, SessionOpts, SkillInjectionFacts } from '@cairn/shared';
import { stepRemoteToolExecutor } from './step-remote-tools.js';

type RemoteExecutorInput = Parameters<typeof stepRemoteToolExecutor>[0];

export interface StepSessionOptsInput {
  provider: SessionOpts['provider'];
  modelId: string;
  thinkingLevel: string | null | undefined;
  systemPrompt: string | null | undefined;
  cwd: string;
  prompt: string | null;
  promptImages: SessionOpts['promptImages'];
  localTools: NonNullable<SessionOpts['localTools']>;
  remoteTools: RemoteToolDef[] | undefined;
  remoteExecutor: Omit<RemoteExecutorInput, 'remoteTools' | 'cwd'>;
  mcpServers: SessionOpts['mcpServers'] | null;
  skillsAllowlist: string[] | null | undefined;
  injectedSkills: string[] | undefined;
  onSkillsResolved: (names: SkillInjectionFacts) => void;
  teamSkillsDir: string | null;
  isChief: boolean;
  isReview: boolean;
  remoteToolsOnly: boolean;
  telemetry: SessionOpts['telemetry'];
  env: Record<string, string>;
}

export function composeStepSessionOpts(input: StepSessionOptsInput): SessionOpts {
  const { isChief, isReview, remoteTools, cwd } = input;
  return {
    provider: input.provider,
    modelId: input.modelId,
    ...(input.thinkingLevel ? { thinkingLevel: input.thinkingLevel } : {}),
    ...(input.systemPrompt ? { systemPrompt: input.systemPrompt } : {}),
    cwd,
    ...(input.prompt !== null ? { prompt: input.prompt } : {}),
    ...(input.promptImages !== undefined ? { promptImages: input.promptImages } : {}),
    ...(input.localTools.length > 0 ? { localTools: input.localTools } : {}),
    ...(remoteTools && remoteTools.length > 0
      ? {
          remoteTools,
          executeRemoteTool: stepRemoteToolExecutor({ ...input.remoteExecutor, cwd, remoteTools }),
        }
      : {}),
    ...(input.mcpServers !== null ? { mcpServers: input.mcpServers } : {}),
    ...(isChief || input.skillsAllowlist == null ? {} : { skillsAllowlist: input.skillsAllowlist }),
    ...(isChief || input.injectedSkills === undefined
      ? {}
      : { injectedSkills: input.injectedSkills }),
    onSkillsResolved: input.onSkillsResolved,
    ...(input.teamSkillsDir !== null ? { teamSkillsDir: input.teamSkillsDir } : {}),
    ...(isReview ? { readOnly: true } : {}),
    ...(isChief || isReview ? { lockedDown: true } : {}),
    ...(input.remoteToolsOnly ? { remoteToolsOnly: true } : {}),
    ...(input.telemetry !== undefined ? { telemetry: input.telemetry } : {}),
    ...(Object.keys(input.env).length > 0 ? { env: input.env } : {}),
  };
}
