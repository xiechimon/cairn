import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

export function command(cmd, args) {
  return spawnSync(cmd, args, {
    encoding: 'utf8',
    timeout: ['bash', 'pacman'].includes(cmd) ? 0 : 30_000,
    maxBuffer: 16 * 1024 * 1024,
    env: process.env,
  });
}

export function changes({ root = '/', dryRun = false, run = command, log = console.log } = {}) {
  let count = 0;
  const matches = (path, content, mode = 0o644) => {
    const target = join(root, path);
    return (
      existsSync(target) &&
      readFileSync(target).equals(Buffer.isBuffer(content) ? content : Buffer.from(content)) &&
      (statSync(target).mode & 0o777) === mode
    );
  };
  return {
    matches,
    get count() {
      return count;
    },
    probe: run,
    exec(cmd, args) {
      log(`${dryRun ? 'plan: ' : ''}${[cmd, ...args].join(' ')}`);
      if (!dryRun) {
        const result = run(cmd, args);
        if (result.stdout?.trim()) log(result.stdout.trim());
        if (result.stderr?.trim()) log(result.stderr.trim());
        if (result.status !== 0)
          throw new Error(`${cmd} failed: ${result.stderr || result.error || result.status}`);
      }
      count++;
    },
    file(path, content, mode = 0o644) {
      const target = join(root, path);
      if (matches(path, content, mode)) return;
      log(`${dryRun ? 'plan: ' : ''}install ${path} mode ${mode.toString(8)}`);
      if (!dryRun) {
        mkdirSync(dirname(target), { recursive: true, mode: 0o755 });
        const temp = `${target}.${randomUUID()}.tmp`;
        writeFileSync(temp, content, { mode });
        chmodSync(temp, mode);
        renameSync(temp, target);
      }
      count++;
    },
  };
}
