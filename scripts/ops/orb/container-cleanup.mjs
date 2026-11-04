import { spawnSync } from 'node:child_process';
import { lstatSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const NAME_PATTERN = /^cairn-orb-[a-f0-9-]{36}$/;

export function cleanupCanaryContainer({
  name,
  run,
  runtimeDirectory = process.env.XDG_RUNTIME_DIR,
  errors = [],
}) {
  if (!NAME_PATTERN.test(name)) throw new Error('Expected the scratch Thread container name');
  const exists = run('podman', ['container', 'exists', name]);
  if (exists.status !== 0 && exists.status !== 1) errors.push('podman container exists failed');
  if (exists.status === 0) {
    const label = run('podman', [
      'container',
      'inspect',
      '--format',
      '{{index .Config.Labels "cairn.orb"}}',
      name,
    ]);
    if (label.status !== 0 || (label.stdout ?? '').trim() !== '1') {
      errors.push('Refusing to remove a container without the cairn.orb label');
      return false;
    }
    const removed = run('podman', ['rm', '--force', '--ignore', '--time', '5', name]);
    if (removed.status !== 0) {
      errors.push(`podman rm failed: ${(removed.stderr ?? '').trim()}`);
      return false;
    }
  }
  if (errors.length) return false;
  const directory = runtimeDirectory ? join(runtimeDirectory, 'cairn-orb', name) : undefined;
  if (directory && lstatSync(directory, { throwIfNoEntry: false }))
    rmSync(directory, { recursive: true, force: true });
  return true;
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  if (process.argv.length !== 3) throw new Error('Expected the scratch Thread container name');
  const errors = [];
  const ok = cleanupCanaryContainer({
    name: process.argv[2],
    run: (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8', timeout: 90000 }),
    errors,
  });
  if (!ok) {
    process.stderr.write(`${errors.join('; ')}\n`);
    process.exitCode = 1;
  }
}
