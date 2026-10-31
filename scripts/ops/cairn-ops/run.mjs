import { spawnSync } from 'node:child_process';
import {
  closeSync,
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeSync,
} from 'node:fs';
import { constants as osConstants } from 'node:os';
import { dirname, isAbsolute, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const installedLayout = {
  runner: '/usr/local/sbin/cairn-ops-run',
  module: '/usr/local/lib/cairn-ops/run.mjs',
  config: '/etc/cairn-ops/tasks.json',
  state: '/var/lib/cairn-ops',
  mirror: '/var/lib/cairn-ops/cairn.git',
  work: '/var/lib/cairn-ops/work',
  lock: '/var/lib/cairn-ops/run.lock',
  log: '/var/log/cairn-ops/run.log',
  git: '/usr/bin/git',
  node: '/usr/bin/node',
  flock: '/usr/bin/flock',
  env: '/usr/bin/env',
  taskPath: '/usr/local/sbin:/usr/local/bin:/usr/bin',
  taskHome: '/root',
};

const usage = 'usage: cairn-ops-run <task> <full-commit-sha> [--dry-run] [--env NAME=VALUE]...';
const commitPattern = /^[0-9a-f]{40}$/;
const taskNamePattern = /^[a-z0-9][a-z0-9-]{0,63}$/;
const segmentPattern = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const envNamePattern = /^[A-Z][A-Z0-9_]{0,63}$/;
const reservedEnvPattern =
  /^(PATH|HOME|LANG|ENV|IFS|PS4|SHELL|SHELLOPTS|TMPDIR|LC_.*|CAIRN_OPS_.*|LD_.*|DYLD_.*|BASH_.*|NODE_.*|GIT_.*|PYTHON.*|PERL.*|RUBY.*|SUDO_.*)$/;
const branchPattern = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/;
const urlPattern = /^(https:\/\/[A-Za-z0-9.-]+\/|file:\/\/\/)[A-Za-z0-9._/-]+$/;
const proxyPattern = /^http:\/\/[A-Za-z0-9.-]+:[0-9]{1,5}$/;
function hasControlCharacter(value) {
  return [...value].some(
    (character) => character.charCodeAt(0) < 0x20 || character.charCodeAt(0) === 0x7f,
  );
}
const maxEnvValueLength = 256;

class Refusal extends Error {}

function refuse(message) {
  throw new Refusal(message);
}

function exactKeys(value, required, optional, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    refuse(`${label} must be an object`);
  for (const key of required) if (!Object.hasOwn(value, key)) refuse(`${label} lacks ${key}`);
  for (const key of Object.keys(value))
    if (!required.includes(key) && !optional.includes(key))
      refuse(`${label} has unknown field ${key}`);
}

function assertAbsolutePath(path, label) {
  if (typeof path !== 'string' || !isAbsolute(path) || hasControlCharacter(path))
    refuse(`${label} must be an absolute path`);
  for (const segment of path.split('/').slice(1))
    if (segment === '' || segment === '.' || segment === '..')
      refuse(`${label} must be a normalized path: ${path}`);
}

function assertRelativeShape(path, label) {
  if (typeof path !== 'string' || path.length === 0) refuse(`${label} must be a relative path`);
  for (const segment of path.split('/'))
    if (!segmentPattern.test(segment)) refuse(`${label} has an unsafe segment: ${path}`);
}

export function validateConfig(config) {
  exactKeys(config, ['source', 'tasks'], [], 'config');
  exactKeys(config.source, ['url', 'branch'], ['proxy'], 'config.source');
  if (typeof config.source.url !== 'string' || !urlPattern.test(config.source.url))
    refuse('config.source.url must be an https or file URL');
  if (
    typeof config.source.branch !== 'string' ||
    !branchPattern.test(config.source.branch) ||
    config.source.branch.includes('..')
  )
    refuse('config.source.branch is not a safe branch name');
  if (
    Object.hasOwn(config.source, 'proxy') &&
    (typeof config.source.proxy !== 'string' || !proxyPattern.test(config.source.proxy))
  )
    refuse('config.source.proxy must be http://host:port');
  exactKeys(config.tasks, [], Object.keys(config.tasks ?? {}), 'config.tasks');
  for (const [name, task] of Object.entries(config.tasks)) {
    if (!taskNamePattern.test(name)) refuse(`invalid task name ${JSON.stringify(name)}`);
    const label = `task ${name}`;
    exactKeys(task, ['directory', 'interpreter', 'entry', 'args', 'env'], [], label);
    assertRelativeShape(task.directory, `${label} directory`);
    if (typeof task.entry !== 'string' || !segmentPattern.test(task.entry))
      refuse(`${label} entry must be a file name`);
    assertAbsolutePath(task.interpreter, `${label} interpreter`);
    if (
      !Array.isArray(task.args) ||
      task.args.some((arg) => typeof arg !== 'string' || hasControlCharacter(arg))
    )
      refuse(`${label} args must be plain strings`);
    exactKeys(task.env, [], Object.keys(task.env ?? {}), `${label} env`);
    for (const [variable, pattern] of Object.entries(task.env)) {
      if (!envNamePattern.test(variable) || reservedEnvPattern.test(variable))
        refuse(`${label} env may not allow ${variable}`);
      if (typeof pattern !== 'string') refuse(`${label} env ${variable} pattern must be a string`);
      new RegExp(pattern);
    }
  }
  return config;
}

function validateLayout(layout) {
  exactKeys(layout, Object.keys(installedLayout), [], 'layout');
  for (const [key, value] of Object.entries(layout)) {
    if (key === 'taskPath') {
      for (const directory of String(value).split(':'))
        assertAbsolutePath(directory, 'layout taskPath');
    } else assertAbsolutePath(value, `layout ${key}`);
  }
  return layout;
}

function assertTrusted(path, trusted, label) {
  let real;
  try {
    real = realpathSync(path);
  } catch {
    refuse(`${label} ${path} is missing`);
  }
  let current = sep;
  for (const segment of ['', ...real.split(sep).filter(Boolean)]) {
    current = segment ? join(current, segment) : sep;
    const stat = lstatSync(current);
    if (!trusted.has(stat.uid))
      refuse(`${label}: ${current} is not owned by uid ${[...trusted].join(' or ')}`);
    if (stat.mode & 0o022) refuse(`${label}: ${current} is writable by group or others`);
  }
}

export function validateTree(entries, directory, entry) {
  const prefix = `${directory}/`;
  for (const item of entries) {
    if (!item.path.startsWith(prefix)) refuse(`tree entry outside ${directory}: ${item.path}`);
    for (const segment of item.path.split('/'))
      if (
        segment === '' ||
        segment === '.' ||
        segment === '..' ||
        segment.toLowerCase() === '.git' ||
        hasControlCharacter(segment)
      )
        refuse(`unsafe path in tree: ${JSON.stringify(item.path)}`);
    if (item.type !== 'blob' || (item.mode !== '100644' && item.mode !== '100755'))
      refuse(`unsupported entry mode ${item.mode} (${item.type}) at ${item.path}`);
  }
  if (!entries.some((item) => item.path === `${prefix}${entry}`))
    refuse(`entry ${entry} missing at ${directory}`);
  return entries;
}

function parseArguments(argv) {
  if (argv.length < 2) refuse(usage);
  const [task, commit, ...rest] = argv;
  const pairs = [];
  let dryRun = false;
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    if (flag === '--dry-run' && !dryRun) dryRun = true;
    else if (flag === '--env' && index + 1 < rest.length) {
      pairs.push(rest[index + 1]);
      index += 1;
    } else refuse(usage);
  }
  return { task, commit, dryRun, pairs };
}

