import type { BoundGitCredentials } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { assembleStepEnv, prepareStepEnv, type StepEnvInput } from '../src/step-env.js';

const git: BoundGitCredentials = {
  username: 'x-access-token',
  password: 'step-password',
  url: 'https://github.com/acme/widgets.git',
};

function input(patch: Partial<StepEnvInput> = {}): StepEnvInput {
  return {
    inherited: undefined,
    temporary: {},
    git: null,
    appCredential: null,
    readonlyGit: false,
    claudeSubscriptionToken: undefined,
    ...patch,
  };
}

describe('assembleStepEnv', () => {
  test('is empty when the step has nothing to pass', () => {
    expect(assembleStepEnv(input()).env).toEqual({});
  });

  test('temporary values win over inherited ones', () => {
    const { env } = assembleStepEnv(
      input({ inherited: { TMPDIR: '/host', KEEP: '1' }, temporary: { TMPDIR: '/step' } }),
    );
    expect(env).toEqual({ TMPDIR: '/step', KEEP: '1' });
  });

  test('a token credential reaches git and gh, and is dropped on cleanup', () => {
    const step = assembleStepEnv(input({ inherited: { KEEP: '1' }, git }));
    expect(step.env.GH_TOKEN).toBe('step-password');
    expect(step.env.GITHUB_TOKEN).toBe('step-password');
    expect(step.env.CAIRN_GIT_CRED_PASSWORD).toBe('step-password');
    expect(Number(step.env.GIT_CONFIG_COUNT)).toBeGreaterThan(0);
    step.dropGitCredentials();
    expect(step.env).toEqual({ KEEP: '1' });
  });

  test('an App credential supplies its own env and never exposes a token variable', () => {
    const step = assembleStepEnv(
      input({
        inherited: { GH_TOKEN: 'host', GITHUB_TOKEN: 'host', CAIRN_GIT_CRED_PASSWORD: 'host' },
        git,
        appCredential: {
          env: () => ({ GH_CONFIG_DIR: '/step/gh', CAIRN_GIT_CRED_PASSWORD: 'app' }),
        },
      }),
    );
    expect(step.env).toEqual({ GH_CONFIG_DIR: '/step/gh' });
    step.dropGitCredentials();
    expect(step.env).toEqual({});
  });

  test('a read-only workspace overrides the git config with the push denial', () => {
    const { env } = assembleStepEnv(input({ git, readonlyGit: true }));
    expect(env.GIT_CONFIG_COUNT).toBe('1');
    expect(env.GIT_CONFIG_KEY_0).toBe('url.cairn-readonly-workspace-denied://.pushInsteadOf');
    expect(env.GIT_CONFIG_VALUE_0).toBe('');
  });

  test('an inherited subscription token is removed', () => {
    const { env } = assembleStepEnv(input({ inherited: { CLAUDE_CODE_OAUTH_TOKEN: 'host' } }));
    expect(env).toEqual({});
  });

  test('the step subscription token replaces it and scrubs subprocesses on the host', () => {
    const { env } = assembleStepEnv(
      input({ inherited: { CLAUDE_CODE_OAUTH_TOKEN: 'host' }, claudeSubscriptionToken: 'step' }),
    );
    expect(env).toEqual({
      CLAUDE_CODE_OAUTH_TOKEN: 'step',
      CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: '1',
    });
  });

  test('inside an Orb guest the subprocess scrub stays off', () => {
    const { env } = assembleStepEnv(
      input({ inherited: { CAIRN_ORB: '1' }, claudeSubscriptionToken: 'step' }),
    );
    expect(env).toEqual({ CAIRN_ORB: '1', CLAUDE_CODE_OAUTH_TOKEN: 'step' });
  });
});

describe('prepareStepEnv', () => {
  test('creates a step temp directory, passes git through and registers both cleanups', async () => {
    const cleanups: (() => void | Promise<void>)[] = [];
    const { temporary: _, ...rest } = input({ inherited: { KEEP: '1' }, git });
    const prepared = prepareStepEnv(rest, cleanups);
    if ('error' in prepared) throw new Error(prepared.error);
    expect(prepared.env.KEEP).toBe('1');
    expect(prepared.env.GH_TOKEN).toBe('step-password');
    expect(prepared.env.TMPDIR).toBeTruthy();
    expect(cleanups).toHaveLength(2);
    for (const cleanup of [...cleanups].reverse()) await cleanup();
    expect(prepared.env.GH_TOKEN).toBeUndefined();
  });
});
