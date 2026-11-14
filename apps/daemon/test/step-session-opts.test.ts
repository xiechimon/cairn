import type { ProviderConfig, RemoteToolDef } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import type { MachineApi } from '../src/machine-client.js';
import { composeStepSessionOpts, type StepSessionOptsInput } from '../src/step-session-opts.js';

const provider = {
  providerId: 'p',
  api: 'openai',
  baseUrl: 'http://x',
} as unknown as ProviderConfig;

function opts(overrides: Partial<StepSessionOptsInput> = {}) {
  return composeStepSessionOpts({
    provider,
    modelId: 'm',
    thinkingLevel: null,
    systemPrompt: null,
    cwd: '/w',
    prompt: null,
    promptImages: undefined,
    localTools: [],
    remoteTools: undefined,
    remoteExecutor: {
      client: { relayTool: async () => 'relayed' } as unknown as MachineApi,
      stepId: 's1',
      askChannel: { available: false, ask: async () => '' },
      attachFiles: true,
      verifyEvidence: null,
    },
    mcpServers: null,
    skillsAllowlist: null,
    injectedSkills: undefined,
    onSkillsResolved: () => {},
    teamSkillsDir: null,
    isChief: false,
    isReview: false,
    remoteToolsOnly: false,
    telemetry: undefined,
    env: {},
    ...overrides,
  });
}

describe('composeStepSessionOpts', () => {
  test('a bare build step carries only the required fields', () => {
    const { onSkillsResolved, ...rest } = opts();
    expect(typeof onSkillsResolved).toBe('function');
    expect(rest).toEqual({ provider, modelId: 'm', cwd: '/w' });
  });

  test('a review step is read-only and locked down', () => {
    expect(opts({ isReview: true })).toMatchObject({ readOnly: true, lockedDown: true });
  });

  test('a chief step is locked down and ignores the agent skill lists', () => {
    const result = opts({ isChief: true, skillsAllowlist: ['a'], injectedSkills: ['b'] });
    expect(result.lockedDown).toBe(true);
    expect(result.skillsAllowlist).toBeUndefined();
    expect(result.injectedSkills).toBeUndefined();
  });

  test('a worker step keeps its skill lists, prompt and environment', () => {
    const result = opts({
      skillsAllowlist: ['a'],
      injectedSkills: ['b'],
      prompt: 'do it',
      thinkingLevel: 'high',
      env: { K: 'v' },
      teamSkillsDir: '/skills',
    });
    expect(result).toMatchObject({
      skillsAllowlist: ['a'],
      injectedSkills: ['b'],
      prompt: 'do it',
      thinkingLevel: 'high',
      env: { K: 'v' },
      teamSkillsDir: '/skills',
    });
  });

  test('remote tools come with an executor that relays through the client', async () => {
    const remoteTools = [{ name: 'lookup' }] as unknown as RemoteToolDef[];
    const result = opts({ remoteTools });
    expect(result.remoteTools).toBe(remoteTools);
    expect(await result.executeRemoteTool?.('lookup', {})).toBe('relayed');
  });

  test('an empty remote tool list adds no executor', () => {
    expect(opts({ remoteTools: [] }).executeRemoteTool).toBeUndefined();
  });
});