function allowedEnvironment(task, pairs) {
  const chosen = {};
  for (const pair of pairs) {
    const split = pair.indexOf('=');
    const name = split > 0 ? pair.slice(0, split) : '';
    const value = pair.slice(split + 1);
    if (!Object.hasOwn(task.env, name))
      refuse(`env ${JSON.stringify(name)} is not allowed for this task`);
    if (Object.hasOwn(chosen, name)) refuse(`env ${name} given twice`);
    if (
      split < 0 ||
      value.length > maxEnvValueLength ||
      hasControlCharacter(value) ||
      !new RegExp(`^(?:${task.env[name]})$`).test(value)
    )
      refuse(`env ${name} value does not match its allowed pattern`);
    chosen[name] = value;
  }
  return chosen;
}

function gitRunner(layout, source) {
  const env = {
    PATH: layout.taskPath,
    HOME: layout.state,
    LANG: 'C',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_TERMINAL_PROMPT: '0',
  };
  const settings = ['-c', 'protocol.ext.allow=never', '-c', 'core.hooksPath=/dev/null'];
  if (source.proxy) settings.push('-c', `http.proxy=${source.proxy}`);
  return (args, options = {}) =>
    spawnSync(layout.git, [...settings, `--git-dir=${layout.mirror}`, ...args], {
      env,
      maxBuffer: 256 * 1024 * 1024,
      ...options,
    });
}

