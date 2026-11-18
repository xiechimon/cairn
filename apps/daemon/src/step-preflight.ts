import {
  AGENT_TOOL_MERGE,
  AGENT_TOOL_PUSH,
  type AgentBackend,
  type DeliveredImage,
  type ProviderConfig,
} from '@cairn/shared';
import { claudeCodeSubscriptionMissingMessage } from './claude-code-auth.js';
import { type AttachmentDownloader, resolveDeliveredPrompt } from './step-attachments.js';

export function devinSubscriptionMissingMessage(): string {
  return (
    '团队还没有可用的 Devin 订阅：在已登录机器上运行 cat ' +
    '~/.local/share/devin/credentials.toml，把输出整个贴到「我的订阅」，然后重跑这个任务。'
  );
}

export function agentStepRefusal(input: {
  stepKind: string;
  agentTools: readonly string[] | undefined;
  runtimeId: string | null;
  hasSubscriptionToken: boolean;
  hasDevinToken?: boolean;
}): string | null {
  const agentTools = input.agentTools;
  if (input.stepKind === 'merge' && agentTools !== undefined) {
    const missing = [AGENT_TOOL_MERGE, AGENT_TOOL_PUSH].filter((t) => !agentTools.includes(t));
    if (missing.length > 0) {
      return `Agent 未获「${missing.join('」「')}」授权（Agent 详情页权限 tab），合并步拒绝执行`;
    }
  }
  if (input.runtimeId === 'claude-code' && !input.hasSubscriptionToken) {
    return claudeCodeSubscriptionMissingMessage();
  }
  if (input.runtimeId === 'devin') {
    if (!['build', 'session', 'plan', 'merge'].includes(input.stepKind)) {
      return `Devin 运行时暂不支持「${input.stepKind}」步骤（支持 build/session/plan/merge），请改用其他运行时或拆分任务`;
    }
    if (input.hasDevinToken !== true) {
      return devinSubscriptionMissingMessage();
    }
  }
  return null;
}

export async function probeModelImageSupport(
  backend: AgentBackend,
  provider: ProviderConfig,
  modelId: string,
  log: (message: string) => void,
): Promise<boolean | null> {
  try {
    return (await backend.modelSupportsImages?.(provider, modelId)) ?? null;
  } catch (err) {
    log(
      `image support probe failed (assuming unknown): ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

export interface StepPromptDelivery {
  imageSupport: boolean | null;
  deliveryPrompt: string | null;
  promptImages: DeliveredImage[] | undefined;
  skippedNoVisionCount: number;
}

export async function prepareStepPromptDelivery(input: {
  backend: AgentBackend;
  provider: ProviderConfig;
  modelId: string;
  modelKey: string;
  isChief: boolean;
  prompt: string | null;
  stepId: string;
  client: AttachmentDownloader;
  materializeDir: string;
  rememberImageSupport: (support: boolean | null) => void;
  log: (message: string) => void;
}): Promise<StepPromptDelivery> {
  const { isChief, prompt, log } = input;
  const imageSupport = isChief
    ? null
    : await probeModelImageSupport(input.backend, input.provider, input.modelId, log);
  input.rememberImageSupport(imageSupport);
  if (isChief || prompt === null) {
    return {
      imageSupport,
      deliveryPrompt: prompt,
      promptImages: undefined,
      skippedNoVisionCount: 0,
    };
  }
  const resolved = await resolveDeliveredPrompt({
    text: prompt,
    stepId: input.stepId,
    client: input.client,
    materializeDir: input.materializeDir,
    log,
    imageSupport,
    ...(input.backend.describeImage === undefined
      ? {}
      : { describeImage: input.backend.describeImage.bind(input.backend, input.provider) }),
  });
  if (resolved.skippedNoVision > 0) {
    log(
      `image attachment not delivered inline: model ${input.modelKey} does not support images (${resolved.skippedNoVision} image(s) delivered as text or file instead)`,
    );
  }
  return {
    imageSupport,
    deliveryPrompt: resolved.text,
    promptImages: resolved.images,
    skippedNoVisionCount: resolved.skippedNoVision,
  };
}
