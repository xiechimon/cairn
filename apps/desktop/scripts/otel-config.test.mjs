import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { desktopOtelEnv, scrubSpawnEnv, withOtelFileEnv } from '../src/otel-config.ts';

const ENDPOINT = 'https://collector.example.test/api/public/otel';
const HEADERS = 'Authorization=Basic cGs6c2s=,x-langfuse-ingestion-version=4';

function configFile(text, mode = 0o600) {
  const path = join(mkdtempSync(join(tmpdir(), 'cairn-otel-')), 'otel.env');
  writeFileSync(path, text);
  chmodSync(path, mode);
  return path;
}

function collectLogs() {
  const lines = [];
  return { lines, log: (line) => lines.push(line) };
}

test('no file means no export variables', () => {
  const { lines, log } = collectLogs();
  const path = join(mkdtempSync(join(tmpdir(), 'cairn-otel-')), 'otel.env');
  assert.deepEqual(desktopOtelEnv(path, log), {});
  assert.deepEqual(lines, []);
});

test('a private file passes endpoint and headers and defaults the environment to mac', () => {
  const path = configFile(`CAIRN_OTEL_ENDPOINT=${ENDPOINT}\nCAIRN_OTEL_HEADERS=${HEADERS}\n`);
  assert.deepEqual(
    desktopOtelEnv(path, () => {}),
    {
      CAIRN_OTEL_ENDPOINT: ENDPOINT,
      CAIRN_OTEL_HEADERS: HEADERS,
      CAIRN_OTEL_ENVIRONMENT: 'mac',
    },
  );
});

test('an explicit environment is kept', () => {
  const path = configFile(`CAIRN_OTEL_ENDPOINT=${ENDPOINT}\nCAIRN_OTEL_ENVIRONMENT=mac-dev\n`);
  assert.deepEqual(
    desktopOtelEnv(path, () => {}),
    {
      CAIRN_OTEL_ENDPOINT: ENDPOINT,
      CAIRN_OTEL_ENVIRONMENT: 'mac-dev',
    },
  );
});

test('a file without an endpoint turns export off', () => {
  const path = configFile(`CAIRN_OTEL_HEADERS=${HEADERS}\n`);
  assert.deepEqual(
    desktopOtelEnv(path, () => {}),
    {},
  );
});

test('a file readable by group or others is ignored and logged', () => {
  const { lines, log } = collectLogs();
  const path = configFile(`CAIRN_OTEL_ENDPOINT=${ENDPOINT}\n`, 0o644);
  assert.deepEqual(desktopOtelEnv(path, log), {});
  assert.equal(lines.length, 1);
  assert.match(lines[0], /chmod 600/);
});

test('keys other than the three export variables are ignored', () => {
  const path = configFile(
    `CAIRN_OTEL_ENDPOINT=${ENDPOINT}\nCAIRN_TOKEN=nope\nNODE_OPTIONS=--inspect\nOTEL_SDK_DISABLED=false\n`,
  );
  assert.deepEqual(Object.keys(desktopOtelEnv(path, () => {})).sort(), [
    'CAIRN_OTEL_ENDPOINT',
    'CAIRN_OTEL_ENVIRONMENT',
  ]);
});

test('child processes receive only the env-file flag, never the otel values', () => {
  const path = configFile(`CAIRN_OTEL_ENDPOINT=${ENDPOINT}\nCAIRN_OTEL_HEADERS=${HEADERS}\n`);
  const inherited = {
    PATH: '/usr/bin',
    CAIRN_OTEL_ENDPOINT: 'http://127.0.0.1:3000/api/public/otel',
    CAIRN_OTEL_HEADERS: 'Authorization=Basic old',
    CAIRN_OTEL_ENVIRONMENT: 'production',
  };
  assert.deepEqual(withOtelFileEnv(inherited, null), { PATH: '/usr/bin' });
  assert.deepEqual(withOtelFileEnv(inherited, path), {
    PATH: '/usr/bin',
    CAIRN_OTEL_ENV_FILE: path,
  });
});

test('spawn env audit drops credential-shaped and otel keys but keeps system keys', () => {
  const env = scrubSpawnEnv({
    PATH: '/usr/bin',
    HOME: '/Users/x',
    SSH_AUTH_SOCK: '/tmp/agent.sock',
    CAIRN_HOME: '/x',
    CAIRN_SERVER: 'http://127.0.0.1:1',
    CAIRN_OWNER_CHANNEL: 'ipc',
    CAIRN_CONFINE_DENIED_ROOTS: '/a:/b',
    GH_TOKEN: 'gho_x',
    GITHUB_TOKEN: 'ghp_x',
    HOMEBREW_GITHUB_API_TOKEN: 'ghp_y',
    CAIRN_TOKEN: 'machine-token',
    CAIRN_REQUIRE_TOKEN: '1',
    CAIRN_API_KEY: 'seeded-key',
    CAIRN_GIT_CRED_PASSWORD: 'step-cred',
    CAIRN_GITHUB_OAUTH_CLIENT_SECRET: 'oauth-secret',
    CAIRN_GITHUB_OAUTH_CLIENT_ID: 'oauth-id',
    CAIRN_ALERT_SMTP_URL: 'smtp://user:pass@relay.example',
    SOME_OTHER_SECRET: 'shh',
    BACKUP_PASSWORD: 'pw',
    CAIRN_OTEL_ENDPOINT: 'http://collector',
    CAIRN_OTEL_HEADERS: 'Authorization=Basic x',
    CAIRN_OTEL_ENVIRONMENT: 'mac',
    CAIRN_OTEL_ENV_FILE: '/stale',
    OTEL_EXPORTER_OTLP_HEADERS: 'ambient',
    OPENAI_API_KEY: 'sk-runtime',
    ANTHROPIC_API_KEY: 'sk-ant',
    NPM_CONFIG_USERCONFIG: '/x/.npmrc',
  });
  for (const key of Object.keys(env)) {
    if (key === 'CAIRN_REQUIRE_TOKEN') continue;
    assert.doesNotMatch(key, /_TOKEN$|_SECRET$|_PASSWORD$|_KEY$|^CAIRN_OTEL_|^OTEL_/, key);
  }
  assert.deepEqual(Object.keys(env).sort(), [
    'CAIRN_CONFINE_DENIED_ROOTS',
    'CAIRN_HOME',
    'CAIRN_OWNER_CHANNEL',
    'CAIRN_REQUIRE_TOKEN',
    'CAIRN_SERVER',
    'HOME',
    'NPM_CONFIG_USERCONFIG',
    'PATH',
    'SSH_AUTH_SOCK',
  ]);
});
