import { spawnSync } from 'node:child_process';
import { lstatSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const NAME_PATTERN = /^cairn-orb-[a-f0-9-]{36}$/;

export function cleanupCanaryContainer({
  name,
  ownerId,
  runtimeNamespace,
  run,
  runtimeDirectory = process.env.XDG_RUNTIME_DIR,
  errors = [],
}) {
  if (!NAME_PATTERN.test(name)) throw new Error('Expected the scratch Thread container name');
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(ownerId ?? ''))
    throw new Error('Expected the enrolled scratch owner');
  if (!/^[a-f0-9]{16}$/.test(runtimeNamespace ?? ''))
    throw new Error('Expected the scratch runtime namespace');
  const exists = run('podman', ['container', 'exists', name]);
  if (exists.status !== 0 && exists.status !== 1) errors.push('podman container exists failed');
  if (exists.status === 0) {
    const inspected = run('podman', ['container', 'inspect', name]);
    let container;
    try {
      const rows = JSON.parse(inspected.stdout ?? '');
      if (Array.isArray(rows) && rows.length === 1) container = rows[0];
    } catch {}
    const labels = container?.Config?.Labels;
    if (
      inspected.status !== 0 ||
      !/^[a-f0-9]{64}$/.test(container?.Id ?? '') ||
      labels?.['cairn.orb'] !== '1' ||
      labels?.['cairn.owner'] !== ownerId ||
      labels?.['cairn.conversation'] !== name.slice('cairn-orb-'.length)
    ) {
      errors.push('Refusing to remove a container without verified scratch ownership');
      return false;
    }
    const removed = run('podman', ['rm', '--force', '--ignore', '--time', '5', container.Id]);
    if (removed.status !== 0) {
      errors.push(`podman rm failed: ${(removed.stderr ?? '').trim()}`);
      return false;
    }
  }
  if (errors.length) return false;
  const directory = runtimeDirectory
    ? join(runtimeDirectory, 'cairn-orb', runtimeNamespace, name)
    : undefined;
  if (directory && lstatSync(directory, { throwIfNoEntry: false }))
    rmSync(directory, { recursive: true, force: true });
  return true;
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  if (process.argv.length !== 5) throw new Error('Expected scratch name, owner and namespace');
  const errors = [];
  const ok = cleanupCanaryContainer({
    name: process.argv[2],
    ownerId: process.argv[3],
    runtimeNamespace: process.argv[4],
    run: (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8', timeout: 90000 }),
    errors,
  });
  if (!ok) {
    process.stderr.write(`${errors.join('; ')}\n`);
    process.exitCode = 1;
  }
}
