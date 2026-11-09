import { spawnSync } from 'node:child_process';
import {
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  statfsSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const policy = JSON.parse(
  readFileSync(new URL('./test-temp-policy.json', import.meta.url), 'utf8'),
);

export function shouldDelete(name, mtimeMs, now) {
  return (
    !name.includes('/') &&
    !name.includes('\\') &&
    policy.prefixes.some((prefix) => name.startsWith(prefix)) &&
    now - mtimeMs > policy.maxAgeMinutes * 60_000
  );
}

export function usagePercent({ blocks, bfree, bavail, files, ffree }) {
  const used = blocks - bfree;
  return {
    space: used + bavail > 0 ? (100 * used) / (used + bavail) : 0,
    inodes: files > 0 ? (100 * (files - ffree)) / files : 0,
  };
}

export function shouldWarn({ space, inodes }, lastWarning, now) {
  return (
    (space > policy.warnAbovePercent || inodes > policy.warnAbovePercent) &&
    (lastWarning === null || now - lastWarning >= policy.warningIntervalMinutes * 60_000)
  );
}

function treeBytes(path) {
  const entry = lstatSync(path);
  if (!entry.isDirectory()) return entry.size;
  return readdirSync(path).reduce((total, name) => total + treeBytes(join(path, name)), 0);
}

function inUse(path, processRoot) {
  const canonical = realpathSync(path);
  const inside = (reference) => {
    const target = reference.replace(/ \(deleted\)$/, '');
    return target === canonical || target.startsWith(`${canonical}/`);
  };
  try {
    for (const pid of readdirSync(processRoot).filter((name) => /^\d+$/.test(name))) {
      const proc = join(processRoot, pid);
      try {
        if (lstatSync(proc).uid !== process.getuid()) continue;
        if (inside(readlinkSync(`${proc}/cwd`))) return true;
        for (const fd of readdirSync(`${proc}/fd`)) {
          try {
            if (inside(readlinkSync(`${proc}/fd/${fd}`))) return true;
          } catch (error) {
            if (error.code !== 'ENOENT') throw error;
          }
        }
        const maps = readFileSync(`${proc}/maps`, 'utf8');
        if (maps.split('\n').some((line) => inside(line.replace(/^\S+(?:\s+\S+){4}\s+/, ''))))
          return true;
      } catch (error) {
        if (error.code !== 'ENOENT' && error.code !== 'ESRCH') return true;
      }
    }
    return false;
  } catch {
    return true;
  }
}

export function runGuard({
  diskRoot = join(homedir(), '.cache/lane-tmp'),
  roots = ['/tmp', join(homedir(), '.cache/cairn-test-tmp'), diskRoot],
  maxDiskBytes = policy.maxDiskBytes,
  processRoot = '/proc',
  stateDir = join(
    process.env.XDG_STATE_HOME || join(homedir(), '.local/state'),
    'cairn-test-temp-guard',
  ),
  now = Date.now(),
  usage = () => usagePercent(statfsSync('/tmp')),
  command = spawnSync,
  warn = console.warn,
} = {}) {
  if (!Number.isSafeInteger(maxDiskBytes) || maxDiskBytes < 0)
    throw new Error('maxDiskBytes must be a nonnegative safe integer');
  const deleted = [];
  const diskCandidates = [];
  let diskBytes = 0;
  const errors = [];
  const pressure = usage();
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const stamp = join(stateDir, 'last-warning');
  let lastWarning = null;
  try {
    lastWarning = Number(readFileSync(stamp, 'utf8'));
    if (!Number.isFinite(lastWarning)) throw new Error(`Invalid warning timestamp: ${stamp}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (shouldWarn(pressure, lastWarning, now)) {
    const message = `/tmp pressure: space=${pressure.space.toFixed(1)}% inodes=${pressure.inodes.toFixed(1)}% (threshold >${policy.warnAbovePercent}%)`;
    writeFileSync(`${stamp}.tmp`, String(now), { mode: 0o600 });
    renameSync(`${stamp}.tmp`, stamp);
    warn(`<4>${message}`);
    command('notify-send', ['--urgency=critical', 'Cairn test temp guard', message], {
      timeout: 10_000,
    });
  }
  for (const root of new Set(roots)) {
    try {
      if (!lstatSync(root).isDirectory()) continue;
      for (const name of readdirSync(root)) {
        const path = join(root, name);
        try {
          const entry = lstatSync(path);
          const bytes = resolve(root) === resolve(diskRoot) ? treeBytes(path) : 0;
          diskBytes += bytes;
          if (entry.isSymbolicLink() || entry.uid !== process.getuid()) continue;
          const prefixed = policy.prefixes.some((prefix) => name.startsWith(prefix));
          let nanoid = false;
          if (/^[A-Za-z0-9_-]{21}$/.test(name) && entry.isDirectory()) {
            try {
              nanoid = lstatSync(join(path, 'ssr')).isDirectory();
            } catch (error) {
              if (error.code !== 'ENOENT') throw error;
            }
          }
          if (!prefixed && !nanoid) continue;
          const stale = nanoid
            ? now - entry.mtimeMs > policy.nanoidMaxAgeMinutes * 60_000
            : shouldDelete(name, entry.mtimeMs, now);
          if (stale && !inUse(path, processRoot)) {
            rmSync(path, { recursive: true, force: true });
            deleted.push(path);
            diskBytes -= bytes;
          } else if (resolve(root) === resolve(diskRoot)) {
            diskCandidates.push({ path, bytes, mtimeMs: entry.mtimeMs, ino: entry.ino });
          }
        } catch (error) {
          if (error.code !== 'ENOENT') errors.push(error);
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') errors.push(error);
    }
  }
  for (const candidate of diskCandidates.sort((a, b) => a.mtimeMs - b.mtimeMs)) {
    if (diskBytes <= maxDiskBytes) break;
    try {
      const current = lstatSync(candidate.path);
      if (
        current.isSymbolicLink() ||
        current.ino !== candidate.ino ||
        inUse(candidate.path, processRoot)
      )
        continue;
      rmSync(candidate.path, { recursive: true, force: true });
      deleted.push(candidate.path);
      diskBytes -= candidate.bytes;
    } catch (error) {
      if (error.code !== 'ENOENT') errors.push(error);
    }
  }
  if (diskBytes > maxDiskBytes)
    warn(
      `lane-tmp over limit: ${diskBytes} bytes remain (limit ${maxDiskBytes}); live or unmanaged roots retained`,
    );
  if (errors.length) throw new AggregateError(errors, 'Test temp cleanup failed');
  return { deleted, pressure, diskBytes };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = runGuard();
  console.log(`test-temp-guard: deleted ${result.deleted.length} stale test entries`);
}
