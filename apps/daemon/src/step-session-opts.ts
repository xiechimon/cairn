import {
  agentTurnPolicyFor,
  type RemoteToolDef,
  type SessionOpts,
  type SkillInjectionFacts,
  type StepKind,
  WEB_RESEARCH_GUIDANCE,
} from '@cairn/shared';
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
  stepKind?: StepKind;
  conversationId?: string;
  readOnly?: boolean;
  remoteToolsOnly: boolean;
  telemetry: SessionOpts['telemetry'];
  env: Record<string, string>;
  secrets?: SessionOpts['secrets'];
}

export function composeStepSessionOpts(input: StepSessionOptsInput): SessionOpts {
  const { isChief, isReview, remoteTools, cwd } = input;
  const policy = agentTurnPolicyFor({
    stepKind: input.stepKind ?? (isChief ? 'chief' : isReview ? 'review' : 'build'),
    conversationId: input.conversationId ?? (isChief ? 'chief-session' : 'build-session'),
    isReview,
    ...(input.readOnly === true ? { readOnly: true } : {}),
    remoteToolsOnly: input.remoteToolsOnly,
  });
  return {
    provider: input.provider,
    ...(policy.compactAt !== undefined ? { compactAt: policy.compactAt } : {}),
    modelId: input.modelId,
    ...(input.thinkingLevel ? { thinkingLevel: input.thinkingLevel } : {}),
    systemPrompt: [input.systemPrompt, WEB_RESEARCH_GUIDANCE].filter(Boolean).join('\n\n'),
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
    ...(!policy.allowSkillLists || input.skillsAllowlist == null
      ? {}
      : { skillsAllowlist: input.skillsAllowlist }),
    ...(!policy.allowSkillLists || input.injectedSkills === undefined
      ? {}
      : { injectedSkills: input.injectedSkills }),
    onSkillsResolved: input.onSkillsResolved,
    ...(input.teamSkillsDir !== null ? { teamSkillsDir: input.teamSkillsDir } : {}),
    ...(policy.readOnly ? { readOnly: true } : {}),
    ...(policy.lockedDown ? { lockedDown: true } : {}),
    ...(policy.remoteToolsOnly ? { remoteToolsOnly: true } : {}),
    ...(input.telemetry !== undefined ? { telemetry: input.telemetry } : {}),
    ...(input.secrets !== undefined ? { secrets: input.secrets } : {}),
    ...(Object.keys(input.env).length > 0 ? { env: input.env } : {}),
  };
}
