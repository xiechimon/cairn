import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { batchEnv, isCredentialEnv } from './batch-claude.mjs';

const launcher = fileURLToPath(new URL('./batch-claude.mjs', import.meta.url));
const settings = fileURLToPath(new URL('./batch-sandbox.settings.json', import.meta.url));

const CREDENTIALS = {
  GH_TOKEN: 'ghp_sentinel',
  GITHUB_TOKEN: 'ghs_sentinel',
  GH_ENTERPRISE_TOKEN: 'ghe_sentinel',
  NPM_TOKEN: 'npm_sentinel',
  HOMEBREW_GITHUB_API_TOKEN: 'brew_sentinel',
  OPENAI_API_KEY: 'sk-openai-sentinel',
  WINDSURF_API_KEY: 'windsurf-sentinel',
  GEMINI_API_KEY: 'gemini-sentinel',
  AWS_ACCESS_KEY_ID: 'AKIA_SENTINEL',
  AWS_SECRET_ACCESS_KEY: 'aws-secret-sentinel',
  AWS_SESSION_TOKEN: 'aws-session-sentinel',
  LANGFUSE_SECRET_KEY: 'sk-lf-sentinel',
  SLACK_BOT_PASSWORD: 'slack-sentinel',
  DB_PASSWD: 'passwd-sentinel',
  CAIRN_GIT_CRED_PASSWORD: 'cred-sentinel',
  CAIRN_GIT_CRED_USERNAME: 'x-access-token',
  GIT_CONFIG_COUNT: '1',
  GIT_CONFIG_KEY_0: 'http.extraheader',
  GIT_CONFIG_VALUE_0: 'Authorization: Bearer header-sentinel',
  GIT_CONFIG_PARAMETERS: "'credential.helper'='store'",
  GIT_ASKPASS: '/usr/local/bin/askpass',
  SSH_ASKPASS: '/usr/local/bin/askpass',
  SSH_AUTH_SOCK: '/private/tmp/agent.sock',
  OTEL_EXPORTER_OTLP_HEADERS: 'Authorization=Basic otel-sentinel',
  NPM_CONFIG__AUTH: 'npm-auth-sentinel',
  DATABASE_URL: 'postgres://user:url-sentinel@db.internal:5432/app',
  UPSTREAM_BEARER: 'bearer-sentinel',
};

const ORDINARY = {
  PATH: '/usr/bin:/bin',
  HOME: '/Users/someone',
  LANG: 'en_US.UTF-8',
  TERM: 'xterm-256color',
  SHELL: '/bin/zsh',
  GIT_AUTHOR_NAME: 'someone',
  GIT_AUTHOR_EMAIL: 'someone@example.com',
  GIT_CONFIG_GLOBAL: '/Users/someone/.gitconfig',
  HTTPS_PROXY: 'http://127.0.0.1:8080',
  CAIRN_LIVE_STACK_SLOTS: '2',
  KEYCHAIN_GROUP: 'none',
};

test('credential-shaped variables are classified as credentials', () => {
  for (const [name, value] of Object.entries(CREDENTIALS))
    assert.equal(isCredentialEnv(name, value), true, name);
});

test('ordinary variables are not classified as credentials', () => {
  for (const [name, value] of Object.entries(ORDINARY))
    assert.equal(isCredentialEnv(name, value), false, name);
});

test('the batch env drops every credential and keeps ordinary variables', () => {
  const { env } = batchEnv({ ...CREDENTIALS, ...ORDINARY });
  for (const name of Object.keys(CREDENTIALS)) assert.equal(env[name], undefined, name);
  for (const [name, value] of Object.entries(ORDINARY)) assert.equal(env[name], value, name);
});

test('Claude login variables leave the env and move to file descriptors only claude reads', () => {
  const { env, login } = batchEnv({
    ...ORDINARY,
    ANTHROPIC_API_KEY: 'sk-ant-sentinel',
    ANTHROPIC_AUTH_TOKEN: 'auth-sentinel',
    CLAUDE_CODE_OAUTH_TOKEN: 'oauth-sentinel',
  });
  for (const name of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN'])
    assert.equal(env[name], undefined, name);
  assert.deepEqual(login, ['sk-ant-sentinel', 'oauth-sentinel']);
  assert.equal(env.CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR, '3');
  assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR, '4');
});

