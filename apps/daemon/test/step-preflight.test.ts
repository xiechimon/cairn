import {
  AGENT_TOOL_MERGE,
  AGENT_TOOL_PUSH,
  type AgentBackend,
  type ProviderConfig,
} from '@cairn/shared';
import { describe, expect, it } from 'vitest';
import { agentStepRefusal, prepareStepPromptDelivery } from '../src/step-preflight.js';

const base = {
  stepKind: 'build',
  agentTools: undefined,
  runtimeId: null,
  hasSubscriptionToken: false,
  authProbe: undefined,
  machineName: () => 'box',
  log: () => {},
};

describe('agentStepRefusal', () => {
  it('refuses a merge step whose agent lacks the merge and push tools', async () => {
    const refusal = await agentStepRefusal({ ...base, stepKind: 'merge', agentTools: [] });
    expect(refusal).toContain(AGENT_TOOL_MERGE);
    expect(refusal).toContain(AGENT_TOOL_PUSH);
  });

  it('lets a merge step through when the agent holds both tools', async () => {
    const refusal = await agentStepRefusal({
      ...base,
      stepKind: 'merge',
      agentTools: [AGENT_TOOL_MERGE, AGENT_TOOL_PUSH],
    });
    expect(refusal).toBeNull();
  });

  it('refuses a claude-code step when the machine is not logged in', async () => {
    const refusal = await agentStepRefusal({
      ...base,
      runtimeId: 'claude-code',
      authProbe: async () => ({ state: 'not-logged-in', provider: 'claude' }),
    });
    expect(refusal).toContain('box');
  });

  it('skips the login probe when a subscription token was delivered', async () => {
    let probed = false;
    const refusal = await agentStepRefusal({
      ...base,
      runtimeId: 'claude-code',
      hasSubscriptionToken: true,
      authProbe: async () => {
        probed = true;
        return { state: 'not-logged-in', provider: 'claude' };
      },
    });
    expect(refusal).toBeNull();
    expect(probed).toBe(false);
  });

  it('continues and logs when the login probe is inconclusive', async () => {
    const lines: string[] = [];
    const refusal = await agentStepRefusal({
      ...base,
      runtimeId: 'claude-code',
      authProbe: async () => ({ state: 'unknown', reason: 'timeout' }),
      log: (line) => lines.push(line),
    });
    expect(refusal).toBeNull();
    expect(lines).toEqual(['claude-code auth probe inconclusive: timeout (continuing)']);
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
