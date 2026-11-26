import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { writeAntigravityOAuthCredential } from '../src/agent-config.js';
import {
  parseAntigravityUsageOutput,
  probeAntigravityUsage,
} from '../src/backend/antigravity-usage.js';

const fixtures: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of fixtures.splice(0)) releaseTestTempDir(dir);
});

const SAMPLE_USAGE_JSON = JSON.stringify({
  conversation_id: '',
  status: 'SUCCESS',
  response: 'ok',
  duration_seconds: 0,
  num_turns: 0,
  usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
  command: {
    name: 'usage',
    data: {
      groups: [
        {
          name: 'Gemini Models',
          buckets: [
            {
              id: 'gemini-weekly',
              name: 'Weekly Limit Remaining',
              window: 'weekly',
              remaining_fraction: 0.95,
              reset_time: '2026-12-03T07:04:25Z',
            },
            {
              id: 'gemini-5h',
              name: 'Five Hour Limit Remaining',
              window: '5h',
              remaining_fraction: 0.94,
              reset_time: '2026-11-26T17:04:25Z',
            },
          ],
        },
        {
          name: 'Claude and GPT models',
          buckets: [
            {
              id: '3p-weekly',
              name: 'Weekly Limit Remaining',
              window: 'weekly',
              remaining_fraction: 1.2,
              reset_time: '1970-01-01T00:00:00Z',
            },
            {
              id: '3p-5h',
              name: 'Five Hour Limit Remaining',
              window: '5h',
              remaining_fraction: -0.1,
              reset_time: '1970-01-01T00:00:00Z',
            },
          ],
        },
      ],
    },
  },
});

type FakeAgyMode = 'ok' | 'auth' | 'hang' | 'bad-json' | 'bad-grant' | 'long-output';

function createFakeAgyBinary(mode: FakeAgyMode): {
  binPath: string;
  marker: string;
  dir: string;
} {
  const dir = makeTestTempDir('agy-usage-test-');
  fixtures.push(dir);
  const jsPath = join(dir, 'fake-agy.mjs');
  const binPath = join(dir, 'fake-agy.sh');
  const marker = join(dir, 'probe-meta.json');
  writeFileSync(
    jsPath,
    `import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
if (args.join(' ') !== '--output-format json -p /usage') {
  console.error('Unexpected args: ' + args.join(' '));
  process.exit(2);
}
const home = process.env.HOME;
const geminiHome = process.env.GEMINI_HOME;
const geminiCliHome = process.env.GEMINI_CLI_HOME;
writeFileSync(
  ${JSON.stringify(marker)},
  JSON.stringify({
    home,
    geminiHome,
    geminiCliHome,
    forceFile: process.env.AGY_CLI_FORCE_FILE_TOKEN_STORAGE,
    hasApiKey: process.env.GEMINI_API_KEY !== undefined || process.env.GOOGLE_API_KEY !== undefined,
    hasCliToken: existsSync(join(home, '.gemini/antigravity-cli/antigravity-oauth-token')),
    hasAcpToken: existsSync(join(home, '.gemini/antigravity-acp/antigravity-oauth-token')),
    cliToken: existsSync(join(home, '.gemini/antigravity-cli/antigravity-oauth-token'))
      ? JSON.parse(readFileSync(join(home, '.gemini/antigravity-cli/antigravity-oauth-token'), 'utf8'))
      : null,
  }),
);
if (${JSON.stringify(mode)} === 'ok') {
  process.stdout.write(${JSON.stringify(SAMPLE_USAGE_JSON)} + '\\n');
} else if (${JSON.stringify(mode)} === 'auth') {
  process.stderr.write('401 Unauthorized: invalid refresh_token 1//secret-refresh-token\\n');
  process.exit(1);
} else if (${JSON.stringify(mode)} === 'bad-grant') {
  process.stderr.write('invalid request, invalid_grant\\n');
  process.exitCode = 1;
} else if (${JSON.stringify(mode)} === 'long-output') {
  process.stdout.write('invalid'.repeat(80_000));
  process.exitCode = 1;
} else if (${JSON.stringify(mode)} === 'bad-json') {
  process.stdout.write('not-json');
  process.exit(0);
} else {
  setInterval(() => {}, 1_000);
}
`,
  );
  const shQuote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;
  writeFileSync(binPath, `#!/bin/sh\nexec ${shQuote(process.execPath)} ${shQuote(jsPath)} "$@"\n`);
  chmodSync(binPath, 0o755);
  return { binPath, marker, dir };
}

