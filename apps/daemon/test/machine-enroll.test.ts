import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import {
  ENROLLMENT_PRINT_WAIT_MS,
  enrollThroughBrowser,
  pendingEnrollmentUrl,
  waitForPendingEnrollment,
} from '../src/machine-enroll.js';
import { statePaths } from '../src/state.js';

const SERVER = 'https://cairn.example';
const AUTHORIZE = 'https://cairn.example/app/machines/authorize?enroll=e1';

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
      return { enrollId: 'e1', url: AUTHORIZE, pollSecret: 'sec-default' };
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
  expect(logs.join('\n')).toContain(
    `${AUTHORIZE} and approve this machine (machine name: omarchy)`,
  );
  releaseTestTempDir(home);
});

test('the approval code from the server is printed, again when a later start resumes', async () => {
  const { home, paths } = world();
  const client = {
    enrollStart: async () => ({
      enrollId: 'e1',
      url: AUTHORIZE,
      code: 'K7F3-Q9XM',
      pollSecret: 'sec-code',
    }),
    enrollPoll: async (): Promise<Poll> => ({ status: 'pending' }),
  };
  const first: string[] = [];
  const stop = new AbortController();
  await expect(
    enrollThroughBrowser(client, paths, SERVER, 'omarchy', {
      now: () => 1_000,
      sleep: async () => stop.abort(),
      log: (line) => first.push(line),
      stop: stop.signal,
    }),
  ).rejects.toThrow(/stopped before approval/);
  expect(first.join('\n')).toContain('approval code K7F3-Q9XM');
  const resumed: string[] = [];
  const again = new AbortController();
  again.abort();
  await expect(
    enrollThroughBrowser(client, paths, SERVER, 'omarchy', {
      now: () => 2_000,
      sleep: async () => {},
      log: (line) => resumed.push(line),
      stop: again.signal,
    }),
  ).rejects.toThrow(/stopped before approval/);
  expect(resumed.join('\n')).toContain('approval code K7F3-Q9XM');
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
    JSON.stringify({
      enrollId: 'e-pending',
      url: AUTHORIZE,
      pollSecret: 'sec-pending',
      expiresAt: 900_000,
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
  expect(starts).toEqual([]);
  expect(polled).toBe('e-pending');
  releaseTestTempDir(home);
});

test('a legacy pending enrollment without pollSecret is discarded and restarted', async () => {
  const { home, paths } = world();
  mkdirSync(home, { recursive: true });
  writeFileSync(
    join(home, 'enroll.json'),
    JSON.stringify({ enrollId: 'e-legacy', url: AUTHORIZE, expiresAt: 900_000 }),
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

test('a pending enrollment started under another machine name is discarded and restarted', async () => {
  const { home, paths } = world();
  mkdirSync(home, { recursive: true });
  writeFileSync(
    join(home, 'enroll.json'),
    JSON.stringify({
      enrollId: 'e-old',
      url: AUTHORIZE,
      expiresAt: 900_000,
      serverUrl: SERVER,
      name: 'old-name',
    }),
  );
  let now = 0;
  expect(
    await pendingEnrollmentUrl(
      paths,
      SERVER,
      500,
      async () => {
        now += 200;
      },
      () => now,
      'omarchy',
    ),
  ).toBeNull();
  const starts: string[] = [];
  await enrollThroughBrowser(
    clientOf(() => ({ status: 'authorized', machine: machine() as never }), starts),
    paths,
    SERVER,
    'omarchy',
    { now: () => 1_000, sleep: async () => {}, log: () => {} },
  );
  expect(starts).toEqual(['omarchy']);
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
      SERVER,
      1_000,
      async () => {},
      () => 1_000,
    ),
  ).toBe(`${SERVER}/app/machines/authorize?enroll=e1`);
  releaseTestTempDir(home);
});

test('the approval URL stays hidden while the pending record belongs to another server', async () => {
  const { home, paths } = world();
  mkdirSync(home, { recursive: true });
  writeFileSync(
    join(home, 'enroll.json'),
    JSON.stringify({
      enrollId: 'e-old',
      url: 'https://old.example/app/machines/authorize?enroll=e-old',
      expiresAt: 900_000,
      serverUrl: 'https://old.example',
    }),
  );
  let now = 0;
  expect(
    await pendingEnrollmentUrl(
      paths,
      SERVER,
      500,
      async () => {
        now += 200;
      },
      () => now,
    ),
  ).toBeNull();
  releaseTestTempDir(home);
});

test('the approval URL is null when no enrollment appears inside the window', async () => {
  const { home, paths } = world();
  let now = 0;
  expect(
    await pendingEnrollmentUrl(
      paths,
      SERVER,
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

test('browser enrollment forwards legacyHostKeys distinct from hostKey', async () => {
  const { home, paths } = world();
  const bodies: unknown[] = [];
  const client = {
    enrollStart: async (body: { name?: string; hostKey?: string; legacyHostKeys?: string[] }) => {
      bodies.push(body);
      return { enrollId: 'e1', url: AUTHORIZE };
    },
    enrollPoll: async (): Promise<Poll> => ({ status: 'authorized', machine: machine() as never }),
  };
  const keyV2 = 'a'.repeat(64);
  const keyV1 = 'b'.repeat(64);
  await enrollThroughBrowser(
    client,
    paths,
    SERVER,
    'omarchy',
    { now: () => 1_000, sleep: async () => {}, log: () => {} },
    keyV2,
    [keyV2, keyV1],
  );
  expect(bodies).toEqual([{ name: 'omarchy', hostKey: keyV2, legacyHostKeys: [keyV1] }]);
  releaseTestTempDir(home);
});

test('browser enrollment stores pollSecret privately, sends it on poll, and fails cleanly when credentials were already claimed', async () => {
  const { home, paths } = world();
  const pollArgs: Array<[string, string | undefined]> = [];
  const client = {
    enrollStart: async () => ({
      enrollId: 'e-sec',
      url: AUTHORIZE,
      code: 'ABCD-2345',
      pollSecret: 'secret-token-xyz',
    }),
    enrollPoll: async (enrollId: string, pollSecret?: string) => {
      pollArgs.push([enrollId, pollSecret]);
      if (pollArgs.length === 1) {
        const stored = JSON.parse(readFileSync(join(home, 'enroll.json'), 'utf8')) as {
          pollSecret?: string;
        };
        expect(stored.pollSecret).toBe('secret-token-xyz');
        expect(statSync(join(home, 'enroll.json')).mode & 0o777).toBe(0o600);
        return { status: 'pending' as const };
      }
      return { status: 'authorized' as const, machine: machine() };
    },
  };
  await enrollThroughBrowser(client, paths, SERVER, 'omarchy', {
    now: () => 1_000,
    sleep: async () => {},
    log: () => {},
  });
  expect(pollArgs).toEqual([
    ['e-sec', 'secret-token-xyz'],
    ['e-sec', 'secret-token-xyz'],
  ]);
  releaseTestTempDir(home);

  const second = world();
  await expect(
    enrollThroughBrowser(
      {
        enrollStart: async () => ({ enrollId: 'e-burned', url: AUTHORIZE, pollSecret: 'sec' }),
        enrollPoll: async () => ({ status: 'authorized' as const }),
      },
      second.paths,
      SERVER,
      'omarchy',
      { now: () => 1_000, sleep: async () => {}, log: () => {} },
    ),
  ).rejects.toThrow(/already claimed/);
  expect(existsSync(join(second.home, 'enroll.json'))).toBe(false);
  releaseTestTempDir(second.home);
});

test('enrollStart failure writes enroll-error.json and waitForPendingEnrollment surfaces it immediately', async () => {
  expect(ENROLLMENT_PRINT_WAIT_MS).toBeGreaterThanOrEqual(15_000);
  const { home, paths } = world();
  await expect(
    enrollThroughBrowser(
      {
        enrollStart: async () => {
          throw new Error('\x1b[31mfetch failed: ECONNREFUSED\x1b]52;c;ZWF2aWw=\x07\x1b[0m');
        },
        enrollPoll: async () => ({ status: 'pending' as const }),
      },
      paths,
      SERVER,
      'omarchy',
      { now: () => 5_000, sleep: async () => {}, log: () => {} },
    ),
  ).rejects.toThrow(/ECONNREFUSED/);

  const outcome = await waitForPendingEnrollment(
    paths,
    SERVER,
    ENROLLMENT_PRINT_WAIT_MS,
    async () => {},
    () => 5_100,
    'omarchy',
    4_500,
  );
  expect(outcome).toEqual({ kind: 'error', message: 'fetch failed: ECONNREFUSED' });
  releaseTestTempDir(home);
});
