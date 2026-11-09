import { spawnSync } from 'node:child_process';
import { closeSync, mkdirSync, mkdtempSync, openSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export function createTempEnvironment(env: NodeJS.ProcessEnv = process.env) {
  let slots = env.CAIRN_HEAVY_SLOTS_DIR;
  if (!slots) {
    if (process.platform === 'darwin') {
      const result = spawnSync('getconf', ['DARWIN_USER_TEMP_DIR'], { encoding: 'utf8' });
      if (result.status !== 0 || !result.stdout.trim())
        throw new Error('Cannot resolve shared heavy slots; set CAIRN_HEAVY_SLOTS_DIR');
      slots = join(result.stdout.trim(), 'cairn-heavy-slots');
    } else slots = '/tmp/cairn-heavy-slots';
  }
  const configuredRoot = resolve(
    env.CAIRN_TEST_TEMP_ROOT ?? join(env.HOME || homedir(), '.cache/lane-tmp'),
  );
  const parent =
    env.CAIRN_TEST_TEMP_ROOT && env.CAIRN_RUNTIME_TEMP_ROOT === join(configuredRoot, 'tmp')
      ? env.CAIRN_RUNTIME_TEMP_ROOT
      : configuredRoot;
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  const root = mkdtempSync(join(parent, 'ct-'));
  const runtime = join(root, 'tmp');
  mkdirSync(runtime, { mode: 0o700 });
  const lease = openSync(root, 'r');
  return {
    root,
    env: {
      TMPDIR: runtime,
      CAIRN_RUNTIME_TEMP_ROOT: runtime,
      CAIRN_TEST_TEMP_ROOT: root,
      CAIRN_HEAVY_SLOTS_DIR: slots,
    },
    cleanup() {
      try {
        rmSync(root, { recursive: true, force: true });
      } finally {
        closeSync(lease);
      }
    },
  };
}
