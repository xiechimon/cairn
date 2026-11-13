import { AGENT_TOOL_MERGE, AGENT_TOOL_PUSH } from '@cairn/shared';
import { describe, expect, it } from 'vitest';
import { agentStepRefusal } from '../src/step-preflight.js';

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
