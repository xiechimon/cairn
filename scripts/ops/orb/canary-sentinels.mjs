import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';

import { stopRecordedChildSync } from './canary-process.mjs';

const directories = ['.cairn', '.ssh', '.codex', '.claude'];

function sentinelPaths(home, id) {
  if (!/^[a-zA-Z0-9-]{1,128}$/.test(id)) throw new Error('Invalid sentinel run ID');
  return [
    join(home, '.cairn', `.cairn-canary-${id}-pem`),
    join(home, '.cairn', `.cairn-canary-${id}-key`),
    ...directories.slice(1).map((directory) => join(home, directory, `.cairn-canary-${id}`)),
  ];
}

function checkDirectory(path) {
  if (!lstatSync(path).isDirectory() || realpathSync(path) !== path)
    throw new Error(`Secret directory must exist without symlinks: ${path}`);
}

function manifestPath(home, id, create = false) {
  sentinelPaths(home, id);
  if (!create && !lstatSync(join(home, '.cairn'), { throwIfNoEntry: false })) return;
  checkDirectory(join(home, '.cairn'));
  const parent = join(home, '.cairn/orb-canary-runs');
  if (!lstatSync(parent, { throwIfNoEntry: false })) {
    if (!create) return;
    mkdirSync(parent, { mode: 0o700 });
  }
  checkDirectory(parent);
  const stat = lstatSync(parent);
  if (stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o700)
    throw new Error('Canary manifest directory must be owned by this user with mode 0700');
  return join(parent, `${id}.jsonl`);
}

function validResource(resource) {
  if (resource.kind === 'child')
    return (
      Number.isSafeInteger(resource.pid) &&
      resource.pid > 0 &&
      typeof resource.entry === 'string' &&
      resource.entry.length > 0 &&
      typeof resource.cwd === 'string' &&
      isAbsolute(resource.cwd) &&
      typeof resource.startTime === 'string' &&
      resource.startTime.length > 0
    );
  if (resource.kind === 'machine') return /^cairn-orb-[a-f0-9-]{36}$/.test(resource.name);
  if (resource.kind === 'seed')
    return (
      typeof resource.path === 'string' &&
      /^\/var\/lib\/cairn-orb\/seed\/[a-zA-Z0-9-]+$/.test(resource.path)
    );
  if (resource.kind === 'scratch')
    return (
      typeof resource.path === 'string' &&
      resource.path.startsWith(join(realpathSync(tmpdir()), 'cairn-orb-canary-')) &&
      Number.isSafeInteger(resource.dev) &&
      Number.isSafeInteger(resource.ino)
    );
  return false;
}

function cleanupResource(resource) {
  if (resource.kind === 'child') return stopRecordedChildSync(resource);
  if (resource.kind === 'machine') {
    const result = spawnSync(
      process.execPath,
      [join(import.meta.dirname, 'machine-cleanup.mjs'), resource.name],
      { encoding: 'utf8', timeout: 180000 },
    );
    if (result.status !== 0) throw new Error('Recorded scratch machine cleanup failed');
    return;
  }
  const current = lstatSync(resource.path, { throwIfNoEntry: false });
  if (!current) return;
  checkDirectory(resource.path);
  if (resource.kind === 'scratch' && (current.dev !== resource.dev || current.ino !== resource.ino))
    throw new Error('Scratch directory replaced; preserved');
  rmSync(resource.path, { recursive: true, force: true });
}

function readManifest(home, id) {
  const path = manifestPath(home, id);
  if (!path) return;
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o600)
      throw new Error('Invalid canary manifest ownership or mode');
    const rows = readFileSync(fd, 'utf8').trim().split('\n').map(JSON.parse);
    const [header, ...inventory] = rows;
    const created = inventory.filter((row) => !row.kind);
    const resources = inventory.filter((row) => row.kind);
    const allowed = sentinelPaths(home, id);
    if (
      !header ||
      resources.some((resource) => !validResource(resource)) ||
      header.id !== id ||
      !Number.isInteger(header.pid) ||
      header.pid <= 0 ||
      created.length > allowed.length ||
      new Set(created.map((entry) => entry.path)).size !== created.length ||
      created.some(
        ({ path, dev, ino }) =>
          !allowed.includes(path) || !Number.isSafeInteger(dev) || !Number.isSafeInteger(ino),
      )
    )
      throw new Error('Invalid canary manifest inventory');
    return { path, header, created, resources };
  } finally {
    closeSync(fd);
  }
}

