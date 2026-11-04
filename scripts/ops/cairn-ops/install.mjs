import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  chownSync,
  closeSync,
  constants,
  existsSync,
  fchmodSync,
  fchownSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installedLayout, layoutFile, validateConfig, wrapperScript } from './run.mjs';

export const sudoersPath = '/etc/sudoers.d/zz-cairn-ops';

export function sudoersRule(user) {
  return `Defaults!${installedLayout.runner} env_reset, !setenv\n${user} ALL=(root) NOPASSWD: ${installedLayout.runner}\n`;
}

const sourceDirectory = dirname(fileURLToPath(import.meta.url));

function octal(mode) {
  return mode.toString(8).padStart(4, '0');
}

function current(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    if (error.code === 'EACCES') return 'unreadable';
    throw error;
  }
}

function sameContent(path, content) {
  try {
    return readFileSync(path).equals(Buffer.from(content));
  } catch (error) {
    if (error.code === 'EACCES') return 'unreadable';
    throw error;
  }
}

function checkSudoers(visudo, content) {
  const scratch = mkdtempSync(join(tmpdir(), 'cairn-ops-sudoers-'));
  try {
    const candidate = join(scratch, 'candidate');
    writeFileSync(candidate, content, { mode: 0o440 });
    const result = spawnSync(visudo, ['-cf', candidate], { encoding: 'utf8' });
    if (result.status !== 0)
      throw new Error(
        `visudo rejected the sudoers rule: ${(result.stdout + result.stderr).trim()}`,
      );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

export function install({
  root = '/',
  dryRun = false,
  log = console.log,
  owner = 0,
  group = 0,
  euid = process.geteuid(),
  user = 'ian',
  visudo = '/usr/bin/visudo',
  git = installedLayout.git,
  tools = [
    installedLayout.node,
    installedLayout.git,
    installedLayout.flock,
    installedLayout.env,
    visudo,
  ],
  source = sourceDirectory,
} = {}) {
  if (!dryRun && euid !== owner) throw new Error('install.sh must run as root: sudo sh install.sh');
  for (const tool of tools)
    if (!existsSync(tool)) throw new Error(`required tool missing: ${tool}`);
  const tasks = readFileSync(join(source, 'tasks.json'), 'utf8');
  validateConfig(JSON.parse(tasks));
  const sudoers = sudoersRule(user);
  checkSudoers(visudo, sudoers);

  const target = (path) => join(root, path);
  const say = (message) => log(dryRun ? `would ${message}` : message);
  let changed = 0;

  const ensureOwnership = (path, stat, mode) => {
    if (stat === 'unreadable') return;
    if ((stat.mode & 0o7777) !== mode) {
      say(`chmod ${path} ${octal(stat.mode & 0o7777)} -> ${octal(mode)}`);
      changed += 1;
      if (!dryRun) chmodSync(target(path), mode);
    }
    if (stat.uid !== owner || stat.gid !== group) {
      say(`chown ${path} ${stat.uid}:${stat.gid} -> ${owner}:${group}`);
      changed += 1;
      if (!dryRun) chownSync(target(path), owner, group);
    }
  };

  const ensureDirectory = (path, mode) => {
    const stat = current(target(path));
    if (stat === null) {
      say(`create directory ${path} (${octal(mode)})`);
      changed += 1;
      if (dryRun) return;
      mkdirSync(target(path), { mode });
      chownSync(target(path), owner, group);
      chmodSync(target(path), mode);
      return;
    }
    if (stat !== 'unreadable' && !stat.isDirectory())
      throw new Error(`${path} exists and is not a directory`);
    ensureOwnership(path, stat, mode);
  };

  const ensureFile = (path, content, mode, { keepContent = false } = {}) => {
    const stat = current(target(path));
    if (stat !== null && stat !== 'unreadable' && !stat.isFile())
      throw new Error(`${path} exists and is not a regular file`);
    const same = stat === null ? false : keepContent || sameContent(target(path), content);
    if (stat !== null && same === true) {
      ensureOwnership(path, stat, mode);
      return;
    }
    say(
      `${stat === null ? 'create' : 'write'} ${path} (${octal(mode)})${same === 'unreadable' || stat === 'unreadable' ? ' (current state unreadable)' : ''}`,
    );
    changed += 1;
    if (dryRun) return;
    const staging = join(dirname(target(path)), `.${basename(path)}.cairn-ops-new`);
    if (existsSync(staging)) unlinkSync(staging);
    const descriptor = openSync(
      staging,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      writeSync(descriptor, content);
      fchownSync(descriptor, owner, group);
      fchmodSync(descriptor, mode);
    } finally {
      closeSync(descriptor);
    }
    renameSync(staging, target(path));
  };

  const ensureMirror = (path) => {
    const stat = current(target(path));
    if (stat !== null) {
      if (stat !== 'unreadable' && !stat.isDirectory())
        throw new Error(`${path} exists and is not a directory`);
      return;
    }
    say(`initialize bare mirror ${path}`);
    changed += 1;
    if (dryRun) return;
    const result = spawnSync(git, ['init', '--quiet', '--bare', target(path)], {
      env: { PATH: '/usr/bin:/bin', HOME: target(dirname(path)), GIT_CONFIG_NOSYSTEM: '1' },
      encoding: 'utf8',
    });
    if (result.status !== 0) throw new Error(`git init failed: ${result.stderr.trim()}`);
  };

  const layout = installedLayout;
  for (const path of [
    dirname(layout.module),
    layout.module,
    join(dirname(layout.module), 'layout.json'),
    layout.runner,
    dirname(layout.config),
    layout.config,
    layout.state,
    layout.work,
    layout.mirror,
    dirname(layout.log),
    layout.log,
    sudoersPath,
  ]) {
    const stat = current(target(path));
    if (stat !== null && stat !== 'unreadable' && stat.isSymbolicLink())
      throw new Error(`${path} is a symlink; refusing to install through it`);
  }
  ensureDirectory(dirname(layout.module), 0o755);
  ensureFile(layout.module, readFileSync(join(source, 'run.mjs')), 0o644);
  ensureFile(join(dirname(layout.module), 'layout.json'), layoutFile(layout), 0o644);
  ensureFile(layout.runner, wrapperScript(layout), 0o755);
  ensureDirectory(dirname(layout.config), 0o755);
  ensureFile(layout.config, tasks, 0o644);
  ensureDirectory(layout.state, 0o711);
  ensureDirectory(layout.work, 0o711);
  ensureMirror(layout.mirror);
  if (current(target(layout.mirror)) !== null) ensureDirectory(layout.mirror, 0o700);
  ensureDirectory(dirname(layout.log), 0o755);
  ensureFile(layout.log, '', 0o644, { keepContent: true });
  ensureFile(sudoersPath, sudoers, 0o440);
  log(
    changed === 0
      ? 'cairn-ops: already installed, nothing to change'
      : dryRun
        ? `cairn-ops: dry run, ${changed} change(s) not applied`
        : `cairn-ops: applied ${changed} change(s)`,
  );
  return changed;
}

export function main(argv = process.argv.slice(2)) {
  if (argv.length > 1 || (argv.length === 1 && argv[0] !== '--dry-run')) {
    process.stderr.write('usage: install.sh [--dry-run]\n');
    return 2;
  }
  try {
    install({ dryRun: argv[0] === '--dry-run' });
    return 0;
  } catch (error) {
    process.stderr.write(`cairn-ops: ${error.message}\n`);
    return 1;
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = main();
