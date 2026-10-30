import { spawnSync } from 'node:child_process';

export function smokeCommand(argv, { cwd, env = process.env } = {}) {
  const result = spawnSync(argv[0], argv.slice(1), {
    cwd,
    env,
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 1024 * 1024,
  });
  if (result.error || result.status !== 0) throw new Error(`Smoke command failed: ${argv[0]}`);
  return result.stdout;
}
