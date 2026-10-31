import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  chownSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';

const runnerName = 'cairn-runner';
const configPath = '/etc/sysctl.d/90-cairn-runner.conf';
const toolDir = '/usr/local/lib/cairn-secret-reach';
const toolPath = `${toolDir}/canary.mjs`;
const tmpfilesPath = '/etc/tmpfiles.d/cairn-token-broker.conf';
const tmpfilesContent = 'd /run/cairn-token-broker 2710 ian cairn-runner -\n';

function checkRunner(runner, owner) {
  if (!runner) return;
  if (
    runner.uid === 0 ||
    !Number.isInteger(runner.uid) ||
    !Number.isInteger(runner.gid) ||
    runner.gid <= 0 ||
    runner.uid === owner.uid ||
    runner.home !== '/var/lib/cairn-runner' ||
    runner.group !== runnerName ||
    runner.groups.length !== 1 ||
    runner.groups[0] !== runnerName ||
    runner.groupUsers.length !== 1 ||
    runner.groupUsers[0] !== runnerName ||
    !runner.locked
  )
    throw new Error('Existing runner identity is unsafe');
}

export function setupRunner({ host = systemHost(), dryRun = false, log = console.log } = {}) {
  if (host.platform !== 'linux' || host.euid !== 0) throw new Error('Linux root required');
  const owner = host.owner;
  if (
    !Number.isInteger(owner.uid) ||
    owner.uid <= 0 ||
    !Number.isInteger(owner.gid) ||
    owner.gid <= 0 ||
    owner.home !== '/home/ian'
  )
    throw new Error('Unexpected owner identity');
  const runner = host.runner();
  checkRunner(runner, owner);
  const yama = host.yama();
  if (!Number.isInteger(yama) || yama < 0 || yama > 3) throw new Error('Yama is required');
  const config = host.config();
  const value = Math.max(1, yama, config?.value ?? 0);
  const paths = new Map();
  const add = (path, recursive = false) => {
    const info = host.inspect(path);
    if (!info) {
      log(`Missing optional path: ${path}`);
      return;
    }
    if (!['file', 'directory'].includes(info.kind)) throw new Error(`Unsafe path: ${path}`);
    paths.set(path, { ...info, path, mode: info.kind === 'directory' ? 0o700 : 0o600 });
    if (recursive && info.kind === 'directory')
      for (const child of host.children(path)) add(child, true);
  };
  for (const path of ['/home/ian', '/home/ian/.cairn', '/home/ian/.config/cairn']) add(path);
  for (const path of ['/mnt/fast/cairn/server', '/home/ian/.cairn/server.hdd-old']) add(path, true);
  for (const path of [
    '/home/ian/.cairn/cairnwright.private-key.pem',
    '/home/ian/.cairn/token',
    '/home/ian/.config/cairn/server.env',
  ])
    add(path);
  if (!paths.has('/home/ian') || !paths.has('/mnt/fast/cairn/server'))
    throw new Error('Owner home and server data directory are required');
  const socketDir = host.inspect('/run/cairn-token-broker');
  if (socketDir && socketDir.kind !== 'directory') throw new Error('Unsafe broker directory');
  const runnerHome = host.inspect('/var/lib/cairn-runner');
  if (runnerHome && runnerHome.kind !== 'directory') throw new Error('Unsafe runner home');
  const tools = host.inspect(toolDir);
  if (tools && tools.kind !== 'directory') throw new Error('Unsafe tool directory');
  const tool = host.inspect(toolPath);
  if (tool && tool.kind !== 'file') throw new Error('Unsafe canary path');
  const toolInstalled = host.toolInstalled();
  const tmpfiles = host.tmpfiles();
  const tmpfilesDir = host.inspect('/etc/tmpfiles.d');
  if (
    tmpfilesDir &&
    (tmpfilesDir.kind !== 'directory' || tmpfilesDir.uid !== 0 || (tmpfilesDir.mode & 0o022) !== 0)
  )
    throw new Error('Unsafe tmpfiles directory');
  const apply = (action) => {
    log(`${dryRun ? 'Would change' : 'Change'}: ${JSON.stringify(action)}`);
    if (!dryRun) host.change(action);
  };
  if (!runner)
    apply({
      type: 'user',
      name: runnerName,
      home: '/var/lib/cairn-runner',
      password: 'locked',
      group: runnerName,
    });
  const identity = dryRun ? runner : host.runner();
  if (!dryRun) checkRunner(identity, owner);
  for (const entry of paths.values()) {
    const previous = host.inspect(entry.path);
    if (previous.uid !== owner.uid || previous.gid !== owner.gid || previous.mode !== entry.mode)
      apply({
        type: 'protect',
        path: entry.path,
        uid: owner.uid,
        gid: owner.gid,
        mode: entry.mode,
        kind: entry.kind,
      });
  }
  for (const [path, previous, uid, gid, mode] of [
    [
      '/var/lib/cairn-runner',
      runnerHome,
      identity?.uid ?? runnerName,
      identity?.gid ?? runnerName,
      0o700,
    ],
    ['/run/cairn-token-broker', socketDir, owner.uid, identity?.gid ?? runnerName, 0o2710],
    [toolDir, tools, 0, 0, 0o755],
  ]) {
    if (!previous || previous.uid !== uid || previous.gid !== gid || previous.mode !== mode)
      apply({ type: 'directory', path, uid, gid, mode });
  }
  if (!toolInstalled) apply({ type: 'tool', path: toolPath });
  if (!tmpfilesDir)
    apply({ type: 'directory', path: '/etc/tmpfiles.d', uid: 0, gid: 0, mode: 0o755 });
  if (
    !tmpfiles ||
    tmpfiles.content !== tmpfilesContent ||
    tmpfiles.uid !== 0 ||
    tmpfiles.gid !== 0 ||
    tmpfiles.mode !== 0o644
  )
    apply({ type: 'tmpfiles', path: tmpfilesPath, content: tmpfilesContent });
  if (yama !== value) apply({ type: 'yama', path: '/proc/sys/kernel/yama/ptrace_scope', value });
  if (!config || config.value !== value || config.uid !== 0 || config.mode !== 0o644)
    apply({ type: 'config', path: configPath, value });
}

