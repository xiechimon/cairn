import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import { join, resolve } from 'node:path';

export function runtimeDirectory({
  root = '/',
  name,
  uid,
  gid,
  stop = false,
  dryRun = false,
  io = fs,
  run = spawnSync,
}) {
  if (!/^cairn-orb-[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(name) || name === 'cairn-orb-base')
    throw new Error('Invalid machine name');
  if (![uid, gid].every((id) => Number.isInteger(id) && id > 0 && id < 65534))
    throw new Error('Invalid runtime owner');
  const parent = join(root, 'run/cairn-orb');
  const state = join(root, 'run/systemd/nspawn');
  for (const path of [parent, state]) {
    let stat;
    try {
      stat = io.lstatSync(path);
    } catch (error) {
      if (dryRun && path === state && error.code === 'ENOENT') continue;
      throw error;
    }
    if (!stat.isDirectory() || stat.uid !== 0 || stat.gid !== 0 || (stat.mode & 0o7777) !== 0o755)
      throw new Error('Expected root-owned parent with mode 0755');
  }
  const directory = join(parent, name);
  const record = join(state, `${name}.runtime`);
  let stat;
  try {
    stat = io.lstatSync(directory);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (stat) {
    let identity;
    try {
      identity = JSON.parse(io.readFileSync(record, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (!stat.isDirectory() || identity?.dev !== stat.dev || identity?.ino !== stat.ino)
      throw new Error('Unrecognized runtime directory; refusing to follow or replace it');
  }
  if (stop) {
    if (!stat) return 0;
    if (!dryRun) {
      const result = run('/usr/bin/rm', [
        '--recursive',
        '--force',
        '--one-file-system',
        '--',
        directory,
      ]);
      if (result.status !== 0) throw new Error('Cannot remove runtime directory');
      io.unlinkSync(record);
    }
    return 1;
  }
  if (!stat && dryRun) return 1;
  if (!stat) io.mkdirSync(directory, { mode: 0o700 });
  const fd = io.openSync(
    directory,
    fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW,
  );
  try {
    const opened = io.fstatSync(fd);
    if (stat && (stat.dev !== opened.dev || stat.ino !== opened.ino))
      throw new Error('Runtime directory identity changed');
    const changed =
      !stat || opened.uid !== uid || opened.gid !== gid || (opened.mode & 0o7777) !== 0o700;
    if (!dryRun && changed) {
      io.fchownSync(fd, uid, gid);
      io.fchmodSync(fd, 0o700);
      io.writeFileSync(record, JSON.stringify({ dev: opened.dev, ino: opened.ino }), {
        mode: 0o600,
      });
    }
    return changed ? 1 : 0;
  } finally {
    io.closeSync(fd);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  if (process.getuid() !== 0) throw new Error('Runtime preparation requires root');
  const args = process.argv.slice(2);
  const dryRun = args[0] === '--dry-run';
  if (dryRun) args.shift();
  const stop = args[0] === '--stop';
  if (stop) args.shift();
  if (args.length !== 1)
    throw new Error('Usage: runtime-directory.mjs [--dry-run] [--stop] MACHINE');
  const ids = ['-u', '-g'].map((flag) => {
    const result = spawnSync('/usr/bin/id', [flag, 'ian'], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error('Cannot resolve runtime owner');
    return Number(result.stdout.trim());
  });
  console.log(
    `${runtimeDirectory({ root: process.env.CAIRN_ORB_ROOT, name: args[0], uid: ids[0], gid: ids[1], stop, dryRun })} changes`,
  );
}
