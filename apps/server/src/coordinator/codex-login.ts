import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const CODEX_PROVIDER_ID = 'openai-codex';
export const CODEX_BASE_URL = 'https://chatgpt.com/backend-api';
export const CODEX_API = 'openai-codex-responses';

export function codexAuthPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.CODEX_HOME ?? join(homedir(), '.codex'), 'auth.json');
}

function expiryMs(token: string): number | null {
  const payload = token.split('.')[1];
  if (payload === undefined) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      exp?: unknown;
    };
    return typeof claims.exp === 'number' ? claims.exp * 1000 : null;
  } catch {
    return null;
  }
}

export function readCodexLogin(
  path: string = codexAuthPath(),
  now: number = Date.now(),
): string | null {
  let parsed: { tokens?: { access_token?: unknown } };
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
  const token = parsed.tokens?.access_token;
  if (typeof token !== 'string' || token === '') return null;
  const expires = expiryMs(token);
  if (expires !== null && expires <= now) return null;
  return token;
}

export function codexLoginAvailable(): boolean {
  return readCodexLogin() !== null;
}

export function usesHostCodexLogin(providerId: string, baseUrl: string | null): boolean {
  return providerId === CODEX_PROVIDER_ID && (baseUrl === null || baseUrl === '');
}