test('a subscription login without env tokens passes no descriptors', () => {
  const { env, login } = batchEnv({
    ...ORDINARY,
    CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR: '3',
    CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR: '5',
  });
  assert.deepEqual(login, []);
  assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR, undefined);
  assert.equal(env.CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR, undefined);
});

test('the batch env points heavy slots at a sandbox-writable private dir unless the launcher chose one', () => {
  const defaults = batchEnv({ HOME: '/Users/someone' }).env;
  assert.equal(defaults.CAIRN_HEAVY_SLOTS_DIR, '/Users/someone/.cache/cairn-heavy-slots');
  const chosen = batchEnv({
    HOME: '/Users/someone',
    CAIRN_HEAVY_SLOTS_DIR: '/Users/someone/.cache/other',
  }).env;
  assert.equal(chosen.CAIRN_HEAVY_SLOTS_DIR, '/Users/someone/.cache/other');
});

function fakeClaude() {
  const dir = mkdtempSync(join(tmpdir(), 'batch-claude-'));
  const bin = join(dir, 'claude');
  writeFileSync(
    bin,
    [
      `#!${process.execPath}`,
      "const { readFileSync } = require('node:fs');",
      'const read = (name) => process.env[name] === undefined ? null : readFileSync(Number(process.env[name]), "utf8");',
      'const fds = { apiKey: read("CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR"), oauth: read("CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR") };',
      'process.stdout.write(JSON.stringify({ argv: process.argv.slice(2), env: process.env, fds }));',
      'process.exit(Number(process.env.FAKE_EXIT ?? 0));',
      '',
    ].join('\n'),
  );
  chmodSync(bin, 0o755);
  return bin;
}

function launch(args, extraEnv = {}) {
  return spawnSync(process.execPath, [launcher, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      ...CREDENTIALS,
      ANTHROPIC_API_KEY: 'sk-ant-sentinel',
      CAIRN_BATCH_CLAUDE: fakeClaude(),
      ...extraEnv,
    },
  });
}

test('the launcher runs claude under the batch settings with the scrubbed env', () => {
  const result = launch(['-p', 'hello', '--model', 'haiku']);
  assert.equal(result.status, 0, result.stderr);
  const seen = JSON.parse(result.stdout);
  assert.deepEqual(seen.argv, ['--settings', settings, '-p', 'hello', '--model', 'haiku']);
  for (const name of Object.keys(CREDENTIALS)) assert.equal(seen.env[name], undefined, name);
  assert.equal(seen.env.ANTHROPIC_API_KEY, undefined);
  assert.deepEqual(seen.fds, { apiKey: 'sk-ant-sentinel', oauth: null });
  const envText = JSON.stringify(seen.env);
  for (const value of [...Object.values(CREDENTIALS), 'sk-ant-sentinel'])
    assert.equal(value.length > 8 && envText.includes(value), false, value);
});

test('the launcher hands a subscription token to claude on its own descriptor', () => {
  const result = launch(['-p', 'hello'], {
    ANTHROPIC_API_KEY: '',
    CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat-sentinel',
  });
  assert.equal(result.status, 0, result.stderr);
  const seen = JSON.parse(result.stdout);
  assert.deepEqual(seen.fds, { apiKey: null, oauth: 'sk-ant-oat-sentinel' });
  assert.equal(seen.env.CLAUDE_CODE_OAUTH_TOKEN, undefined);
});

test('the launcher passes the claude exit status through', () => {
  const result = launch(['-p', 'hello'], { FAKE_EXIT: '7' });
  assert.equal(result.status, 7);
});

test('the launcher refuses a second settings source that could switch the sandbox off', () => {
  for (const flag of ['--settings', '--settings=other.json', '--setting-sources']) {
    const result = launch(['-p', 'hello', flag, 'x']);
    assert.equal(result.status, 2, flag);
    assert.equal(result.stdout, '', flag);
    assert.match(result.stderr, /settings/, flag);
  }
});
