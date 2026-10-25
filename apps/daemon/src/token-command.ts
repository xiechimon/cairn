import { randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  ACCESS_TOKEN_FILE_NAME,
  ENV_VARS,
  formatAccessTokenFile,
  parseAccessTokenFile,
} from '@cairn/shared';
import { loadDaemonConfig } from './config.js';

export interface TokenCommandIo {
  env: NodeJS.ProcessEnv;
  writeOut(text: string): void;
}

export function runTokenCommand(opts: { rotate: boolean }, io: TokenCommandIo): number {
  const home = loadDaemonConfig({}, io.env).home;
  const filePath = join(home, ACCESS_TOKEN_FILE_NAME);
  const rawEnvToken = io.env[ENV_VARS.token];
  const envToken = rawEnvToken !== undefined && rawEnvToken !== '' ? rawEnvToken : null;

  if (opts.rotate) {
    if (envToken !== null) {
      io.writeOut(
        `${ENV_VARS.token} is set in the environment, so the server uses it and ignores the token file. Unset it and restart the server before rotating the file token.\n`,
      );
      return 1;
    }
    const rotated = randomBytes(32).toString('hex');
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, formatAccessTokenFile(rotated), { mode: 0o600 });
    chmodSync(filePath, 0o600);
    io.writeOut(
      `Rotated access token (written to ${filePath}).\nNew token: ${rotated}\nRestart the server to apply it; sessions holding the old token keep working until then.\n`,
    );
    return 0;
  }

  let fileToken: string | null = null;
  try {
    fileToken = parseAccessTokenFile(readFileSync(filePath, 'utf8'));
  } catch {
    fileToken = null;
  }
  const token = envToken ?? fileToken;
  if (token === null) {
    io.writeOut(
      `No access token configured — token auth is off. Set ${ENV_VARS.token} or run \`cairn token --rotate\` to create ${filePath}.\n`,
    );
    return 0;
  }
  io.writeOut(`${token}\n`);
  io.writeOut(
    envToken !== null ? `(from environment variable ${ENV_VARS.token})\n` : `(from ${filePath})\n`,
  );
  return 0;
}
