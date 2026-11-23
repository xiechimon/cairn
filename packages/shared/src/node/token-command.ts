import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import {
  ACCESS_TOKEN_FILE_NAME,
  formatAccessTokenFile,
  parseAccessTokenFile,
} from '../access-token-file.js';
import { BRAND, ENV_VARS } from '../brand.js';

export interface TokenCommandIo {
  env: NodeJS.ProcessEnv;
  writeOut(text: string): void;
}

function tokenFileOf(env: NodeJS.ProcessEnv): string {
  return resolve(env[ENV_VARS.home] ?? join(homedir(), BRAND.homeDirName), ACCESS_TOKEN_FILE_NAME);
}

export function readOwnerToken(env: NodeJS.ProcessEnv): string | null {
  const envToken = env[ENV_VARS.token];
  if (envToken !== undefined && envToken !== '') return envToken;
  try {
    return parseAccessTokenFile(readFileSync(tokenFileOf(env), 'utf8'));
  } catch {
    return null;
  }
}

export function runTokenCommand(
  opts: { rotate: boolean; revokeOwnerBrowserAuth?: (dbPath: string) => void },
  io: TokenCommandIo,
): number {
  const filePath = tokenFileOf(io.env);
  const envToken = io.env[ENV_VARS.token];
  const usesEnvToken = envToken !== undefined && envToken !== '';

  if (opts.rotate) {
    if (usesEnvToken) {
      io.writeOut(
        `${ENV_VARS.token} is set in the environment, so the server uses it and ignores the token file. Unset it and restart the server before rotating the file token.\n`,
      );
      return 1;
    }
    const dbPath = join(dirname(filePath), 'server', 'server.db');
    if (existsSync(dbPath)) {
      if (opts.revokeOwnerBrowserAuth === undefined) {
        io.writeOut(
          'Rotate with `npx @xiechimon/cairn token --rotate` to also revoke owner browser sign-ins.\n',
        );
        return 1;
      }
      opts.revokeOwnerBrowserAuth(dbPath);
    }
    const rotated = randomBytes(32).toString('hex');
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, formatAccessTokenFile(rotated), { mode: 0o600 });
    chmodSync(filePath, 0o600);
    io.writeOut(
      `Rotated access token (written to ${filePath}).\nNew token: ${rotated}\nRestart the server to apply the new access token. Sign in again with a fresh owner link.\n`,
    );
    return 0;
  }

  const token = readOwnerToken(io.env);
  if (token === null) {
    io.writeOut(
      `No access token found yet. The server creates ${filePath} on its first start; to create it now, set ${ENV_VARS.token} or run \`cairn token --rotate\`.\n`,
    );
    return 0;
  }
  io.writeOut(`${token}\n`);
  io.writeOut(
    usesEnvToken ? `(from environment variable ${ENV_VARS.token})\n` : `(from ${filePath})\n`,
  );
  io.writeOut(
    'This token is for this machine only. Other devices sign in with a one-time pairing code from Settings, not with this token.\n',
  );
  return 0;
}
