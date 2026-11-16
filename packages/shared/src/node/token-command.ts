import { randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import {
  ACCESS_TOKEN_FILE_NAME,
  formatAccessTokenFile,
  parseAccessTokenFile,
} from '../access-token-file.js';
import { BRAND, ENV_VARS, PUBLISHED_PACKAGES } from '../brand.js';
import { ownerLinkResponseSchema, ownerSignInLink } from '../remote-access.js';

export interface TokenCommandIo {
  env: NodeJS.ProcessEnv;
  writeOut(text: string): void;
}

const DEFAULT_SERVER_PORT = 8787;

function tokenSources(env: NodeJS.ProcessEnv): { filePath: string; envToken: string | null } {
  const home = resolve(env[ENV_VARS.home] ?? join(homedir(), BRAND.homeDirName));
  const rawEnvToken = env[ENV_VARS.token];
  return {
    filePath: join(home, ACCESS_TOKEN_FILE_NAME),
    envToken: rawEnvToken !== undefined && rawEnvToken !== '' ? rawEnvToken : null,
  };
}

function readFileToken(filePath: string): string | null {
  try {
    return parseAccessTokenFile(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

export async function runTokenLinkCommand(io: TokenCommandIo): Promise<number> {
  const { filePath, envToken } = tokenSources(io.env);
  const token = envToken ?? readFileToken(filePath);
  if (token === null) {
    io.writeOut(
      `No access token found at ${filePath}. Start the server once with \`npx ${PUBLISHED_PACKAGES.server.name}\` to create it.\n`,
    );
    return 1;
  }
  const port = Number(io.env.PORT ?? '') || DEFAULT_SERVER_PORT;
  const origin = `http://127.0.0.1:${port}`;
  let response: Response;
  try {
    response = await fetch(`${origin}/api/auth/owner-link`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });
  } catch {
    io.writeOut(
      `Cairn is not running at ${origin}. Start it with \`npx ${PUBLISHED_PACKAGES.server.name}\`, then run this again.\n`,
    );
    return 1;
  }
  const parsed = ownerLinkResponseSchema.safeParse(await response.json().catch(() => null));
  if (!response.ok || !parsed.success) {
    io.writeOut(
      `The server at ${origin} refused to create a sign-in link (HTTP ${response.status}). Check that it uses the token in ${envToken !== null ? ENV_VARS.token : filePath}.\n`,
    );
    return 1;
  }
  io.writeOut(
    `Open this link in a browser on this computer to sign in as the owner. It works once, for 10 minutes:\n${ownerSignInLink(origin, parsed.data.code)}\n`,
  );
  return 0;
}

export function runTokenCommand(opts: { rotate: boolean }, io: TokenCommandIo): number {
  const { filePath, envToken } = tokenSources(io.env);

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

  const token = envToken ?? readFileToken(filePath);
  if (token === null) {
    io.writeOut(
      `No access token found yet. The server creates ${filePath} on its first start; to create it now, set ${ENV_VARS.token} or run \`cairn token --rotate\`.\n`,
    );
    return 0;
  }
  io.writeOut(`${token}\n`);
  io.writeOut(
    envToken !== null ? `(from environment variable ${ENV_VARS.token})\n` : `(from ${filePath})\n`,
  );
  io.writeOut(
    'This token is for this machine only. Other devices sign in with a one-time pairing code from Settings, not with this token.\n',
  );
  return 0;
}