test('parseAntigravityUsageOutput maps buckets, clamps utilization, and clears epoch-0 resets', () => {
  const observedAt = 1_795_700_000_000;
  const windows = parseAntigravityUsageOutput(`log line\n${SAMPLE_USAGE_JSON}\n`, observedAt);
  expect(windows).toHaveLength(4);
  expect(windows[0]).toEqual({
    name: 'gemini-weekly',
    utilization: expect.closeTo(0.05, 6),
    resetsAt: Date.parse('2026-12-03T07:04:25Z'),
    observedAt,
  });
  expect(windows[1]).toEqual({
    name: 'gemini-5h',
    utilization: expect.closeTo(0.06, 6),
    resetsAt: Date.parse('2026-11-26T17:04:25Z'),
    observedAt,
  });
  expect(windows[2]).toEqual({
    name: '3p-weekly',
    utilization: 0,
    resetsAt: null,
    observedAt,
  });
  expect(windows[3]).toEqual({
    name: '3p-5h',
    utilization: 1,
    resetsAt: null,
    observedAt,
  });
  expect(parseAntigravityUsageOutput('{"status":"SUCCESS"}', observedAt)).toEqual([]);
});

test('writeAntigravityOAuthCredential writes both antigravity-acp and antigravity-cli token files', () => {
  const home = makeTestTempDir('agy-oauth-write-');
  fixtures.push(home);
  writeAntigravityOAuthCredential(home, {
    kind: 'oauth-personal',
    refreshToken: '1//test-refresh-token-123456',
    authMethod: 'consumer',
  });
  const acp = JSON.parse(
    readFileSync(join(home, '.gemini/antigravity-acp/antigravity-oauth-token'), 'utf8'),
  );
  const cli = JSON.parse(
    readFileSync(join(home, '.gemini/antigravity-cli/antigravity-oauth-token'), 'utf8'),
  );
  expect(cli).toEqual(acp);
  expect(cli.token.refresh_token).toBe('1//test-refresh-token-123456');
});

test('probeAntigravityUsage isolates OAuth credentials in a temp profile and cleans it up', async () => {
  vi.stubEnv('GEMINI_API_KEY', 'ambient-api-key');
  vi.stubEnv('GOOGLE_API_KEY', 'ambient-google-key');
  const { binPath, marker, dir } = createFakeAgyBinary('ok');
  const cairnHome = join(dir, 'cairn-home');
  const realHome = join(dir, 'real-home');
  mkdirSync(cairnHome, { recursive: true });
  mkdirSync(realHome, { recursive: true });

  const result = await probeAntigravityUsage(
    { binPath },
    {
      mode: 'oauth',
      credential: {
        kind: 'oauth-personal',
        refreshToken: '1//oauth-refresh-token-value',
        authMethod: 'consumer',
      },
    },
    cairnHome,
    realHome,
  );
  expect(result.status).toBe('ok');
  if (result.status !== 'ok') throw new Error('expected ok');
  expect(result.windows.map((w) => w.name)).toEqual([
    'gemini-weekly',
    'gemini-5h',
    '3p-weekly',
    '3p-5h',
  ]);
  const meta = JSON.parse(readFileSync(marker, 'utf8'));
  expect(dirname(dirname(meta.home))).toBe(join(realpathSync(cairnHome), 'credential-profiles'));
  expect(meta.geminiHome).toBe(join(meta.home, '.gemini'));
  expect(meta.geminiCliHome).toBe(meta.home);
  expect(meta.forceFile).toBe('1');
  expect(meta.hasApiKey).toBe(false);
  expect(meta.hasCliToken).toBe(true);
  expect(meta.hasAcpToken).toBe(true);
  expect(meta.cliToken.token.refresh_token).toBe('1//oauth-refresh-token-value');
  expect(existsSync(meta.home)).toBe(false);
});

