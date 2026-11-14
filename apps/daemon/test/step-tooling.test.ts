import { type ClaimedStep, LOCAL_TOOL_CREATE_TAG } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { EMPTY_SECRET_VAULT } from '../src/credentials.js';
import { prepareStepTooling, type StepToolingInput } from '../src/step-tooling.js';
import { testTempDir } from './test-temp-dir.js';

function claimedStep(localTools?: string[]): ClaimedStep {
  return {
    step: { id: 's1', buildId: 'conv-1', kind: 'build', machineId: 'm1', createdAt: 1 },
    conversationId: 'conv-1',
    session: { action: 'new', sessionId: null },
    todo: { id: 't1', seqNum: 3, title: 'probe', spec: 'spec' },
    project: { id: 'p1', name: 'demo', repo: null },
    agent: {
      id: 'a1',
      displayName: 'stub-builder',
      description: null,
      provider: null,
      modelId: 'stub-model',
      thinkingLevel: null,
    },
    ...(localTools !== undefined ? { localTools } : {}),
  };
}

function input(overrides: Partial<StepToolingInput> = {}) {
  const root = testTempDir('step-tooling');
  const claimed = overrides.claimed ?? claimedStep();
  const lines: string[] = [];
  const value: StepToolingInput = {
    client: {
      skillsManifest: async () => ({ selection: 'whitelist' as const, skills: [] }),
      skillFile: async () => Buffer.from(''),
    },
    claimed,
    agent: claimed.agent!,
    stepId: 's1',
    teamSkillsCacheDir: root,
    skillsDir: undefined,
    home: root,
    isPi: false,
    isChief: false,
    isReview: false,
    metered: true,
    creds: { provider: null, secrets: EMPTY_SECRET_VAULT, git: null },
    appCredential: null,
    refreshGit: async () => {
      throw new Error('no refresh');
    },
    commitIdentity: null,
    repo: null,
    ws: null,
    cwd: root,
    redact: (message) => message,
    logger: { step: (line) => lines.push(line), skills: (line) => lines.push(line) },
    ...overrides,
  };
  return { value, lines };
}

describe('prepareStepTooling', () => {
  test('a failed team skills fetch fails the step and is logged', async () => {
    const h = input({
      client: {
        skillsManifest: async () => {
          throw new Error('manifest 500');
        },
        skillFile: async () => Buffer.from(''),
      },
    });
    expect(await prepareStepTooling(h.value)).toEqual({
      error: 'team skills distribution failed: manifest 500',
    });
    expect(h.lines).toEqual(['team-skills-failed: manifest 500']);
  });

  test('commits use the local agent identity without an app identity', async () => {
    const tooling = await prepareStepTooling(input().value);
    if ('error' in tooling) throw new Error(tooling.error);
    expect(tooling.stepIdentity.name).toBe('stub-builder');
    expect(tooling.teamSkillsDir).toBeNull();
  });

  test('an app identity wins over the local identity', async () => {
    const identity = { name: 'cairn-app[bot]', email: 'bot@users.noreply.github.com' };
    const tooling = await prepareStepTooling(input({ commitIdentity: identity }).value);
    if ('error' in tooling) throw new Error(tooling.error);
    expect(tooling.stepIdentity).toEqual(identity);
  });

  test('the create tag tool is offered only when the step lists it', async () => {
    const without = await prepareStepTooling(input().value);
    const withTag = await prepareStepTooling(
      input({ claimed: claimedStep([LOCAL_TOOL_CREATE_TAG]) }).value,
    );
    if ('error' in without || 'error' in withTag) throw new Error('tooling failed');
    const names = (t: typeof without) => t.localTools.tools.map((tool) => tool.name);
    expect(names(without)).not.toContain(LOCAL_TOOL_CREATE_TAG);
    expect(names(withTag)).toContain(LOCAL_TOOL_CREATE_TAG);
  });
});