function cleanupManifest(home, id, allowActive = false, cleanup = cleanupResource) {
  const manifest = readManifest(home, id);
  if (!manifest) return;
  if (!allowActive) {
    try {
      process.kill(manifest.header.pid, 0);
      throw new Error('Canary run is still active; refusing recovery');
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  }
  const errors = [];
  for (const kind of ['child', 'machine', 'seed', 'scratch']) {
    for (const resource of manifest.resources.filter((row) => row.kind === kind).toReversed()) {
      try {
        cleanup(resource);
      } catch (error) {
        errors.push(error.message);
      }
    }
    if (errors.length) throw new Error(errors.join('; '));
  }
  for (const { path, dev, ino } of manifest.created.toReversed()) {
    try {
      checkDirectory(join(path, '..'));
      const current = lstatSync(path, { throwIfNoEntry: false });
      if (!current) continue;
      if (current.dev !== dev || current.ino !== ino || !current.isFile())
        throw new Error(`Sentinel replaced; preserved ${path}`);
      unlinkSync(path);
    } catch (error) {
      errors.push(error.message);
    }
  }
  if (errors.length) throw new Error(errors.join('; '));
  unlinkSync(manifest.path);
}

export function recoverSentinels(
  home,
  id,
  { read = readManifest, cleanupResource: cleanup = cleanupResource } = {},
) {
  if (id !== undefined) {
    cleanupManifest(home, id, false, cleanup);
    return;
  }
  const parent = join(home, '.cairn/orb-canary-runs');
  if (!lstatSync(parent, { throwIfNoEntry: false })) return;
  checkDirectory(parent);
  for (const name of readdirSync(parent).sort()) {
    if (!/^[a-zA-Z0-9-]{1,128}\.jsonl$/.test(name)) continue;
    const runId = name.slice(0, -6);
    const manifest = read(home, runId);
    if (!manifest) continue;
    try {
      process.kill(manifest.header.pid, 0);
      continue;
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
    cleanupManifest(home, runId, false, cleanup);
  }
}

export function remainingSentinels(home) {
  const remaining = [];
  for (const directory of directories) {
    const parent = join(home, directory);
    if (!lstatSync(parent, { throwIfNoEntry: false })) continue;
    checkDirectory(parent);
    for (const name of readdirSync(parent))
      if (name.startsWith('.cairn-canary-')) remaining.push(join(parent, name));
  }
  return remaining.sort();
}

export function plantSentinels(home, id = randomBytes(12).toString('hex')) {
  const previousUmask = process.umask(0o077);
  try {
    const paths = sentinelPaths(home, id);
    const manifest = manifestPath(home, id, true);
    const fd = openSync(manifest, 'wx', 0o600);
    const sentinels = [];
    const markers = [];
    const cleanup = () => cleanupManifest(home, id, true);
    try {
      writeFileSync(fd, `${JSON.stringify({ id, pid: process.pid })}\n`);
      fsyncSync(fd);
      for (const path of paths) {
        checkDirectory(join(path, '..'));
        const sentinel = openSync(path, 'wx', 0o600);
        try {
          const { dev, ino, mode } = fstatSync(sentinel);
          writeFileSync(fd, `${JSON.stringify({ path, dev, ino })}\n`);
          fsyncSync(fd);
          if ((mode & 0o777) !== 0o600) throw new Error('Sentinel mode must be 0600');
          const marker = `CAIRN_CANARY_${randomBytes(32).toString('hex')}`;
          writeFileSync(sentinel, marker);
          markers.push(marker);
          sentinels.push({ path, hash: createHash('sha256').update(marker).digest('hex') });
        } finally {
          closeSync(sentinel);
        }
      }
    } catch (error) {
      cleanup();
      throw error;
    } finally {
      closeSync(fd);
    }
    const record = (resource) => {
      if (!validResource(resource)) throw new Error('Invalid canary resource inventory');
      const inventory = openSync(
        manifest,
        constants.O_WRONLY | constants.O_APPEND | constants.O_NOFOLLOW,
      );
      try {
        writeFileSync(inventory, `${JSON.stringify(resource)}\n`);
        fsyncSync(inventory);
      } finally {
        closeSync(inventory);
      }
    };
    return { sentinels, markers, manifest, cleanup, record };
  } finally {
    process.umask(previousUmask);
  }
}
