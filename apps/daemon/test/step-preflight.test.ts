import {
  AGENT_TOOL_MERGE,
  AGENT_TOOL_PUSH,
  type AgentBackend,
  CLAUDE_CODE_AUTH_FAILURE_MARKER,
  type ProviderConfig,
} from '@cairn/shared';
import { describe, expect, it } from 'vitest';
import { agentStepRefusal, prepareStepPromptDelivery } from '../src/step-preflight.js';

const base = {
  stepKind: 'build',
  agentTools: undefined,
  runtimeId: null,
  hasSubscriptionToken: false,
};

describe('agentStepRefusal', () => {
  it('refuses a merge step whose agent lacks the merge and push tools', async () => {
    const refusal = agentStepRefusal({ ...base, stepKind: 'merge', agentTools: [] });
    expect(refusal).toContain(AGENT_TOOL_MERGE);
    expect(refusal).toContain(AGENT_TOOL_PUSH);
  });

  it('lets a merge step through when the agent holds both tools', async () => {
    const refusal = agentStepRefusal({
      ...base,
      stepKind: 'merge',
      agentTools: [AGENT_TOOL_MERGE, AGENT_TOOL_PUSH],
    });
    expect(refusal).toBeNull();
  });

  it('refuses a claude-code step that has no subscription token', () => {
    const refusal = agentStepRefusal({ ...base, runtimeId: 'claude-code' });
    expect(refusal).toContain(CLAUDE_CODE_AUTH_FAILURE_MARKER);
    expect(refusal).toContain('claude setup-token');
  });

  it('lets a claude-code step with a subscription token through', () => {
    expect(
      agentStepRefusal({ ...base, runtimeId: 'claude-code', hasSubscriptionToken: true }),
    ).toBeNull();
  });

  it('lets a pi step through without a subscription token', () => {
    expect(agentStepRefusal({ ...base, runtimeId: null })).toBeNull();
  });
});

describe('prepareStepPromptDelivery', () => {
  const delivery = (patch: { isChief?: boolean; prompt?: string | null; supports?: boolean }) => {
    const remembered: (boolean | null)[] = [];
    const backend = {
      modelSupportsImages: async () => patch.supports ?? true,
    } as unknown as AgentBackend;
    return {
      remembered,
      run: prepareStepPromptDelivery({
        backend,
        provider: {} as ProviderConfig,
        modelId: 'm',
        modelKey: 'p/m',
        isChief: patch.isChief ?? false,
        prompt: patch.prompt === undefined ? 'do it' : patch.prompt,
        stepId: 's1',
        client: {
          attachment: async () => {
            throw new Error('unused');
          },
        } as never,
        materializeDir: '/nonexistent',
        rememberImageSupport: (support) => remembered.push(support),
        log: () => {},
      }),
    };
  };

  it('skips the probe for a chief step and keeps its prompt as is', async () => {
    const { run, remembered } = delivery({ isChief: true });
    expect(await run).toEqual({
      imageSupport: null,
      deliveryPrompt: 'do it',
      promptImages: undefined,
      skippedNoVisionCount: 0,
    });
    expect(remembered).toEqual([null]);
  });

  it('records the probed support and passes a plain prompt through', async () => {
    const { run, remembered } = delivery({ supports: false });
    const result = await run;
    expect(result.imageSupport).toBe(false);
    expect(result.deliveryPrompt).toBe('do it');
    expect(result.promptImages).toBeUndefined();
    expect(remembered).toEqual([false]);
  });

  it('keeps a null prompt null', async () => {
    const { run } = delivery({ prompt: null });
    expect((await run).deliveryPrompt).toBeNull();
  });
});
