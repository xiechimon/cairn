import { execFileSync } from 'node:child_process';
import {
  closeSync,
  constants,
  fchmodSync,
  fchownSync,
  fstatSync,
  ftruncateSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

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

export function tightenOwnerPath(action) {
  if (realpathSync(action.path) !== action.path) throw new Error('Unsafe owner path');
  const fd = openSync(action.path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = fstatSync(fd);
    if (
      info.uid !== action.uid ||
      info.dev !== action.dev ||
      info.ino !== action.ino ||
      (action.kind === 'directory' ? !info.isDirectory() : !info.isFile())
    )
      throw new Error('Owner path changed or has a different owner');
    fchmodSync(fd, action.mode);
  } finally {
    closeSync(fd);
  }
}

export function protectAsOwner(action, execute = execFileSync) {
  execute(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import { tightenOwnerPath } from ${JSON.stringify(import.meta.url)};tightenOwnerPath(JSON.parse(process.argv[1]));`,
      JSON.stringify(action),
    ],
    { uid: action.uid, gid: action.gid, stdio: 'ignore', env: {} },
  );
}

function changeSystemPath(action, content) {
  const parts = action.path.split('/').filter(Boolean);
  let parent = openSync('/', constants.O_RDONLY | constants.O_DIRECTORY);
  let target;
  try {
    for (const part of parts.slice(0, -1)) {
      const info = fstatSync(parent);
      if (info.uid !== 0 || (info.mode & 0o022) !== 0) throw new Error('Unsafe system ancestor');
      const next = openSync(
        `/proc/self/fd/${parent}/${part}`,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
      );
      closeSync(parent);
      parent = next;
    }
    const parentInfo = fstatSync(parent);
    if (parentInfo.uid !== 0 || (parentInfo.mode & 0o022) !== 0)
      throw new Error('Unsafe system parent');
    const path = `/proc/self/fd/${parent}/${parts.at(-1)}`;
    let previous;
    try {
      previous = lstatSync(path);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (action.type === 'directory') {
      if (!previous) mkdirSync(path, { mode: 0o700 });
      target = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    } else {
      target = openSync(
        path,
        constants.O_WRONLY |
          constants.O_NOFOLLOW |
          (previous ? 0 : constants.O_CREAT | constants.O_EXCL),
        0o600,
      );
    }
    const info = fstatSync(target);
    if (previous && (info.dev !== previous.dev || info.ino !== previous.ino))
      throw new Error('System path changed');
    if (action.type !== 'directory') {
      if (!info.isFile() || info.uid !== 0 || info.nlink !== 1 || (info.mode & 0o022) !== 0)
        throw new Error('Unsafe system file');
      writeFileSync(target, content);
      ftruncateSync(target, Buffer.byteLength(content));
    }
    fchownSync(target, action.uid, action.gid);
    fchmodSync(target, action.mode);
  } finally {
    if (target !== undefined) closeSync(target);
    closeSync(parent);
  }
}

export function setupRunner({
  host = systemHost(),
  dryRun = false,
  log = console.log,
  locations = {},
} = {}) {
  const protectedLocations = {
    parent: '/mnt/fast/cairn',
    server: '/mnt/fast/cairn/server',
    workspaces: '/mnt/fast/cairn/workspaces',
    stale: '/home/ian/.cairn/server.hdd-old',
    ...locations,
  };
  if (
    Object.values(protectedLocations).some(
      (path) => typeof path !== 'string' || !isAbsolute(path) || resolve(path) !== path,
    )
  )
    throw new Error('Invalid protected location');
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
    if (info.uid !== owner.uid) throw new Error(`Protected path has a different owner: ${path}`);
    paths.set(path, { ...info, path, mode: info.kind === 'directory' ? 0o700 : 0o600 });
    if (recursive && info.kind === 'directory')
      for (const child of host.children(path)) add(child, true);
  };
  for (const path of ['/home/ian', '/home/ian/.cairn', '/home/ian/.config/cairn']) add(path);
  add(protectedLocations.parent);
  if (paths.has(protectedLocations.parent)) paths.get(protectedLocations.parent).mode = 0o711;
  add(protectedLocations.workspaces);
  for (const path of [protectedLocations.server, protectedLocations.stale]) add(path, true);
  for (const path of [
    '/home/ian/.cairn/cairnwright.private-key.pem',
    '/home/ian/.cairn/token',
    '/home/ian/.config/cairn/server.env',
  ])
    add(path);
  if (
    !paths.has('/home/ian') ||
    !paths.has(protectedLocations.server) ||
    !paths.has(protectedLocations.parent) ||
    !paths.has(protectedLocations.workspaces)
  )
    throw new Error(
      'Owner home, Cairn parent, server data and workspaces directories are required',
    );
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
    if (
      !previous ||
      previous.kind !== entry.kind ||
      previous.uid !== owner.uid ||
      previous.dev !== entry.dev ||
      previous.ino !== entry.ino
    )
      throw new Error(`Protected owner path changed: ${entry.path}`);
    if (previous.mode !== entry.mode)
      apply({
        type: 'protect',
        path: entry.path,
        uid: owner.uid,
        gid: owner.gid,
        mode: entry.mode,
        kind: entry.kind,
        dev: entry.dev,
        ino: entry.ino,
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
      return {
        uid: info.uid,
        gid: info.gid,
        mode: info.mode & 0o7777,
        kind,
        dev: info.dev,
        ino: info.ino,
      };
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
      } else if (action.type === 'protect') protectAsOwner(action);
      else if (action.type === 'directory') changeSystemPath(action);
      else if (action.type === 'tool') {
        changeSystemPath(
          { ...action, uid: 0, gid: 0, mode: 0o644 },
          readFileSync(new URL('./canary.mjs', import.meta.url)),
        );
      } else if (action.type === 'yama')
        run('sysctl', ['-w', `kernel.yama.ptrace_scope=${action.value}`]);
      else if (action.type === 'config' || action.type === 'tmpfiles') {
        changeSystemPath(
          { ...action, uid: 0, gid: 0, mode: 0o644 },
          action.type === 'config'
            ? `kernel.yama.ptrace_scope = ${action.value}\n`
            : action.content,
        );
      }
    },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  try {
    const args = process.argv.slice(2);
    if (args.length > 1 || (args.length === 1 && args[0] !== '--dry-run'))
      throw new Error('Usage: setup-runner-user.sh [--dry-run]');
    setupRunner({
      dryRun: args[0] === '--dry-run',
      locations: process.env.SECRET_REACH_SETUP_LOCATIONS
        ? JSON.parse(process.env.SECRET_REACH_SETUP_LOCATIONS)
        : {},
    });
  } catch (error) {
    process.stderr.write(`Setup refused: ${error.message}\n`);
    process.exitCode = 1;
  }
}
