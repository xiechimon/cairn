import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  createServerLog,
  otelHeaderSecrets,
  redactSecrets,
  serverLogPath,
} from '../src/server-log.ts';

function logDir() {
  return mkdtempSync(join(tmpdir(), 'cairn-server-log-'));
}

test('the log lives under userData/logs', () => {
  assert.equal(serverLogPath('/u'), join('/u', 'logs', 'server.log'));
});

test('lines split across chunks are joined and written, a trailing partial line on close', () => {
  const path = join(logDir(), 'logs', 'server.log');
  const log = createServerLog(path, () => []);
  log.write('migrat');
  log.write('ions ok\nsecond');
  assert.equal(readFileSync(path, 'utf8'), 'migrations ok\n');
  log.close();
  assert.equal(readFileSync(path, 'utf8'), 'migrations ok\nsecond\n');
  assert.equal(statSync(path).mode & 0o077, 0);
});

test('the owner token and OTEL header values never reach the file', () => {
  const headers = 'Authorization=Basic cGs6c2tzZWNyZXQ=,x-langfuse-ingestion-version=4';
  const secrets = ['owner-token-123456', ...otelHeaderSecrets(headers)];
  const path = join(logDir(), 'server.log');
  const log = createServerLog(path, () => secrets);
  log.write('token owner-token-123456 hdr Basic cGs6c2tzZWNyZXQ= ');
  log.write(`all ${headers}\nversion 4 stays\n`);
  const text = readFileSync(path, 'utf8');
  assert.doesNotMatch(text, /owner-token-123456|cGs6c2tzZWNyZXQ/);
  assert.match(text, /version 4 stays/);
});

test('short values are not treated as secrets', () => {
  assert.equal(redactSecrets('a 4 b', ['4']), 'a 4 b');
});

test('the file rotates to one backup once the cap would be exceeded', () => {
  const path = join(logDir(), 'server.log');
  const log = createServerLog(path, () => [], 100);
  for (let i = 0; i < 10; i += 1) log.write(`${String(i).repeat(29)}\n`);
  assert.ok(existsSync(`${path}.1`));
  assert.ok(!existsSync(`${path}.2`));
  assert.ok(statSync(path).size <= 100);
  assert.ok(readFileSync(path, 'utf8').includes('9'.repeat(29)));
});

test('an existing file counts toward the cap after a restart', () => {
  const path = join(logDir(), 'server.log');
  createServerLog(path, () => [], 60).write(`${'a'.repeat(49)}\n`);
  createServerLog(path, () => [], 60).write(`${'b'.repeat(49)}\n`);
  assert.equal(readFileSync(`${path}.1`, 'utf8'), `${'a'.repeat(49)}\n`);
  assert.equal(readFileSync(path, 'utf8'), `${'b'.repeat(49)}\n`);
});
