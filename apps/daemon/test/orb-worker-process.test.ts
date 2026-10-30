import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { expect, test } from 'vitest';
import { startStubLlm } from '../../../integration/test/stub-llm.js';
import { NspawnOrbProvider, runOrbCommand } from '../src/orb/provider.js';
import { boot, CLAIMED, FakeMachineApi, waitFor } from './machine-loop-harness.js';

test('compiled worker runs an agent command with CAIRN_ORB through the real stdio bridge', async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'cairn-orb-worker-'));
  symlinkSync(resolve('apps/daemon/node_modules'), join(scratch, 'node_modules'), 'dir');
  copyFileSync(resolve('apps/daemon/package.json'), join(scratch, 'package.json'));
  const entry = join(scratch, 'dist', 'cli.mjs');
  await build({
    entryPoints: [resolve('apps/daemon/src/cli.ts')],
    outfile: entry,
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'esm',
    packages: 'external',
  });
  const repo = join(scratch, 'repo');
  mkdirSync(join(repo, '.agents'), { recursive: true });
  for (const name of ['setup', 'resume']) {
    const hook = join(repo, '.agents', name);
    writeFileSync(hook, `#!/bin/sh\nprintf 'hook-${name}-orb=%s\\n' "$CAIRN_ORB"\n`);
    chmodSync(hook, 0o755);
  }
  execFileSync('git', ['init', '-b', 'main', repo]);
  execFileSync('git', ['-C', repo, 'add', '.agents/setup', '.agents/resume']);
  execFileSync('git', [
    '-C',
    repo,
    '-c',
    'user.name=orb-test',
    '-c',
    'user.email=orb@test.local',
    'commit',
    '-m',
    'Seed hooks',
  ]);
  const stub = await startStubLlm([
    {
      toolCall: { name: 'bash', arguments: { command: 'printf "orb-command=%s\\n" "$CAIRN_ORB"' } },
    },
    { content: 'Thread completed.' },
    { content: 'Thread resumed.' },
  ]);
  const api = new FakeMachineApi();
  const originalToken = api.token.bind(api);
  api.token = async (stepId) => {
    const token = await originalToken(stepId);
    return { ...token, provider: { ...token.provider, baseUrl: stub.url } };
  };
  const claimed = {
    ...CLAIMED,
    project: { id: 'P', name: 'Project', repo: { kind: 'local' as const, cloneUrl: repo } },
    agent: { ...CLAIMED.agent!, skillsAllowlist: [], injectedSkills: [] },
  };
  api.claimQueue.push(claimed);
  const provider = new NspawnOrbProvider({
    runner: async (argv, options) => {
      if (argv[0] !== 'systemd-run' || !argv.includes('--uid=agent'))
        return { code: 0, stdout: '', stderr: '' };
      const home = join(scratch, 'user');
      mkdirSync(home, { recursive: true });
      return runOrbCommand(
        [
          process.execPath,
          '--import',
          resolve('apps/daemon/node_modules/tsx/dist/loader.mjs'),
          entry,
          'orb-step',
        ],
        {
          ...options,
          env: {
            ...process.env,
            HOME: home,
            CAIRN_ORB: '1',
            HTTP_PROXY: '',
            HTTPS_PROXY: '',
            ALL_PROXY: '',
          },
        },
      );
    },
  });
  const { handle, lines } = await boot({
    api,
    orbProvider: provider,
    capEnv: { CAIRN_EXECUTOR: 'orb' },
  });
  try {
    await waitFor(
      () => api.doneBodies.length === 1 || lines.some((line) => line.includes('runStep crashed')),
      30_000,
    ).catch((error: unknown) => {
      throw new Error(lines.join('\n'), { cause: error });
    });
    expect(api.doneBodies[0]?.body.status, lines.join('\n')).toBe('success');
    await waitFor(() => api.parked !== null);
    api.parked?.({ ...claimed, step: { ...claimed.step, id: 's2' } });
    await waitFor(() => api.doneBodies.length === 2, 30_000);
    expect(api.doneBodies[1]?.body.status, lines.join('\n')).toBe('success');
    expect(stub.requests).toHaveLength(3);
    expect(JSON.stringify(api.toolCalls)).toContain('orb-command=1');
    expect(JSON.stringify(api.uploads)).toContain('hook-setup-orb=1');
    expect(JSON.stringify(api.uploads)).toContain('hook-resume-orb=1');
    expect(JSON.stringify(api.uploads)).toContain('orb: creating');
    expect(JSON.stringify(api.uploads)).toContain('orb: started in');
  } finally {
    await handle.stop();
    await handle.done;
    await stub.close();
    rmSync(scratch, { recursive: true, force: true });
  }
}, 60_000);
