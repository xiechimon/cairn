import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { enrollThroughBrowser, pendingEnrollmentUrl } from '../src/machine-enroll.js';
import { statePaths } from '../src/state.js';

const SERVER = 'https://cairn.example';
const AUTHORIZE = 'http://127.0.0.1:8787/app/machines/authorize?enroll=e1';

type Poll =
  | { status: 'pending' }
  | { status: 'authorized'; machine: never }
  | { status: 'expired' };

function world() {
  const home = makeTestTempDir('cairn-enroll-');
  const paths = statePaths(home);
  return { home, paths };
}

const TOKEN = 'a'.repeat(64);

function machine(token = TOKEN) {
  return {
    machineId: `machine-${token}`,
    token,
    teamId: 'team-1',
    serverUrl: SERVER,
  };
}

function clientOf(polls: (enrollId: string) => Poll, starts: string[] = []) {
  return {
    enrollStart: async (body: { name?: string }) => {
      starts.push(body.name ?? '');
      return { enrollId: 'e1', url: AUTHORIZE };
    },
    enrollPoll: async (enrollId: string) => polls(enrollId),
  };
}

test('browser enrollment writes machine.json with mode 0600 and points at the server origin', async () => {
  const { home, paths } = world();
  let calls = 0;
  const logs: string[] = [];
  const result = await enrollThroughBrowser(
    clientOf(() => {
      calls += 1;
      return calls < 3
        ? { status: 'pending' }
        : { status: 'authorized', machine: machine() as never };
    }),
    paths,
    SERVER,
    'omarchy',
    { now: () => 1_000, sleep: async () => {}, log: (line) => logs.push(line) },
  );
  expect(result.token).toBe(TOKEN);
  const saved = JSON.parse(readFileSync(paths.machineJson, 'utf8'));
  expect(saved).toEqual(machine());
  expect(statSync(paths.machineJson).mode & 0o777).toBe(0o600);
  expect(existsSync(join(home, 'enroll.json'))).toBe(false);
  expect(logs.join('\n')).toContain(`${SERVER}/app/machines/authorize?enroll=e1`);
  expect(logs.join('\n')).not.toContain('127.0.0.1');
  releaseTestTempDir(home);
});

test('a client without the enrollment methods reports a named error', async () => {
  const { home, paths } = world();
  await expect(
    enrollThroughBrowser({ me: async () => null }, paths, SERVER, 'omarchy', {
      now: () => 1_000,
      sleep: async () => {},
      log: () => {},
    }),
  ).rejects.toThrow(/cannot start a browser enrollment/);
  expect(existsSync(paths.machineJson)).toBe(false);
  releaseTestTempDir(home);
});

test('an expired enrollment reports a named error and leaves no machine.json', async () => {
  const { home, paths } = world();
  await expect(
    enrollThroughBrowser(
      clientOf(() => ({ status: 'expired' })),
      paths,
      SERVER,
      'omarchy',
      {
        now: () => 1_000,
        sleep: async () => {},
        log: () => {},
      },
    ),
  ).rejects.toThrow(/enrollment expired/);
  expect(existsSync(paths.machineJson)).toBe(false);
  expect(existsSync(join(home, 'enroll.json'))).toBe(false);
  releaseTestTempDir(home);
});

test('a restart reuses the pending enrollment instead of starting a second one', async () => {
  const { home, paths } = world();
  mkdirSync(home, { recursive: true });
  writeFileSync(
    join(home, 'enroll.json'),
    JSON.stringify({ enrollId: 'e-pending', url: AUTHORIZE, expiresAt: 900_000 }),
  );
  const starts: string[] = [];
  let polled: string | null = null;
  await enrollThroughBrowser(
    clientOf((enrollId) => {
      polled = enrollId;
      return { status: 'authorized', machine: machine() as never };
    }, starts),
    paths,
    SERVER,
    'omarchy',
    { now: () => 1_000, sleep: async () => {}, log: () => {} },
  );
  expect(starts).toEqual([]);
  expect(polled).toBe('e-pending');
  releaseTestTempDir(home);
});

test('a pending enrollment for another server is discarded and restarted', async () => {
  const { home, paths } = world();
  mkdirSync(home, { recursive: true });
  writeFileSync(
    join(home, 'enroll.json'),
    JSON.stringify({
      enrollId: 'e-old',
      url: AUTHORIZE,
      expiresAt: 900_000,
      serverUrl: 'https://old.example',
    }),
  );
  const starts: string[] = [];
  let polled: string | null = null;
  await enrollThroughBrowser(
    clientOf((enrollId) => {
      polled = enrollId;
      return { status: 'authorized', machine: machine() as never };
    }, starts),
    paths,
    SERVER,
    'omarchy',
    { now: () => 1_000, sleep: async () => {}, log: () => {} },
  );
  expect(starts).toEqual(['omarchy']);
  expect(polled).toBe('e1');
  releaseTestTempDir(home);
});

test('the approval URL is readable from the pending record while the supervisor runs', async () => {
  const { home, paths } = world();
  mkdirSync(home, { recursive: true });
  writeFileSync(
    join(home, 'enroll.json'),
    JSON.stringify({
      enrollId: 'e1',
      url: `${SERVER}/app/machines/authorize?enroll=e1`,
      expiresAt: 900_000,
    }),
  );
  expect(
    await pendingEnrollmentUrl(
      paths,
      1_000,
      async () => {},
      () => 1_000,
    ),
  ).toBe(`${SERVER}/app/machines/authorize?enroll=e1`);
  releaseTestTempDir(home);
});

test('the approval URL is null when no enrollment appears inside the window', async () => {
  const { home, paths } = world();
  let now = 0;
  expect(
    await pendingEnrollmentUrl(
      paths,
      500,
      async () => {
        now += 200;
      },
      () => now,
    ),
  ).toBeNull();
  expect(now).toBeGreaterThanOrEqual(500);
  releaseTestTempDir(home);
});

test('a stop signal ends the wait without writing credentials', async () => {
  const { home, paths } = world();
  const controller = new AbortController();
  controller.abort();
  await expect(
    enrollThroughBrowser(
      clientOf(() => ({ status: 'pending' })),
      paths,
      SERVER,
      'omarchy',
      {
        now: () => 1_000,
        sleep: async () => {},
        log: () => {},
        stop: controller.signal,
      },
    ),
  ).rejects.toThrow(/stopped/);
  expect(existsSync(paths.machineJson)).toBe(false);
  releaseTestTempDir(home);
});

test('an approval never overwrites a machine.json that appeared meanwhile', async () => {
  const { home, paths } = world();
  mkdirSync(home, { recursive: true });
  writeFileSync(paths.machineJson, '{"machineId":"other"}\n', { mode: 0o600 });
  await expect(
    enrollThroughBrowser(
      clientOf(() => ({ status: 'authorized', machine: machine() as never })),
      paths,
      SERVER,
      'omarchy',
      { now: () => 1_000, sleep: async () => {}, log: () => {} },
    ),
  ).rejects.toThrow(/refusing to overwrite/);
  expect(JSON.parse(readFileSync(paths.machineJson, 'utf8'))).toEqual({ machineId: 'other' });
  releaseTestTempDir(home);
});
