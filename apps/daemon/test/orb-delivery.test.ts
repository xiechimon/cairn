import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type AgentBackend, conversationBranch } from '@cairn/shared';
import { afterEach, expect, test, vi } from 'vitest';
import { gitPrim, runGitOk } from '../src/git.js';
import { NspawnOrbProvider } from '../src/orb/provider.js';
import { RelayMachineApi, RelayMachineServer } from '../src/orb/relay.js';
import { runOrbWorker } from '../src/orb/worker.js';
import { boot, CLAIMED, FakeMachineApi, fakeBackend, waitFor } from './machine-loop-harness.js';

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'orb-delivery-'));
  roots.push(root);
  const repo = join(root, 'repo');
  await runGitOk(['init', '-b', 'main', repo]);
  await runGitOk(
    [
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.test',
      'commit',
      '--allow-empty',
      '-m',
      'Initial',
    ],
    { cwd: repo },
  );
  const branch = conversationBranch(CLAIMED.conversationId);
  const outboxDir = join(root, 'outbox');
  mkdirSync(outboxDir, { mode: 0o700 });
  return { root, repo, branch, outboxDir };
}

test.each(['local', 'github', 'local-rejected'] as const)(
  '%s orb step delivers a new commit and releases its per-step outbox',
  async (kind) => {
    const { root, repo, branch } = await fixture();
    let commit = '';
    let outbox = '';
    const push = vi.spyOn(gitPrim, 'push');
    const backend: AgentBackend = {
      ...fakeBackend([]).backend,
      async createSession(opts) {
        if (kind === 'local-rejected') await runGitOk(['checkout', '-b', branch], { cwd: repo });
        writeFileSync(join(opts.cwd, 'delivered.txt'), 'Delivered by Thread');
        await runGitOk(['add', 'delivered.txt'], { cwd: opts.cwd });
        await runGitOk(
          ['-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '-m', 'Deliver'],
          { cwd: opts.cwd },
        );
        commit = await runGitOk(['rev-parse', 'HEAD'], { cwd: opts.cwd });
        return fakeBackend([{ type: 'done', usage: [] }]).backend.createSession(opts);
      },
    };
    const api = new FakeMachineApi();
    api.claimQueue.push({
      ...CLAIMED,
      step: { ...CLAIMED.step, kind: 'build' },
      project: {
        ...CLAIMED.project!,
        repo: { kind: kind === 'github' ? 'github' : 'local', cloneUrl: repo },
      },
    });
    const provider = new NspawnOrbProvider({
      runner: async (argv, options) => {
        if (!argv.includes('--uid=agent')) return { code: 0, stdout: '', stderr: '' };
        const binds = options!.binds!;
        const seed = binds.find((bind) => bind.target.startsWith('/seed/'));
        outbox = binds.find((bind) => bind.target === '/run/cairn/outbox')?.source ?? '';
        if (kind !== 'github') {
          expect(outbox).not.toBe('');
          expect(statSync(outbox).mode & 0o777).toBe(0o700);
          expect(binds.find((bind) => bind.source === outbox)).toMatchObject({
            releaseAfterExec: true,
          });
        }
        if (seed)
          cpSync(seed.source, join(root, 'seed', CLAIMED.project!.id, 'repo'), { recursive: true });
        await runOrbWorker({
          socketPath: binds.find((bind) => bind.target.endsWith('relay.sock'))!.source,
          backendFor: () => backend,
          home: join(root, 'worker'),
          workspacesRoot: join(root, 'work'),
          seedRoot: join(root, 'seed'),
          outboxRoot: outbox,
        });
        return { code: 0, stdout: '', stderr: '' };
      },
    });
    const { handle } = await boot({
      api,
      orbProvider: provider,
      capEnv: { CAIRN_EXECUTOR: 'orb' },
    });
    try {
      await waitFor(() => api.doneBodies.length === 1, 10_000);
      if (kind === 'local-rejected') {
        expect(api.doneBodies[0]?.body).toMatchObject({
          status: 'failed',
          errorMessage: expect.stringContaining('Bundle delivery rejected'),
        });
      } else {
        expect(api.doneBodies[0]?.body).toMatchObject({ status: 'success' });
        expect(commit).not.toBe('');
        expect(await runGitOk(['rev-parse', `refs/heads/${branch}`], { cwd: repo })).toBe(commit);
        expect(await runGitOk(['show', `${branch}:delivered.txt`], { cwd: repo })).toBe(
          'Delivered by Thread',
        );
        if (kind === 'github') expect(push).toHaveBeenCalled();
        else expect(push).not.toHaveBeenCalled();
      }
    } finally {
      await handle.stop();
      await handle.done;
    }
    if (kind !== 'github') expect(existsSync(outbox)).toBe(false);
  },
  20_000,
);

test.each([
  'extra-ref',
  'another-thread',
  'oversized',
  'escape',
  'absolute',
  'symlink',
  'invalid',
  'wrong-step',
  'extra-argument',
] as const)('relay rejects %s delivery without changing host refs', async (attack) => {
  const { root, repo, branch, outboxDir } = await fixture();
  await runGitOk(['branch', branch], { cwd: repo });
  await runGitOk(['branch', 'other-thread'], { cwd: repo });
  const before = await runGitOk(['show-ref'], { cwd: repo });
  const bundle = join(outboxDir, 'step.bundle');
  await runGitOk(
    [
      'bundle',
      'create',
      bundle,
      ...(attack === 'another-thread'
        ? ['refs/heads/other-thread']
        : [`refs/heads/${branch}`, ...(attack === 'extra-ref' ? ['refs/heads/other-thread'] : [])]),
    ],
    { cwd: repo },
  );
  if (attack === 'oversized') truncateSync(bundle, 64 * 1024 * 1024 + 1);
  if (attack === 'symlink') {
    rmSync(bundle);
    symlinkSync(join(root, 'outside.bundle'), bundle);
  }
  if (attack === 'invalid') writeFileSync(bundle, 'not a bundle');
  const server = new RelayMachineServer({
    socketPath: join(root, 'relay.sock'),
    stepId: 's1',
    upstream: new FakeMachineApi(),
    localDelivery: { outboxDir, repoPath: repo, conversationId: CLAIMED.conversationId },
  });
  await server.listen();
  const relay = await RelayMachineApi.connect(join(root, 'relay.sock'));
  try {
    const name =
      attack === 'escape' ? '../step.bundle' : attack === 'absolute' ? bundle : 'step.bundle';
    await expect(
      relay.call('deliverBundle', [
        attack === 'wrong-step' ? 'victim' : 's1',
        name,
        ...(attack === 'extra-argument' ? ['unexpected'] : []),
      ]),
    ).rejects.toThrow(attack === 'wrong-step' ? /step does not match/ : /bundle/i);
    expect(await runGitOk(['show-ref'], { cwd: repo })).toBe(before);
  } finally {
    relay.close();
    await server.close();
  }
});

test.each(['fast-forward', 'divergent', 'already-contained'] as const)(
  'host bundle delivery preserves %s push semantics',
  async (mode) => {
    const { root, repo, branch, outboxDir } = await fixture();
    const worker = join(root, 'worker');
    await runGitOk(['clone', repo, worker]);
    await runGitOk(['checkout', '-b', branch], { cwd: worker });
    await runGitOk(
      [
        '-c',
        'user.name=Test',
        '-c',
        'user.email=test@example.test',
        'commit',
        '--allow-empty',
        '-m',
        'Worker',
      ],
      { cwd: worker },
    );
    const head = await runGitOk(['rev-parse', 'HEAD'], { cwd: worker });
    await runGitOk(['bundle', 'create', join(outboxDir, 'step.bundle'), `refs/heads/${branch}`], {
      cwd: worker,
    });
    if (mode === 'already-contained')
      await runGitOk(['fetch', worker, `${branch}:refs/heads/${branch}`], { cwd: repo });
    else await runGitOk(['branch', branch], { cwd: repo });
    if (mode !== 'fast-forward') {
      await runGitOk(['checkout', branch], { cwd: repo });
      await runGitOk(
        [
          '-c',
          'user.name=Test',
          '-c',
          'user.email=test@example.test',
          'commit',
          '--allow-empty',
          '-m',
          'Host',
        ],
        { cwd: repo },
      );
      await runGitOk(['checkout', 'main'], { cwd: repo });
    }
    const before = await runGitOk(['show-ref'], { cwd: repo });
    const server = new RelayMachineServer({
      socketPath: join(root, 'relay.sock'),
      stepId: 's1',
      upstream: new FakeMachineApi(),
      localDelivery: { outboxDir, repoPath: repo, conversationId: CLAIMED.conversationId },
    });
    await server.listen();
    const relay = await RelayMachineApi.connect(join(root, 'relay.sock'));
    try {
      const delivery = relay.call('deliverBundle', ['s1', 'step.bundle']);
      if (mode === 'divergent') await expect(delivery).rejects.toThrow(/non-fast-forward/);
      else await delivery;
      if (mode !== 'fast-forward') expect(await runGitOk(['show-ref'], { cwd: repo })).toBe(before);
      else expect(await runGitOk(['rev-parse', `refs/heads/${branch}`], { cwd: repo })).toBe(head);
    } finally {
      relay.close();
      await server.close();
    }
  },
);
