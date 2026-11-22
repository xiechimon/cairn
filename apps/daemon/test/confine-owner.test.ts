import { mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { beforeEach, expect, test, vi } from 'vitest';
import {
  ConfinementExitedError,
  ConfinementOwnerError,
  launchConfined,
  reconcileConfinement,
} from '../src/backend/confine.js';
import { testTempDir } from './test-temp-dir.js';

const state = vi.hoisted(() => ({
  selfGroup: '',
  controlGroup: '',
  invocationId: '',
  procs: '',
  execCalls: [] as string[][],
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  const execFile = Object.assign(vi.fn(), {
    [promisify.custom]: (_file: string, args: string[]) => {
      state.execCalls.push(args);
      const reply = (stdout: string) => Promise.resolve({ stdout, stderr: '' });
      if (args[1] === 'show' && args.includes('-.slice'))
        return reply('/user.slice/user-1000.slice/user@1000.service\n');
      if (args[1] === 'show')
        return reply(
          `ActiveState=active\nInvocationID=${state.invocationId}\nControlGroup=${state.controlGroup}\n`,
        );
      return reply('');
    },
  }) as unknown as typeof actual.execFile;
  const spawn = vi.fn(() => actual.spawn('sh', ['-c', 'exit 1']));
  return { ...actual, execFile, spawn };
});

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const readFileSync = vi.fn((path: unknown, ...rest: unknown[]) => {
    if (path === '/proc/self/cgroup') return `${state.selfGroup}\n`;
    if (path === `/sys/fs/cgroup${state.controlGroup}/cgroup.procs`) return state.procs;
    if (typeof path === 'string' && path.endsWith('/cgroup.events'))
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    return (actual.readFileSync as (...args: never[]) => unknown)(
      path as never,
      ...(rest as never[]),
    );
  });
  return { ...actual, readFileSync };
});

const SCOPE_UNIT = 'cairn-owned-probe-1.scope';
const SCOPE_GROUP = `/user.slice/user-1000.slice/user@1000.service/app.slice/${SCOPE_UNIT}`;
const SERVICE_UNIT = 'cairn-daemon.service';
const SERVICE_GROUP = `/user.slice/user-1000.slice/user@1000.service/${SERVICE_UNIT}`;

function policy() {
  const root = realpathSync(testTempDir('confine-owner-'));
  for (const dir of ['home', 'home/.cairn', 'work', 'temp'])
    mkdirSync(join(root, dir), { recursive: true });
  return {
    home: join(root, 'home'),
    daemonHome: join(root, 'home/.cairn'),
    workspace: join(root, 'work'),
    taskTemp: join(root, 'temp'),
    gitDirectories: [],
    state: [],
    caches: [],
  };
}

function launch(owner: string) {
  return launchConfined({
    policy: policy(),
    owner,
    command: [process.execPath, '-e', 'process.exit(0)'],
    environment: {},
  });
}

beforeEach(() => {
  state.selfGroup = `0::${SCOPE_GROUP}`;
  state.controlGroup = SCOPE_GROUP;
  state.invocationId = 'inv-scope-1';
  state.procs = `1\n${process.pid}\n`;
  state.execCalls.length = 0;
  delete process.env.INVOCATION_ID;
});

test('accepts the owned-process scope this daemon actually runs in', async () => {
  const error = await launch(SCOPE_UNIT).catch((caught: unknown) => caught);
  expect(error).not.toBeInstanceOf(ConfinementOwnerError);
  expect(state.execCalls).toContainEqual(expect.arrayContaining(['show', SCOPE_UNIT]));
});

test('still refuses a scope that does not contain this daemon', async () => {
  state.procs = '1\n424242\n';
  await expect(launch(SCOPE_UNIT)).rejects.toBeInstanceOf(ConfinementOwnerError);
});

test('still refuses a scope when the environment names another invocation', async () => {
  process.env.INVOCATION_ID = 'inv-stale';
  await expect(launch(SCOPE_UNIT)).rejects.toBeInstanceOf(ConfinementOwnerError);
});

test('still refuses a foreign service owner', async () => {
  await expect(launch('other.service')).rejects.toBeInstanceOf(ConfinementOwnerError);
});

test('still refuses an owner that is not a unit', async () => {
  await expect(launch('not-a-unit')).rejects.toBeInstanceOf(ConfinementOwnerError);
});

test('still accepts the daemon service unit of this invocation', async () => {
  state.controlGroup = SERVICE_GROUP;
  state.selfGroup = `0::${SERVICE_GROUP}`;
  state.invocationId = 'inv-service-1';
  process.env.INVOCATION_ID = 'inv-service-1';
  const error = await launch(SERVICE_UNIT).catch((caught: unknown) => caught);
  expect(error).not.toBeInstanceOf(ConfinementOwnerError);
});

test.runIf(process.platform === 'linux')(
  'collects the confine unit after a failed launch instead of leaving it failed',
  async () => {
    state.controlGroup = SERVICE_GROUP;
    state.selfGroup = `0::${SERVICE_GROUP}`;
    state.invocationId = 'inv-service-1';
    process.env.INVOCATION_ID = 'inv-service-1';
    await expect(launch(SERVICE_UNIT)).rejects.toBeInstanceOf(ConfinementExitedError);
    const stopped = state.execCalls.find((args) => args[1] === 'stop')?.[2];
    expect(stopped).toMatch(/^cairn-confine-.*\.service$/);
    expect(state.execCalls).toContainEqual(['--user', 'reset-failed', stopped]);
  },
);

test('reconciliation collects a leftover failed unit', async () => {
  const unit = 'cairn-confine-deadbeef-0000-0000-0000-000000000000.service';
  await reconcileConfinement({
    unit,
    eventsPath: `/sys/fs/cgroup/user.slice/user-1000.slice/user@1000.service/app.slice/${unit}/cgroup.events`,
  });
  expect(state.execCalls).toContainEqual(['--user', 'stop', unit]);
  expect(state.execCalls).toContainEqual(['--user', 'reset-failed', unit]);
});
