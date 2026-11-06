import { spawnSync } from 'node:child_process';
import {
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
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

export function runGuard({
  roots = ['/tmp', join(homedir(), '.cache/cairn-test-tmp')],
  stateDir = join(
    process.env.XDG_STATE_HOME || join(homedir(), '.local/state'),
    'cairn-test-temp-guard',
  ),
  now = Date.now(),
  usage = () => usagePercent(statfsSync('/tmp')),
  command = spawnSync,
  warn = console.warn,
} = {}) {
  const deleted = [];
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
        if (!policy.prefixes.some((prefix) => name.startsWith(prefix))) continue;
        const path = join(root, name);
        try {
          const entry = lstatSync(path);
          if (entry.isSymbolicLink() || entry.uid !== process.getuid()) continue;
          if (!shouldDelete(name, entry.mtimeMs, now)) continue;
          rmSync(path, { recursive: true, force: true });
          deleted.push(path);
        } catch (error) {
          if (error.code !== 'ENOENT') errors.push(error);
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') errors.push(error);
    }
  }
  if (errors.length) throw new AggregateError(errors, 'Test temp cleanup failed');
  return { deleted, pressure };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = runGuard();
  console.log(`test-temp-guard: deleted ${result.deleted.length} stale test entries`);
}