function listTree(git, commit, directory) {
  const listing = git(['ls-tree', '-r', '-z', '--full-tree', commit, '--', directory]);
  if (listing.status !== 0) refuse(`cannot list ${directory} at ${commit}`);
  return listing.stdout
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .map((line) => {
      const tab = line.indexOf('\t');
      const [mode, type, oid] = line.slice(0, tab).split(' ');
      return { mode, type, oid, path: line.slice(tab + 1) };
    });
}

function materialize(git, entries, workdir) {
  for (const item of entries) {
    const blob = git(['cat-file', 'blob', item.oid]);
    if (blob.status !== 0) refuse(`cannot read blob ${item.oid}`);
    const target = join(workdir, item.path);
    mkdirSync(dirname(target), { recursive: true, mode: 0o755 });
    const descriptor = openSync(
      target,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      item.mode === '100755' ? 0o755 : 0o644,
    );
    try {
      writeSync(descriptor, blob.stdout);
    } finally {
      closeSync(descriptor);
    }
  }
}

function execute(argv, layout, trusted, stdio) {
  const { task: name, commit, dryRun, pairs } = parseArguments(argv);
  for (const [label, path] of [
    ['runner', layout.runner],
    ['module', layout.module],
    ['config', layout.config],
    ['state', layout.state],
    ['mirror', layout.mirror],
    ['work', layout.work],
    ['git', layout.git],
    ['node', layout.node],
    ['flock', layout.flock],
    ['env', layout.env],
  ])
    if (path) assertTrusted(path, trusted, label);
  for (const directory of layout.taskPath.split(':'))
    if (existsSync(directory)) assertTrusted(directory, trusted, 'task PATH');
  let config;
  try {
    config = JSON.parse(readFileSync(layout.config, 'utf8'));
  } catch {
    refuse(`config ${layout.config} is not valid JSON`);
  }
  validateConfig(config);
  if (typeof name !== 'string' || !taskNamePattern.test(name))
    refuse(`invalid task ${JSON.stringify(name)}`);
  if (!Object.hasOwn(config.tasks, name)) refuse(`unknown task ${name}`);
  const task = config.tasks[name];
  if (!commitPattern.test(commit)) refuse('commit must be a full 40-character lowercase SHA');
  const chosenEnv = allowedEnvironment(task, pairs);
  assertTrusted(task.interpreter, trusted, `task ${name} interpreter`);

  const { branch } = config.source;
  const tracking = `refs/remotes/origin/${branch}`;
  const git = gitRunner(layout, config.source);
  const fetch = git([
    'fetch',
    '--quiet',
    '--no-tags',
    '--no-write-fetch-head',
    config.source.url,
    `+refs/heads/${branch}:${tracking}`,
  ]);
  if (fetch.status !== 0)
    refuse(
      `fetch of ${branch} failed: ${fetch.stderr?.toString('utf8').trim().split('\n').at(-1) ?? ''}`,
    );
  const type = git(['cat-file', '-t', commit]);
  if (type.status !== 0) refuse(`commit ${commit} is unknown`);
  if (type.stdout.toString('utf8').trim() !== 'commit') refuse(`${commit} is not a commit`);
  const ancestry = git(['merge-base', '--is-ancestor', commit, tracking]);
  if (ancestry.status === 1) refuse(`${commit} is not reachable from origin/${branch}`);
  if (ancestry.status !== 0) refuse(`cannot check ${commit} against origin/${branch}`);
  const entries = validateTree(listTree(git, commit, task.directory), task.directory, task.entry);

  const workdir = mkdtempSync(join(layout.work, 'run-'));
  try {
    materialize(git, entries, workdir);
    const result = spawnSync(
      task.interpreter,
      [join(workdir, task.directory, task.entry), ...task.args, ...(dryRun ? ['--dry-run'] : [])],
      {
        cwd: workdir,
        stdio,
        env: {
          PATH: layout.taskPath,
          HOME: layout.taskHome,
          LANG: 'C.UTF-8',
          CAIRN_OPS_TASK: name,
          CAIRN_OPS_COMMIT: commit,
          ...chosenEnv,
        },
      },
    );
    if (result.error) refuse(`cannot start ${task.interpreter}: ${result.error.message}`);
    if (result.signal) return 128 + (osConstants.signals[result.signal] ?? 0);
    return result.status;
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
}

function appendLog(path, record) {
  const descriptor = openSync(
    path,
    constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW,
    0o644,
  );
  try {
    writeSync(descriptor, `${JSON.stringify(record)}\n`);
  } finally {
    closeSync(descriptor);
  }
}

export function runTask(
  argv,
  layout,
  { stdio = 'inherit', report = (line) => process.stderr.write(`${line}\n`) } = {},
) {
  const trusted = new Set([0, layout.trustedUid]);
  try {
    assertTrusted(dirname(layout.log), trusted, 'log directory');
    if (existsSync(layout.log)) {
      if (!lstatSync(layout.log).isFile()) refuse(`log ${layout.log} is not a regular file`);
      assertTrusted(layout.log, trusted, 'log');
    }
  } catch (error) {
    report(`cairn-ops-run: refused: ${error.message}`);
    return 2;
  }
  const summary = { task: argv[0] ?? null, commit: argv[1] ?? null, argv };
  const startedAt = new Date().toISOString();
  appendLog(layout.log, { event: 'start', at: startedAt, ...summary });
  let exit = 2;
  let refused;
  try {
    exit = execute(argv, layout, trusted, stdio);
  } catch (error) {
    refused = error instanceof Refusal ? error.message : `internal error: ${error.message}`;
    report(`cairn-ops-run: refused: ${refused}`);
  } finally {
    appendLog(layout.log, {
      event: 'end',
      ...summary,
      startedAt,
      endedAt: new Date().toISOString(),
      exit,
      ...(refused ? { refused } : {}),
    });
  }
  return exit;
}

function shellQuote(value) {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export function wrapperScript(layout) {
  const command = [layout.flock, layout.lock, layout.env, '-i', layout.node, layout.module];
  return `#!/bin/sh\nexec ${command.map(shellQuote).join(' ')} "$@"\n`;
}

export function layoutFile(layout) {
  return `${JSON.stringify(validateLayout({ ...layout }), null, 2)}\n`;
}

export function main(argv = process.argv.slice(2)) {
  const layoutPath = join(dirname(fileURLToPath(import.meta.url)), 'layout.json');
  const trustedUid = process.geteuid();
  let layout;
  try {
    assertTrusted(layoutPath, new Set([0, trustedUid]), 'layout');
    layout = validateLayout(JSON.parse(readFileSync(layoutPath, 'utf8')));
  } catch (error) {
    process.stderr.write(`cairn-ops-run: refused: ${error.message}\n`);
    return 2;
  }
  return runTask(argv, { ...layout, trustedUid });
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = main();
