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
  const parent = resolve(
    env.CAIRN_TEST_TEMP_ROOT ?? join(env.HOME || homedir(), '.cache/lane-tmp'),
  );
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  const root = mkdtempSync(join(parent, 'ct-'));
  const lease = openSync(root, 'r');
  return {
    root,
    env: { TMPDIR: root, CAIRN_TEST_TEMP_ROOT: root, CAIRN_HEAVY_SLOTS_DIR: slots },
    cleanup() {
      try {
        rmSync(root, { recursive: true, force: true });
      } finally {
        closeSync(lease);
      }
    },
  };
}
