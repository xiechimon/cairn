import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BoundGitCredentials, ClaimedStep, WorktreeOps } from '@cairn/shared';
import { afterAll, afterEach, describe, expect, test, vi } from 'vitest';
import { gitPrim, runGit, withGitCredentialFallback } from '../src/git.js';
import { probeGithubPr } from '../src/github-probe.js';
import type { DaemonLogger } from '../src/log.js';
import { prepareStepWorkspace, type StepRepo } from '../src/step-workspace.js';
import { WorkspaceManager } from '../src/workspace.js';
import { testTempDir } from './test-temp-dir.js';

const disposables: string[] = [];
afterAll(() => {
  for (const dir of disposables) rmSync(dir, { recursive: true, force: true });
});
afterEach(() => {
  vi.restoreAllMocks();
});

function fakeLogger(): DaemonLogger {
  const noop = () => undefined;
  return {
    raw: noop,
    prefixed: noop,
    supervisor: noop,
    machine: noop,
    step: noop,
    workspace: noop,
    recover: noop,
    wake: noop,
    mcp: noop,
    skills: noop,
    gate: noop,
    trust: noop,
  };
}

function markerGh(markerFile: string): string {
  const dir = testTempDir('cairn-gh-marker-');
  disposables.push(dir);
  const path = join(dir, 'gh');
  writeFileSync(
    path,
    `#!/bin/sh\necho called >> '${markerFile}'\necho '[{"number":999,"url":"https://github.com/o/r/pull/999","state":"open"}]'\n`,
    { mode: 0o755 },
  );
  return path;
}

