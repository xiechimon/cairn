import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { desktopOtelEnv, withOtelEnv } from '../src/otel-config.ts';

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

test('inherited export variables are replaced by the file, never mixed in', () => {
  const inherited = {
    PATH: '/usr/bin',
    CAIRN_OTEL_ENDPOINT: 'http://127.0.0.1:3000/api/public/otel',
    CAIRN_OTEL_HEADERS: 'Authorization=Basic old',
    CAIRN_OTEL_ENVIRONMENT: 'production',
  };
  assert.deepEqual(withOtelEnv(inherited, {}), { PATH: '/usr/bin' });
  assert.deepEqual(
    withOtelEnv(inherited, { CAIRN_OTEL_ENDPOINT: ENDPOINT, CAIRN_OTEL_ENVIRONMENT: 'mac' }),
    {
      PATH: '/usr/bin',
      CAIRN_OTEL_ENDPOINT: ENDPOINT,
      CAIRN_OTEL_ENVIRONMENT: 'mac',
    },
  );
});
