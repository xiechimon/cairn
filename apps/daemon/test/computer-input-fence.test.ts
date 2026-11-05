import { spawn } from 'node:child_process';
import { chmodSync, mkdirSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, test } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { ComputerInputFence } from '../src/computer/input-fence.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) expect(releaseTestTempDir(root)).toBe(true);
});
function fixture() {
  const root = makeTestTempDir('computer-input-fence-');
  roots.push(root);
  return { root, fence: new ComputerInputFence(root, 'machine-one') };
}

describe.skipIf(process.platform !== 'linux')(
  'computer input ownership across daemon instances',
  () => {
    test('same-scope writers exclude each other until the input lease is released', async () => {
      const { root, fence } = fixture();
      const other = new ComputerInputFence(root, 'machine-one');
      const owner = await fence.acquire('chief:one');
      try {
        await expect(other.acquire('chief:one')).rejects.toThrow('already has an input owner');
        const unrelated = await other.acquire('chief:two');
        unrelated.release();
        await expect(other.acquire('chief:one')).rejects.toThrow('already has an input owner');
      } finally {
        owner.release();
      }
      const next = await other.acquire('chief:one');
      next.release();
      next.release();
      expect(readdirSync(root)).toHaveLength(2);
    });

    test('machine identity is lazy, required and pinned across input acquisitions', async () => {
      const { root } = fixture();
      let machineId = '';
      let reads = 0;
      const fence = new ComputerInputFence(root, () => {
        reads += 1;
        return machineId;
      });
      expect(reads).toBe(0);
      await expect(fence.acquire('chief:one')).rejects.toThrow('enrolled machine');
      machineId = 'machine-one';
      const first = await fence.acquire('chief:one');
      machineId = 'machine-two';
      try {
        await expect(
          new ComputerInputFence(root, 'machine-one').acquire('chief:one'),
        ).rejects.toThrow('already has an input owner');
        const unrelatedOwner = await new ComputerInputFence(root, 'machine-two').acquire(
          'chief:one',
        );
        unrelatedOwner.release();
        const samePinnedOwner = await fence.acquire('chief:two');
        samePinnedOwner.release();
        expect(reads).toBe(2);
      } finally {
        first.release();
      }
    });

    test('a cancelled caller never acquires the input fence', async () => {
      const { root, fence } = fixture();
      const controller = new AbortController();
      controller.abort(new Error('call expired'));
      await expect(fence.acquire('chief:one', controller.signal)).rejects.toThrow('call expired');
      expect(readdirSync(root)).toEqual([]);
    });

    test('unknown or non-private directories fail closed', async () => {
      const { root } = fixture();
      chmodSync(root, 0o755);
      await expect(
        new ComputerInputFence(root, 'machine-one').acquire('chief:one'),
      ).rejects.toThrow('private');
      const missing = join(root, 'missing');
      await expect(
        new ComputerInputFence(missing, 'machine-one').acquire('chief:one'),
      ).rejects.toThrow();
    });

    test('symlinked roots and lock files cannot substitute a different lock inode', async () => {
      const { root, fence } = fixture();
      const link = join(root, 'root-link');
      symlinkSync(root, link);
      await expect(
        new ComputerInputFence(link, 'machine-one').acquire('chief:one'),
      ).rejects.toThrow('private');
      const first = await fence.acquire('chief:one');
      first.release();
      const filename = readdirSync(root).find((name) => name.endsWith('.lock'));
      if (!filename) throw new Error('Missing lock file');
      const secondRoot = join(root, 'other');
      mkdirSync(secondRoot, { mode: 0o700 });
      symlinkSync(join(root, filename), join(secondRoot, filename));
      await expect(
        new ComputerInputFence(secondRoot, 'machine-one').acquire('chief:one'),
      ).rejects.toThrow();
    });

    test('a permissive or non-regular lock file is rejected', async () => {
      const { root, fence } = fixture();
      const first = await fence.acquire('chief:one');
      first.release();
      const filename = readdirSync(root)[0];
      if (!filename) throw new Error('Missing lock file');
      chmodSync(join(root, filename), 0o644);
      await expect(fence.acquire('chief:one')).rejects.toThrow('private');
      const otherRoot = join(root, 'other');
      mkdirSync(otherRoot, { mode: 0o700 });
      mkdirSync(join(otherRoot, filename), { mode: 0o700 });
      await expect(
        new ComputerInputFence(otherRoot, 'machine-one').acquire('chief:one'),
      ).rejects.toThrow();
    });

    test('a second process cannot acquire the scope until its current owner exits', async () => {
      const { root, fence } = fixture();
      const entry = new URL('../src/computer/input-fence.ts', import.meta.url).href;
      const worker = join(root, 'owner.mjs');
      writeFileSync(
        worker,
        `import { ComputerInputFence } from ${JSON.stringify(entry)};\nawait new ComputerInputFence(${JSON.stringify(root)}, 'machine-one').acquire('chief:one');\nprocess.send('owned');\nprocess.on('message',()=>process.exit(0));\n`,
        { mode: 0o600 },
      );
      const child = spawn(process.execPath, ['--import', 'tsx', worker], {
        cwd: fileURLToPath(new URL('..', import.meta.url)),
        stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      });
      let stderr = '';
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      const exited = new Promise<number | null>((resolve) => child.once('exit', resolve));
      try {
        await new Promise<void>((resolve, reject) => {
          child.once('message', () => resolve());
          child.once('error', reject);
          child.once('exit', (code) => reject(new Error(`Input owner exited ${code}: ${stderr}`)));
        });
        await expect(fence.acquire('chief:one')).rejects.toThrow('already has an input owner');
      } finally {
        if (child.connected) child.send('exit');
        expect(await exited).toBe(0);
      }
      const next = await fence.acquire('chief:one');
      next.release();
    });
  },
);
