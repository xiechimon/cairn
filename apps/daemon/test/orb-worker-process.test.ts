import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { build } from 'esbuild';
import { expect, test } from 'vitest';
import { startStubLlm } from '../../../integration/test/stub-llm.js';
import { NspawnOrbProvider, runOrbCommand } from '../src/orb/provider.js';
import { boot, CLAIMED, defer, FakeMachineApi, waitFor } from './machine-loop-harness.js';
import { createOrbCheckout } from './orb-dist-fixture.js';
import { FakeOrbProvider } from './orb-fake.js';

test('compiled worker runs an agent command with CAIRN_ORB through the real Unix socket relay', async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'cairn-orb-worker-'));
  symlinkSync(resolve('apps/daemon/node_modules'), join(scratch, 'node_modules'), 'dir');
  copyFileSync(resolve('apps/daemon/package.json'), join(scratch, 'package.json'));
  const entry = join(scratch, 'dist', 'cli.mjs');
  await build({
    stdin: {
      contents: `import { runOrbWorker } from ${JSON.stringify(resolve('apps/daemon/src/orb/worker.ts'))}; await runOrbWorker({ socketPath: process.argv[2], home: ${JSON.stringify(join(scratch, 'state'))}, workspacesRoot: ${JSON.stringify(join(scratch, 'work'))}, seedRoot: process.argv[3], outboxRoot: process.argv[4] });`,
      resolveDir: resolve('.'),
    },
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
  const provider = new FakeOrbProvider({
    runner: async (argv, options) => {
      if (argv[0] !== 'orb-worker') return { code: 0, stdout: '', stderr: '' };
      const socketPath = options?.socketPath;
      if (!socketPath) throw new Error('Missing relay socket');
      const seed = join(scratch, 'seed', 'P');
      mkdirSync(seed, { recursive: true });
      const seedSource = join(options!.seedRoot, 'P', 'repo');
      if (!seedSource) throw new Error('Missing seed snapshot');
      rmSync(join(seed, 'repo'), { force: true });
      symlinkSync(seedSource, join(seed, 'repo'), 'dir');
      const home = join(scratch, 'user');
      mkdirSync(home, { recursive: true });
      const workerEntry = join(
        scratch,
        'releases',
        basename(readlinkSync(join(options!.distRoot, 'current'))),
        'dist',
        'cli.mjs',
      );
      mkdirSync(join(workerEntry, '..'), { recursive: true });
      copyFileSync(entry, workerEntry);
      copyFileSync(
        join(scratch, 'package.json'),
        join(dirname(dirname(workerEntry)), 'package.json'),
      );
      const result = await runOrbCommand(
        [
          process.execPath,
          '--import',
          resolve('apps/daemon/node_modules/tsx/dist/loader.mjs'),
          workerEntry,
          socketPath,
          options!.seedRoot,
          options!.outboxRoot,
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
      expect(result.code, result.stderr).toBe(0);
      return result;
    },
  });
  const { handle, lines } = await boot({
    api,
    orbProvider: provider,
    capEnv: { CAIRN_EXECUTOR: 'orb' },
  });
  try {
    await waitFor(
      () => api.doneBodies.length === 1 || lines.some((line) => line.includes('Orb step exited')),
      60_000,
    ).catch((error: unknown) => {
      throw new Error(lines.join('\n'), { cause: error });
    });
    expect(api.doneBodies[0]?.body.status, lines.join('\n')).toBe('success');
    await waitFor(() => api.parked !== null, 30_000);
    api.parked?.({ ...claimed, step: { ...claimed.step, id: 's2' } });
    await waitFor(
      () => api.doneBodies.length === 2 || lines.some((line) => line.includes('Orb step exited')),
      60_000,
    ).catch((error: unknown) => {
      throw new Error(lines.join('\n'), { cause: error });
    });
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
}, 180_000);

test('a compiled waiting worker retains release A until refusal and release B authentication', async () => {
  const root = mkdtempSync(join(tmpdir(), 'orb-up-'));
  const host = createOrbCheckout(root);
  symlinkSync(resolve('apps/daemon/node_modules'), join(root, 'node_modules'), 'dir');
  const distRoot = join(root, 'dist');
  const runtimeRoot = join(root, 'run');
  const seedRoot = join(root, 'seed');
  for (const directory of [distRoot, runtimeRoot, seedRoot]) mkdirSync(directory);
  await build({
    stdin: {
      contents: `import { runOrbWorker } from ${JSON.stringify(resolve('apps/daemon/src/orb/worker.ts'))}; const running = runOrbWorker({ socketPath: process.argv[2], home: ${JSON.stringify(join(root, 'state'))}, workspacesRoot: ${JSON.stringify(join(root, 'work'))} }); console.log('worker-loaded'); await running;`,
      resolveDir: resolve('.'),
    },
    outfile: join(host.distSource, 'cli.mjs'),
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'esm',
    packages: 'external',
  });
  const machines = new Set<string>();
  const provider = new NspawnOrbProvider({
    distRoot,
    runtimeRoot,
    seedRoot,
    distSource: host.distSource,
    stateFile: join(root, 'handles.json'),
    runner: async (argv, options) => {
      if (argv[0] !== 'machinectl') return host.runner(argv, options);
      if (argv[1] === 'start') {
        machines.add(argv[2]!);
        mkdirSync(join(runtimeRoot, argv[2]!), { recursive: true, mode: 0o700 });
      }
      if (argv[1] === 'poweroff') machines.delete(argv[2]!);
      return { code: 0, stdout: argv[1] === 'list' ? [...machines].join('\n') : '', stderr: '' };
    },
  });
  const machine = await provider.ensure({
    conversationId: CLAIMED.conversationId,
    projectId: 'p1',
  });
  await provider.prepare(machine);
  await provider.start(machine);
  const releaseA = readlinkSync(join(distRoot, 'current'));
  const loaded = defer();
  const controller = new AbortController();
  const workers: Promise<Awaited<ReturnType<typeof runOrbCommand>>>[] = [];
  const launch = (onStdout?: (chunk: string) => void) => {
    const worker = runOrbCommand(
      [
        process.execPath,
        '--import',
        resolve('apps/daemon/node_modules/tsx/dist/loader.mjs'),
        join(distRoot, 'cli.mjs'),
        join(runtimeRoot, machine.id, 'relay.sock'),
      ],
      { env: { ...process.env, CAIRN_ORB: '1' }, signal: controller.signal, onStdout },
    );
    void worker.catch(() => {});
    workers.push(worker);
    return worker;
  };
  const first = launch((chunk) => {
    if (chunk.includes('worker-loaded')) loaded.resolve();
  });
  const stub = await startStubLlm([{ content: 'Thread completed on release B.' }]);
  let running: Awaited<ReturnType<typeof boot>> | undefined;
  try {
    await Promise.race([
      loaded.promise,
      first.then((result) => {
        throw new Error(`Worker exited before waiting: ${result.code}: ${result.stderr}`);
      }),
    ]);
    utimesSync(join(distRoot, releaseA), 1, 1);
    const builtEntry = join(host.distSource, 'cli.mjs');
    writeFileSync(
      builtEntry,
      `${readFileSync(builtEntry, 'utf8')}\nprocess.stdout.write('release-b\\n');\n`,
    );
    for (let index = 0; index < 4; index++) {
      writeFileSync(join(host.checkout, 'source.txt'), `upgrade-${index}`);
      await provider.prepare(machine);
    }
    const releaseB = readlinkSync(join(distRoot, 'current'));
    expect(releaseB).not.toBe(releaseA);
    expect(existsSync(join(distRoot, releaseA))).toBe(true);
    expect(machine.releaseKey).toBe(basename(releaseA));
    const api = new FakeMachineApi();
    const token = api.token.bind(api);
    api.token = async (stepId) => {
      const value = await token(stepId);
      return { ...value, provider: { ...value.provider, baseUrl: stub.url } };
    };
    api.claimQueue.push({
      ...CLAIMED,
      agent: { ...CLAIMED.agent!, skillsAllowlist: [], injectedSkills: [] },
    });
    running = await boot({ api, orbProvider: provider, capEnv: { CAIRN_EXECUTOR: 'orb' } });
    let firstResult: Awaited<ReturnType<typeof runOrbCommand>> | undefined;
    void first.then(
      (result) => {
        firstResult = result;
      },
      () => {},
    );
    await waitFor(() => firstResult !== undefined || api.doneBodies.length > 0, 30_000);
    expect(api.doneBodies, running.lines.join('\n')).toEqual([]);
    const stale = await first;
    expect(stale.code, stale.stderr).toBe(75);
    expect(api.doneBodies).toEqual([]);
    expect(stub.requests).toHaveLength(0);
    expect(existsSync(join(distRoot, releaseA))).toBe(true);
    const second = launch();
    await waitFor(() => api.doneBodies.length === 1, 30_000);
    expect(api.doneBodies[0]?.body.status, running.lines.join('\n')).toBe('success');
    const current = await second;
    expect(current.code, current.stderr).toBe(0);
    expect(current.stdout).toContain('release-b');
    expect(machine.releaseKey).toBe(basename(releaseB));
    expect(stub.requests).toHaveLength(1);
    await provider.prepare(machine);
    expect(existsSync(join(distRoot, releaseA))).toBe(false);
    const saved = JSON.parse(readFileSync(join(root, 'handles.json'), 'utf8'));
    expect(saved[0].releaseKey).toBe(basename(releaseB));
  } finally {
    if (running) {
      await running.handle.stop();
      await running.handle.done;
    }
    controller.abort();
    await Promise.allSettled(workers);
    await stub.close();
    rmSync(root, { recursive: true, force: true });
  }
}, 180_000);
