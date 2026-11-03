import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import { join, resolve } from 'node:path';

export const COMPUTER_HOME_ROOT = 'var/lib/cairn-computer';

export function isComputerMachine(name) {
  return typeof name === 'string' && /^cairn-orb-computer-[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(name);
}

export function computerHome({ root = '/', name, uid, gid, dryRun = false, io = fs }) {
  if (!isComputerMachine(name)) throw new Error('Invalid computer machine name');
  if (![uid, gid].every((id) => Number.isInteger(id) && id > 0 && id < 65534))
    throw new Error('Invalid computer home owner');
  const parent = join(root, COMPUTER_HOME_ROOT);
  const parentStat = io.lstatSync(parent);
  if (
    !parentStat.isDirectory() ||
    parentStat.uid !== 0 ||
    parentStat.gid !== 0 ||
    (parentStat.mode & 0o7777) !== 0o755
  )
    throw new Error('Expected root-owned computer home parent with mode 0755');
  const home = join(parent, name);
  let stat;
  try {
    stat = io.lstatSync(home);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (stat) {
    if (
      !stat.isDirectory() ||
      stat.uid !== uid ||
      stat.gid !== gid ||
      (stat.mode & 0o7777) !== 0o700 ||
      stat.dev !== parentStat.dev
    )
      throw new Error('Unrecognized computer home; refusing to follow or replace it');
    return 0;
  }
  if (dryRun) return 1;
  io.mkdirSync(home, { mode: 0o700 });
  const fd = io.openSync(
    home,
    fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW,
  );
  try {
    io.fchownSync(fd, uid, gid);
    io.fchmodSync(fd, 0o700);
  } finally {
    io.closeSync(fd);
  }
  return 1;
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  if (process.getuid() !== 0) throw new Error('Computer home preparation requires root');
  const args = process.argv.slice(2);
  const dryRun = args[0] === '--dry-run';
  if (dryRun) args.shift();
  if (args.length !== 1) throw new Error('Usage: computer-home.mjs [--dry-run] MACHINE');
  const ids = ['-u', '-g'].map((flag) => {
    const result = spawnSync('/usr/bin/id', [flag, 'ian'], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error('Cannot resolve computer home owner');
    return Number(result.stdout.trim());
  });
  console.log(
    `${computerHome({ root: process.env.CAIRN_ORB_ROOT, name: args[0], uid: ids[0], gid: ids[1], dryRun })} changes`,
  );
}
