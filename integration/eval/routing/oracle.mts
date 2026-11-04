import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { BenchTask } from './bench.mts';

export function runOracle(workdir: string, task: BenchTask): { pass: boolean; output: string } {
  for (const [path, content] of Object.entries(task.oracle.files)) {
    const target = join(workdir, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  const command = task.oracle.command;
  const result = spawnSync(command[0] ?? 'node', command.slice(1), {
    cwd: workdir,
    encoding: 'utf8',
    timeout: 60_000,
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  return { pass: result.status === 0, output };
}