test('probeAntigravityUsage uses host home without mutating realHome', async () => {
  const { binPath, marker, dir } = createFakeAgyBinary('ok');
  const cairnHome = join(dir, 'cairn-home');
  const realHome = join(dir, 'real-home');
  mkdirSync(cairnHome, { recursive: true });
  mkdirSync(join(realHome, '.gemini/antigravity-acp'), { recursive: true });
  writeFileSync(
    join(realHome, '.gemini/antigravity-acp/acp_token.json'),
    JSON.stringify({
      access_token: 'ya29.host-access-token-value',
      refresh_token: '1//host-refresh-token-value',
      expiry: '2026-12-01T00:00:00Z',
    }),
  );

  const result = await probeAntigravityUsage({ binPath }, { mode: 'host' }, cairnHome, realHome);
  expect(result.status).toBe('ok');
  const meta = JSON.parse(readFileSync(marker, 'utf8'));
  expect(meta.home).not.toBe(realHome);
  expect(meta.hasCliToken).toBe(true);
  expect(meta.cliToken.token.refresh_token).toBe('1//host-refresh-token-value');
  expect(existsSync(join(realHome, '.gemini/antigravity-cli/antigravity-oauth-token'))).toBe(false);
});

test.each([
  ['bad-grant', 'auth'],
  ['long-output', 'upstream'],
] as const)(
  'a failed probe with %s output is classified without stalling',
  async (mode, failure) => {
    const stub = createFakeAgyBinary(mode);
    const started = performance.now();
    const result = await probeAntigravityUsage(
      { binPath: stub.binPath },
      { mode: 'host' },
      stub.dir,
      stub.dir,
    );
    expect(result).toEqual({ status: 'failed', failure });
    expect(performance.now() - started).toBeLessThan(5_000);
  },
  120_000,
);

test('probeAntigravityUsage maps expired oauth, auth errors, abort timeouts, invalid output, and missing binary', async () => {
  const dir = makeTestTempDir('agy-usage-failures-');
  fixtures.push(dir);
  const expired = await probeAntigravityUsage(
    { binPath: '/nonexistent/agy' },
    {
      mode: 'oauth',
      credential: {
        kind: 'oauth-personal',
        token: 'ya29.expired-token-123456',
        expiresAt: Date.now() - 1_000,
      },
    },
    dir,
    dir,
  );
  expect(expired).toEqual({ status: 'failed', failure: 'auth' });

  const missing = await probeAntigravityUsage(
    { binPath: join(dir, 'missing-agy') },
    { mode: 'host' },
    dir,
    dir,
  );
  expect(missing).toEqual({ status: 'failed', failure: 'not-found' });

  const authStub = createFakeAgyBinary('auth');
  const authResult = await probeAntigravityUsage(
    { binPath: authStub.binPath },
    { mode: 'host' },
    authStub.dir,
    authStub.dir,
  );
  expect(authResult).toEqual({ status: 'failed', failure: 'auth' });

  const badStub = createFakeAgyBinary('bad-json');
  const badResult = await probeAntigravityUsage(
    { binPath: badStub.binPath },
    { mode: 'host' },
    badStub.dir,
    badStub.dir,
  );
  expect(badResult).toEqual({ status: 'failed', failure: 'upstream' });

  const hangStub = createFakeAgyBinary('hang');
  const controller = new AbortController();
  const pending = probeAntigravityUsage(
    { binPath: hangStub.binPath },
    {
      mode: 'oauth',
      credential: {
        kind: 'oauth-personal',
        refreshToken: '1//hang-refresh-token-1234',
        authMethod: 'consumer',
      },
    },
    hangStub.dir,
    hangStub.dir,
    controller.signal,
  );
  for (let i = 0; i < 500 && !existsSync(hangStub.marker); i++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(existsSync(hangStub.marker)).toBe(true);
  controller.abort();
  expect(await pending).toEqual({ status: 'failed', failure: 'timeout' });
  const meta = JSON.parse(readFileSync(hangStub.marker, 'utf8'));
  expect(existsSync(meta.home)).toBe(false);
});
