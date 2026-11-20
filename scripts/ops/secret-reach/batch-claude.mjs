#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { constants, homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SETTINGS = fileURLToPath(new URL('./batch-sandbox.settings.json', import.meta.url));

const LOGIN_DESCRIPTORS = [
  { name: 'ANTHROPIC_API_KEY', descriptor: 'CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR' },
  { name: 'CLAUDE_CODE_OAUTH_TOKEN', descriptor: 'CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR' },
];

const FIRST_LOGIN_FD = 3;

const SECRET_WORDS = new Set([
  'TOKEN',
  'TOKENS',
  'SECRET',
  'SECRETS',
  'PASSWORD',
  'PASSWORDS',
  'PASSWD',
  'PASSPHRASE',
  'CREDENTIAL',
  'CREDENTIALS',
  'APIKEY',
  'KEY',
  'KEYS',
  'AUTH',
  'COOKIE',
  'COOKIES',
  'HEADERS',
  'PAT',
  'BEARER',
]);

const SECRET_NAMES = new Set([
  'GIT_ASKPASS',
  'SSH_ASKPASS',
  'GIT_CONFIG_COUNT',
  'GIT_CONFIG_PARAMETERS',
]);

const SECRET_PREFIXES = ['CAIRN_GIT_CRED_', 'GIT_CONFIG_KEY_', 'GIT_CONFIG_VALUE_'];

const URL_WITH_PASSWORD = /^[a-z][a-z0-9+.-]*:\/\/[^/@\s:]*:[^/@\s]+@/i;

export function isCredentialEnv(name, value = '') {
  const upper = name.toUpperCase();
  if (SECRET_NAMES.has(upper) || SECRET_PREFIXES.some((prefix) => upper.startsWith(prefix)))
    return true;
  if (upper.split(/[_-]+/).some((word) => SECRET_WORDS.has(word))) return true;
  return URL_WITH_PASSWORD.test(value);
}

export function batchEnv(inherited) {
  const env = {};
  for (const [name, value] of Object.entries(inherited)) {
    if (value === undefined || isCredentialEnv(name, value)) continue;
    if (LOGIN_DESCRIPTORS.some((login) => login.descriptor === name)) continue;
    env[name] = value;
  }
  const login = [];
  for (const { name, descriptor } of LOGIN_DESCRIPTORS) {
    const value = inherited[name];
    if (value === undefined || value === '') continue;
    env[descriptor] = String(FIRST_LOGIN_FD + login.length);
    login.push(value);
  }
  env.CAIRN_HEAVY_SLOTS_DIR ??= join(env.HOME ?? homedir(), '.cache', 'cairn-heavy-slots');
  env.CAIRN_HEAVY_SLOTS ??= '1';
  return { env, login };
}

function run(args) {
  if (args.some((arg) => arg.startsWith('--settings') || arg.startsWith('--setting-sources'))) {
    process.stderr.write(
      'batch-claude: --settings and --setting-sources are fixed to the batch sandbox settings\n',
    );
    process.exitCode = 2;
    return;
  }
  const { env, login } = batchEnv(process.env);
  const child = spawn(
    process.env.CAIRN_BATCH_CLAUDE ?? 'claude',
    ['--settings', SETTINGS, ...args],
    {
      env,
      stdio: ['inherit', 'inherit', 'inherit', ...login.map(() => 'pipe')],
    },
  );
  login.forEach((value, index) => {
    const channel = child.stdio[FIRST_LOGIN_FD + index];
    channel?.on('error', () => {});
    channel?.end(value);
  });
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'])
    process.on(signal, () => child.kill(signal));
  let failed = false;
  child.on('error', (error) => {
    failed = true;
    process.stderr.write(`batch-claude: ${error.message}\n`);
  });
  child.on('close', (code, signal) => {
    process.exitCode = failed ? 1 : (code ?? 128 + (constants.signals[signal] ?? 0));
    process.exit();
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) run(process.argv.slice(2));