function systemHost() {
  if (process.platform !== 'linux' || process.getuid() !== 0)
    throw new Error('Linux root required');
  const run = (command, args) =>
    execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  const ownerRecord = run('getent', ['passwd', 'ian']).split(':');
  const inspect = (path) => {
    try {
      const info = lstatSync(path);
      const kind =
        info.isSymbolicLink() || realpathSync(path) !== path
          ? 'symlink'
          : info.isDirectory()
            ? 'directory'
            : info.isFile()
              ? 'file'
              : 'special';
      return { uid: info.uid, gid: info.gid, mode: info.mode & 0o7777, kind };
    } catch (error) {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    }
  };
  return {
    platform: process.platform,
    euid: process.getuid(),
    owner: { uid: Number(ownerRecord[2]), gid: Number(ownerRecord[3]), home: ownerRecord[5] },
    runner: () => {
      let record;
      try {
        record = run('getent', ['passwd', runnerName]).split(':');
      } catch (error) {
        if (error.status === 2) return null;
        throw error;
      }
      return {
        uid: Number(record[2]),
        gid: Number(record[3]),
        home: record[5],
        group: run('id', ['-gn', runnerName]),
        groups: run('id', ['-Gn', runnerName]).split(/\s+/),
        groupUsers: [
          ...new Set([
            ...run('getent', ['group', runnerName]).split(':')[3].split(',').filter(Boolean),
            ...run('getent', ['passwd'])
              .split('\n')
              .map((line) => line.split(':'))
              .filter((entry) => entry[3] === record[3])
              .map((entry) => entry[0]),
          ]),
        ],
        locked: run('passwd', ['--status', runnerName]).split(/\s+/)[1] === 'L',
      };
    },
    inspect,
    tmpfiles: () => {
      const info = inspect(tmpfilesPath);
      if (!info) return null;
      if (info.kind !== 'file') throw new Error('Unsafe tmpfiles configuration');
      return { ...info, content: readFileSync(tmpfilesPath, 'utf8') };
    },
    toolInstalled: () => {
      const info = inspect(toolPath);
      return (
        info?.kind === 'file' &&
        info.uid === 0 &&
        info.gid === 0 &&
        info.mode === 0o644 &&
        readFileSync(toolPath).equals(readFileSync(new URL('./canary.mjs', import.meta.url)))
      );
    },
    children: (path) => readdirSync(path).map((name) => join(path, name)),
    yama: () => {
      try {
        return Number(readFileSync('/proc/sys/kernel/yama/ptrace_scope', 'utf8').trim());
      } catch {
        return null;
      }
    },
    config: () => {
      const info = inspect(configPath);
      if (!info) return null;
      if (info.kind !== 'file') throw new Error('Unsafe sysctl configuration');
      const content = readFileSync(configPath, 'utf8');
      return {
        ...info,
        value: /^kernel\.yama\.ptrace_scope = [1-3]\n$/.test(content)
          ? Number(content.match(/[1-3]/)[0])
          : null,
      };
    },
    change: (action) => {
      if (action.type === 'user') {
        run('useradd', [
          '--system',
          '--user-group',
          '--create-home',
          '--home-dir',
          action.home,
          '--shell',
          '/bin/bash',
          runnerName,
        ]);
        run('usermod', ['--lock', runnerName]);
      } else if (action.type === 'protect' || action.type === 'directory') {
        if (action.type === 'directory') mkdirSync(action.path, { mode: 0o700, recursive: true });
        chownSync(action.path, action.uid, action.gid);
        chmodSync(action.path, action.mode);
      } else if (action.type === 'tool') {
        writeFileSync(toolPath, readFileSync(new URL('./canary.mjs', import.meta.url)), {
          mode: 0o600,
        });
        chownSync(toolPath, 0, 0);
        chmodSync(toolPath, 0o644);
      } else if (action.type === 'yama')
        run('sysctl', ['-w', `kernel.yama.ptrace_scope=${action.value}`]);
      else if (action.type === 'config' || action.type === 'tmpfiles') {
        writeFileSync(
          action.path,
          action.type === 'config'
            ? `kernel.yama.ptrace_scope = ${action.value}\n`
            : action.content,
          { mode: 0o600 },
        );
        chownSync(action.path, 0, 0);
        chmodSync(action.path, 0o644);
      }
    },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  try {
    const args = process.argv.slice(2);
    if (args.length > 1 || (args.length === 1 && args[0] !== '--dry-run'))
      throw new Error('Usage: setup-runner-user.sh [--dry-run]');
    setupRunner({ dryRun: args[0] === '--dry-run' });
  } catch (error) {
    process.stderr.write(`Setup refused: ${error.message}\n`);
    process.exitCode = 1;
  }
}
