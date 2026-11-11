import { type ChildProcessWithoutNullStreams, execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { setTimeout as waitTimeout } from 'node:timers/promises';
import { promisify } from 'node:util';

export interface ConfinementPolicy {
  home: string;
  daemonHome: string;
  workspace: string;
  gitDirectories: string[];
  taskTemp: string;
  state: string[];
  caches: string[];
}

const DENIED_DIRECTORIES = [
  '.ssh',
  '.gnupg',
  '.aws',
  '.config/gh',
  '.docker',
  '.kube',
  '.password-store',
  '.config/google-chrome',
  '.config/chromium',
  '.claude',
  '.codex',
  '.pi',
  '.gemini',
];
const DENIED_FILES = ['.netrc', '.git-credentials', '.claude.json'];

function contains(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

function canonical(path: string, required = false): string {
  if (!isAbsolute(path) || resolve(path) !== path) throw new Error('Unsafe confinement path');
  let cursor = path;
  const missing: string[] = [];
  while (true) {
    try {
      if (lstatSync(cursor).isSymbolicLink()) throw new Error('Unsafe confinement symlink');
      break;
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT') || required)
        throw error;
      missing.unshift(relative(dirname(cursor), cursor));
      cursor = dirname(cursor);
    }
  }
  if (realpathSync(cursor) !== cursor) throw new Error('Unsafe confinement symlink');
  return join(cursor, ...missing);
}

export function confinementArgs(
  policy: ConfinementPolicy,
  platform: string = process.platform,
): string[] {
  if (platform !== 'linux') throw new Error('Harness confinement requires Linux');
  const home = canonical(policy.home, true);
  const daemonHome = canonical(policy.daemonHome, true);
  const deniedDirectories = [
    '/run',
    ...DENIED_DIRECTORIES.map((path) => join(home, path)),
    daemonHome,
  ];
  const deniedFiles = DENIED_FILES.map((path) => join(home, path));
  const denied = [...deniedDirectories, ...deniedFiles].map((path) => canonical(path));
  const writable = [
    policy.workspace,
    ...policy.gitDirectories,
    policy.taskTemp,
    ...policy.state,
    ...policy.caches,
  ].map((path) => canonical(path, true));
  for (const path of writable) {
    if (
      denied.some(
        (secret) =>
          contains(path, secret) &&
          !(path === secret && secret !== daemonHome && policy.state.includes(path)),
      )
    )
      throw new Error('Unsafe confinement overlap');
    if (
      denied.some((secret) => contains(secret, path)) &&
      !contains(daemonHome, path) &&
      !policy.state.includes(path)
    )
      throw new Error('Unsafe confinement overlap');
  }
  for (const path of policy.caches) {
    if (denied.some((secret) => contains(secret, path) || contains(path, secret)))
      throw new Error('Unsafe confinement cache overlap');
  }
  for (const path of policy.state) {
    if (
      denied.some((secret) => contains(secret, path)) &&
      !contains(daemonHome, path) &&
      !['.claude', '.codex', '.pi', '.gemini', '.claude.json'].some((name) =>
        contains(join(home, name), path),
      )
    )
      throw new Error('Unsafe confinement state overlap');
  }
  const args = [
    '--die-with-parent',
    '--new-session',
    '--unshare-pid',
    '--ro-bind',
    '/',
    '/',
    '--dev-bind',
    '/dev',
    '/dev',
    '--proc',
    '/proc',
    '--tmpfs',
    '/tmp',
  ];
  args.push('--overlay-src', home, '--tmp-overlay', home);
  for (const path of deniedDirectories) args.push('--tmpfs', path);
  for (const path of writable) args.push('--bind', path, path);
  for (const path of deniedDirectories) {
    if (!policy.state.includes(path)) args.push('--remount-ro', path);
  }
  for (const path of deniedFiles.filter((path) => !policy.state.includes(path))) {
    args.push('--ro-bind', '/dev/null', path);
  }
  for (const directory of policy.gitDirectories) {
    for (const name of ['config', 'config.worktree', 'hooks']) {
      const path = canonical(join(directory, name));
      if (name === 'hooks' && !existsSync(path)) args.push('--tmpfs', path, '--remount-ro', path);
      else args.push('--ro-bind', existsSync(path) ? path : '/dev/null', path);
    }
  }
  args.push('--remount-ro', home);
  args.push('--chdir', policy.workspace);
  return args;
}

export function assertConfinementCleanup(
  terminal: boolean,
  readEvents: () => string,
  source: 'path' | 'fd' = 'fd',
): void {
  if (!terminal) throw new Error('Confinement manager is not terminal');
  try {
    if (!/^populated 0$/m.test(readEvents())) throw new Error('Confinement cgroup is not empty');
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? error.code : undefined;
    if (code !== (source === 'path' ? 'ENOENT' : 'ENODEV')) throw error;
  }
}

export const confinementGate = `
const { readSync, writeSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
try {
  writeSync(1, 'ready:' + process.argv[1] + '\\n');
  const buffer = Buffer.alloc(65537);
  let length = 0;
  while (length < buffer.length && readSync(0, buffer, length, 1, null) === 1) {
    if (buffer[length++] === 10) break;
  }
  if (length > 65536 || buffer[length - 1] !== 10) process.exit(125);
  const frame = JSON.parse(buffer.toString('utf8', 0, length));
  if (Object.keys(frame).length !== 2 || frame.nonce !== process.argv[1] || !frame.environment || Array.isArray(frame.environment) || typeof frame.environment !== 'object') process.exit(125);
  for (const [key, value] of Object.entries(frame.environment)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || typeof value !== 'string' || value.includes('\\0')) process.exit(125);
  }
  process.exit(spawnSync(process.argv[2], process.argv.slice(3), { stdio: 'inherit', env: frame.environment }).status ?? 125);
} catch { process.exit(125); }
`;

const exec = promisify(execFile);
const ownerProperties = ['-p', 'ActiveState', '-p', 'InvocationID', '-p', 'ControlGroup'];

export async function launchConfined(options: {
  policy: ConfinementPolicy;
  owner: string;
  command: string[];
  environment: Record<string, string>;
  signal?: AbortSignal;
  timeoutMs?: number;
  released?: () => void;
  reserve?: (reservation: { unit: string; eventsPath: string }) => void;
}): Promise<{
  unit: string;
  process: ChildProcessWithoutNullStreams;
  completed: Promise<void>;
  stop: () => Promise<void>;
}> {
  if (!/^[a-zA-Z0-9_-]+\.service$/.test(options.owner))
    throw new Error('Invalid confinement owner');
  const timeout = options.timeoutMs ?? 10000;
  const control = async (...args: string[]) =>
    (await exec('systemctl', ['--user', ...args], { timeout })).stdout;
  const owner = await control('show', options.owner, ...ownerProperties);
  const fields = Object.fromEntries(
    owner
      .trim()
      .split('\n')
      .map((line) => line.split('=')),
  );
  const selfGroup = readFileSync('/proc/self/cgroup', 'utf8').trim();
  if (
    fields.ActiveState !== 'active' ||
    !fields.InvocationID ||
    fields.InvocationID !== process.env.INVOCATION_ID ||
    !fields.ControlGroup ||
    !selfGroup.endsWith(`:${fields.ControlGroup}`)
  )
    throw new Error('Confinement owner is not this daemon invocation');
  options.signal?.throwIfAborted();
  const unit = `cairn-confine-${randomUUID()}.service`;
  const nonce = `${fields.InvocationID}:${randomUUID()}`;
  const mounts = [...confinementArgs(options.policy), '--clearenv'];
  const frame = `${JSON.stringify({ nonce, environment: options.environment })}\n`;
  if (Buffer.byteLength(frame) > 65536) throw new Error('Confinement environment is too large');
  const managerGroup = (
    await control('show', '-p', 'ControlGroup', '--value', '--', '-.slice')
  ).trim();
  if (!managerGroup.startsWith('/user.slice/') || managerGroup.includes('..'))
    throw new Error('Invalid manager cgroup');
  const group = `${managerGroup}/app.slice/${unit}`;
  const eventsPath = `/sys/fs/cgroup${group}/cgroup.events`;
  if (!options.command.length) throw new Error('Missing confined command');
  options.reserve?.({ unit, eventsPath });
  const child = spawn(
    'systemd-run',
    [
      '--user',
      '--pipe',
      '--wait',
      '--quiet',
      `--unit=${unit}`,
      '--service-type=exec',
      '--expand-environment=no',
      `--property=BindsTo=${options.owner}`,
      `--property=After=${options.owner}`,
      '--property=Restart=no',
      '--property=KillMode=control-group',
      '--property=SendSIGKILL=yes',
      '--property=TimeoutStopSec=5s',
      '--property=ExitType=cgroup',
      '--property=Slice=app.slice',
      '--property=Delegate=no',
      '--property=ProtectControlGroups=yes',
      'bwrap',
      ...mounts,
      '--',
      process.execPath,
      '-e',
      confinementGate,
      nonce,
      ...options.command,
    ],
    { stdio: 'pipe' },
  );
  const exited = new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  void exited.catch(() => {});
  child.stdin.on('error', () => {});
  let cleaning: Promise<void> | undefined;
  let naturalTerminal = false;
  const stop = () => {
    cleaning ??= (async () => {
      if (!naturalTerminal) {
        try {
          await control('stop', unit);
        } catch (error) {
          if (
            !(error instanceof Error && 'code' in error && error.code === 5) ||
            (await Promise.race([exited, waitTimeout(timeout, undefined, { ref: false })])) !== 0
          )
            throw error;
        }
      }
      assertConfinementCleanup(true, () => readFileSync(eventsPath, 'utf8'), 'path');
      options.released?.();
    })();
    return cleaning;
  };
  let acknowledged = false;
  const abort = () => {
    child.stdin.end();
    if (acknowledged) void stop().catch(() => {});
  };
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) abort();
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error('Confinement startup timeout')), timeout);
      let received = '';
      const data = (chunk: Buffer) => {
        received += chunk.toString('utf8');
        if (received === `ready:${nonce}\n`) finish();
        else if (received.includes('\n') || received.length > 256)
          finish(new Error('Invalid confinement readiness'));
      };
      const finish = (error?: Error) => {
        clearTimeout(timer);
        child.stdout.off('data', data);
        child.stdout.pause();
        if (error) reject(error);
        else resolve();
      };
      child.stdout.on('data', data);
      void exited.then(
        () => finish(new Error('Confinement exited before readiness')),
        (error: Error) => finish(error),
      );
    });
    if ((await control('show', unit, '-p', 'ControlGroup', '--value')).trim() !== group)
      throw new Error('Unexpected confinement cgroup');
    readFileSync(eventsPath, 'utf8');
    options.signal?.throwIfAborted();
    const current = await control('show', options.owner, ...ownerProperties);
    if (current !== owner) throw new Error('Confinement owner changed before acknowledgement');
    options.signal?.throwIfAborted();
    acknowledged = true;
    child.stdin.write(frame);
    const completed = exited
      .then(async (code) => {
        naturalTerminal = code === 0;
        await stop();
      })
      .finally(() => options.signal?.removeEventListener('abort', abort));
    void completed.catch(() => {});
    return { unit, process: child, completed, stop };
  } catch (error) {
    child.stdin.end();
    options.signal?.removeEventListener('abort', abort);
    await stop();
    options.signal?.throwIfAborted();
    throw error;
  }
}

export async function reconcileConfinement(reservation: {
  unit: string;
  eventsPath: string;
}): Promise<void> {
  if (
    !/^cairn-confine-[0-9a-f-]+\.service$/.test(reservation.unit) ||
    !reservation.eventsPath.endsWith(`/app.slice/${reservation.unit}/cgroup.events`) ||
    !reservation.eventsPath.startsWith('/sys/fs/cgroup/user.slice/') ||
    reservation.eventsPath.includes('..')
  )
    throw new Error('Invalid confinement reservation');
  await exec('systemctl', ['--user', 'stop', reservation.unit], { timeout: 10000 });
  assertConfinementCleanup(true, () => readFileSync(reservation.eventsPath, 'utf8'), 'path');
}
