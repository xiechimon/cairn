import { join } from 'node:path';
import { expect, test } from 'vitest';
import { runOrbWorker } from '../src/orb/worker.js';
import { boot, CLAIMED, FakeMachineApi, fakeBackend, waitFor } from './machine-loop-harness.js';
import { FakeOrbProvider } from './orb-fake.js';
import { orbTestEntry } from './orb-release-fixture.js';
import { testTempDir } from './test-temp-dir.js';

test('a claim-bound Orb runs its worker and settles the same claim', async () => {
  const root = testTempDir('orb-claim-generation-');
  const { backend } = fakeBackend([{ type: 'done', usage: [] }]);
  const provider = new FakeOrbProvider({
    runner: async (argv, options) => {
      if (argv[0] === 'orb-worker') {
        const socketPath = options?.socketPath;
        if (!socketPath) throw new Error('Missing relay socket');
        const home = join(root, 'worker');
        await runOrbWorker({
          socketPath,
          entryPath: orbTestEntry(socketPath),
          backendFor: () => backend,
          home,
          workspacesRoot: join(home, 'work'),
        });
      }
      return { code: 0, stdout: '', stderr: '' };
    },
  });
  const api = new FakeMachineApi();
  api.claimQueue.push({ ...CLAIMED, step: { ...CLAIMED.step, generation: 23 } });
  const { handle, lines } = await boot({
    api,
    orbProvider: provider,
    capEnv: { CAIRN_EXECUTOR: 'orb' },
  });
  try {
    await waitFor(() => api.doneBodies.length === 1);
    expect(api.doneBodies[0]?.body, lines.join('\n')).toMatchObject({
      status: 'success',
      generation: 23,
    });
  } finally {
    await handle.stop();
    await handle.done;
  }
});