describe('daemon GitHub connection token precedence and refresh on every machine', () => {
  test('probeGithubPr prefers Cairn GitHub connection token over host gh and refreshes once on 401', async () => {
    const dir = testTempDir('cairn-gh-probe-conn-');
    disposables.push(dir);
    const marker = join(dir, 'gh-called');
    const gh = markerGh(marker);

    let attempts = 0;
    let refreshes = 0;
    const auths: (string | undefined)[] = [];
    const probe = await probeGithubPr({
      owner: 'xiechimon',
      repo: 'offer',
      branch: 'cairn/conv-1',
      token: 'ghu_stale_probe',
      tokenKind: 'unattributed',
      ghPath: gh,
      refreshToken: async () => {
        refreshes += 1;
        return 'ghu_fresh_probe';
      },
      fetchImpl: async (_url, init) => {
        attempts += 1;
        auths.push(init?.headers?.authorization);
        if (attempts === 1) {
          return { ok: false, status: 401, json: async () => ({ message: 'Bad credentials' }) };
        }
        return {
          ok: true,
          status: 200,
          json: async () => [
            { number: 42, html_url: 'https://github.com/xiechimon/offer/pull/42', state: 'open' },
          ],
        };
      },
    });

    expect(probe).toEqual({ number: 42, url: 'https://github.com/xiechimon/offer/pull/42' });
    expect(refreshes).toBe(1);
    expect(auths).toEqual(['Bearer ghu_stale_probe', 'Bearer ghu_fresh_probe']);
  });

  test('withGitCredentialFallback refreshes an unattributed Cairn GitHub token before falling back to machine credentials', async () => {
    const stale: BoundGitCredentials = {
      username: 'x-access-token',
      password: 'ghu_stale_git',
      url: 'https://github.com/xiechimon/offer.git',
      kind: 'unattributed',
    };
    const seen: (string | null)[] = [];
    const refresh = vi.fn(async () => {
      Object.assign(stale, { password: 'ghu_rotated_git' });
      return stale;
    });
    const source = await withGitCredentialFallback(
      async (cred) => {
        seen.push(cred?.password ?? null);
        if (cred?.password === 'ghu_stale_git') {
          throw new Error(
            "fatal: Authentication failed for 'https://github.com/xiechimon/offer.git/'",
          );
        }
      },
      stale,
      { what: 'clone', allowMachineFallback: true, refresh },
    );
    expect(source).toBe('integration');
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(seen).toEqual(['ghu_stale_git', 'ghu_rotated_git']);
  });

  test('withGitCredentialFallback blocks mid-step unattributed to app upgrade and machine fallback', async () => {
    const stale: BoundGitCredentials = {
      username: 'x-access-token',
      password: 'ghu_stale_git',
      url: 'https://github.com/xiechimon/offer.git',
      kind: 'unattributed',
    };
    const seen: (string | null)[] = [];
    await expect(
      withGitCredentialFallback(
        async (cred) => {
          seen.push(cred?.password ?? null);
          throw new Error(
            "fatal: Authentication failed for 'https://github.com/xiechimon/offer.git/'",
          );
        },
        stale,
        {
          what: 'clone',
          allowMachineFallback: true,
          refresh: async () => ({
            ...stale,
            kind: 'app',
            password: 'ghs_upgraded_app_token',
          }),
        },
      ),
    ).rejects.toThrow(/Authentication failed/);
    expect(seen).toEqual(['ghu_stale_git']);
  });

  test('WorkspaceManager.prepare refreshes an expired Cairn GitHub connection token during clone without host git credentials', async () => {
    const root = testTempDir('cairn-ws-refresh-root-');
    const originDir = join(testTempDir('cairn-ws-refresh-origin-'), 'repo.git');
    const seedDir = join(testTempDir('cairn-ws-refresh-seed-'), 'seed');
    disposables.push(root, originDir, seedDir);

    await runGit(['init', '--bare', originDir]);
    await runGit(['symbolic-ref', 'HEAD', 'refs/heads/main'], { cwd: originDir });
    await runGit(['clone', originDir, seedDir]);
    writeFileSync(join(seedDir, 'README.md'), '# Offer\n');
    await runGit(['checkout', '-B', 'main'], { cwd: seedDir });
    await runGit(['add', 'README.md'], { cwd: seedDir });
    await runGit(
      ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'seed'],
      { cwd: seedDir },
    );
    await runGit(['push', 'origin', 'main'], { cwd: seedDir });

    const cred: BoundGitCredentials = {
      username: 'x-access-token',
      password: 'ghu_stale_clone',
      url: originDir,
      kind: 'unattributed',
    };
    const seenPasswords: (string | null)[] = [];
    const realClone = gitPrim.clone;
    vi.spyOn(gitPrim, 'clone').mockImplementation(((
      url: string,
      dir: string,
      c: BoundGitCredentials | null,
    ) => {
      seenPasswords.push(c?.password ?? null);
      if (c === null) {
        return Promise.reject(new Error("fatal: could not read Username for 'https://github.com'"));
      }
      if (c.password === 'ghu_stale_clone') {
        return Promise.reject(new Error("fatal: Authentication failed for 'https://github.com/'"));
      }
      return realClone(url, dir, c);
    }) as typeof gitPrim.clone);

    const ws = new WorkspaceManager({ logger: fakeLogger() });
    const prepared = await ws.prepare({
      projectId: 'proj-offer',
      conversationId: '01a0b86f-04f9-72a8-bba4-75c5cfd6598f',
      cloneUrl: originDir,
      repoKind: 'github',
      workspacesRoot: root,
      credentials: cred,
      machineCredentialFallback: true,
      refresh: async () => {
        Object.assign(cred, { password: 'ghu_fresh_clone' });
        return cred;
      },
    });
    expect(prepared.credentialSource).toBe('integration');
    expect(seenPasswords).toEqual(['ghu_stale_clone', 'ghu_fresh_clone']);
  }, 30_000);

  test('prepareStepWorkspace names the Cairn GitHub App install when a ghu_ token gets Repository not found, without leaking the token', async () => {
    const claimed = {
      conversationId: 'conv-offer',
      project: { id: 'proj-offer' },
    } as unknown as ClaimedStep;
    const repo = {
      kind: 'github',
      cloneUrl: 'https://github.com/xiechimon/offer.git',
      baseBranch: 'main',
    } as StepRepo;
    const token = 'ghu_secret_ungranted_clone_token';
    const workspace = {
      prepare: async () => {
        throw new Error(
          "remote: Repository not found.\nfatal: repository 'https://github.com/xiechimon/offer.git/' not found",
        );
      },
      headCommit: async () => 'a'.repeat(40),
    } as unknown as WorktreeOps;

    const denied = await prepareStepWorkspace({
      workspace,
      claimed,
      repo,
      workspacesRoot: '/tmp/ws',
      credentials: {
        username: 'x-access-token',
        password: token,
        url: repo.cloneUrl,
        kind: 'unattributed',
      },
      refresh: undefined,
      machineName: 'Studio-Mac-mini',
    });
    expect('error' in denied && denied.error).toContain('Only repositories granted to Cairn');
    expect('error' in denied && denied.error).toContain('xiechimon/offer');
    expect('error' in denied && denied.error).not.toContain(token);

    const noConn = await prepareStepWorkspace({
      workspace: {
        ...workspace,
        prepare: async () => {
          throw new Error(
            "fatal: could not read Username for 'https://github.com': No such device or address",
          );
        },
      } as unknown as WorktreeOps,
      claimed,
      repo,
      workspacesRoot: '/tmp/ws',
      credentials: null,
      refresh: undefined,
      machineName: 'Studio-Mac-mini',
    });
    expect('error' in noConn && noConn.error).toContain('Settings');
    expect('error' in noConn && noConn.error).toContain('GitHub');
  });
});
