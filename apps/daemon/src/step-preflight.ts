import {
  AGENT_TOOL_MERGE,
  AGENT_TOOL_PUSH,
  type AgentBackend,
  type ProviderConfig,
} from '@cairn/shared';
import {
  type ClaudeCodeAuthProbe,
  claudeCodeAuthFailureMessage,
  probeClaudeCodeAuth,
} from './claude-code-auth.js';

export async function agentStepRefusal(input: {
  stepKind: string;
  agentTools: readonly string[] | undefined;
  runtimeId: string | null;
  hasSubscriptionToken: boolean;
  authProbe: (() => Promise<ClaudeCodeAuthProbe>) | undefined;
  machineName: () => string;
  log: (message: string) => void;
}): Promise<string | null> {
  const agentTools = input.agentTools;
  if (input.stepKind === 'merge' && agentTools !== undefined) {
    const missing = [AGENT_TOOL_MERGE, AGENT_TOOL_PUSH].filter((t) => !agentTools.includes(t));
    if (missing.length > 0) {
      return `Agent 未获「${missing.join('」「')}」授权（Agent 详情页权限 tab），合并步拒绝执行`;
    }
  }
  if (input.runtimeId === 'claude-code' && !input.hasSubscriptionToken) {
    const auth = await (input.authProbe ?? probeClaudeCodeAuth)();
    if (auth.state === 'not-logged-in') return claudeCodeAuthFailureMessage(input.machineName());
    if (auth.state === 'unknown') {
      input.log(`claude-code auth probe inconclusive: ${auth.reason} (continuing)`);
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
