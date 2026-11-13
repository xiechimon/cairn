import { type BoundGitCredentials, LOCAL_TOOL_CREATE_TAG } from '@cairn/shared';
import { describe, expect, it } from 'vitest';
import { prepareCreateTagTool, stepGitRunner } from '../src/step-git-tools.js';

const identity = { name: 'cairn-agent', email: 'agent@example.invalid' };

describe('stepGitRunner', () => {
  it('runs on machine credentials when the step has none', async () => {
    const seen: Array<BoundGitCredentials | null> = [];
    const run = stepGitRunner({
      credential: null,
      appCredential: null,
      refresh: async () => {
        throw new Error('no refresh');
      },
      allowMachineFallback: true,
      log: () => {},
    });
    expect(await run(async (credential) => void seen.push(credential))).toBe('machine');
    expect(seen).toEqual([null]);
  });

  it('refreshes an app credential that is due before running', async () => {
    let refreshes = 0;
    const run = stepGitRunner({
      credential: null,
      appCredential: { needsRefresh: () => true },
      refresh: async () => {
        refreshes += 1;
        return { kind: 'app', username: 'x', password: 'p', url: 'https://example.invalid/r' };
      },
      allowMachineFallback: false,
      log: () => {},
    });
    await run(async () => {});
    expect(refreshes).toBe(1);
  });
});

describe('prepareCreateTagTool', () => {
  const runGit = async () => {
    throw new Error('push failed with secret-token');
  };

  it('offers no tool unless the step lists it', () => {
    expect(
      prepareCreateTagTool({
        localTools: [],
        repoDir: '/tmp/r',
        credential: null,
        identity,
        runGit,
        redact: (m) => m,
      }),
    ).toBeNull();
  });

  it('builds the tag tool when the step lists it', () => {
    const tool = prepareCreateTagTool({
      localTools: [LOCAL_TOOL_CREATE_TAG],
      repoDir: '/tmp/r',
      credential: null,
      identity,
      runGit,
      redact: (m) => m.replace('secret-token', '***'),
    });
    expect(tool?.name).toBe(LOCAL_TOOL_CREATE_TAG);
  });
});
