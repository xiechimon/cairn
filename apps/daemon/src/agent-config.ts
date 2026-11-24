import { randomUUID } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, sep } from 'node:path';
import type { AntigravityOAuthStepCredential } from '@cairn/shared';
import { claudeConfigHome, runtimeHome } from './runtime-homes.js';

export const ANTIGRAVITY_OAUTH_SHARED_HOME = 'antigravity-oauth';
export const ANTIGRAVITY_OAUTH_PERSISTENT_DIRS = ['conversations', 'brain'] as const;

export function antigravityOAuthPersistentDirs(cairnHome: string): string[] {
  const acpDir = join(
    runtimeHome(cairnHome, ANTIGRAVITY_OAUTH_SHARED_HOME),
    '.gemini',
    'antigravity-acp',
  );
  return ANTIGRAVITY_OAUTH_PERSISTENT_DIRS.map((name) => join(acpDir, name));
}

export const ANTIGRAVITY_CREDENTIAL_FILES = [
  '.gemini/antigravity-cli/antigravity-oauth-token',
  '.gemini/antigravity-acp/acp_token.json',
  '.gemini/antigravity-acp/acp_business_token.json',
  '.gemini/jetski-standalone-oauth-token',
] as const;
export const GEMINI_CREDENTIAL_FILES = [
  '.gemini/oauth_creds.json',
  '.gemini/google_accounts.json',
] as const;

export function claudeConfigDir(cairnHome: string): string {
  return claudeConfigHome(cairnHome);
}

export function agentHomeDir(cairnHome: string, name: string): string {
  return runtimeHome(cairnHome, name);
}

function lstatOrNull(path: string) {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
}

function realDirectory(home: string, relative: string): string {
  const realRoot = realpathSync(home);
  let current = realRoot;
  for (const part of relative
    .split(/[\\/]/)
    .filter((segment) => segment !== '' && segment !== '.')) {
    if (part === '..') throw new Error(`Invalid relative directory segment: ${relative}`);
    current = join(current, part);
    const stat = lstatOrNull(current);
    if (!stat?.isDirectory()) {
      if (stat !== null) rmSync(current, { recursive: true, force: true });
      try {
        mkdirSync(current, { mode: 0o700 });
      } catch (error) {
        if (
          (error as NodeJS.ErrnoException).code !== 'EEXIST' ||
          !lstatOrNull(current)?.isDirectory()
        ) {
          throw error;
        }
      }
    }
    const resolved = realpathSync(current);
    if (resolved !== realRoot && !resolved.startsWith(`${realRoot}${sep}`)) {
      throw new Error(`Unsafe agent config directory escape: ${current}`);
    }
  }
  return current;
}

function clearNonLink(path: string): void {
  const stat = lstatOrNull(path);
  if (stat !== null && !stat.isSymbolicLink()) rmSync(path, { recursive: true, force: true });
}

function linkCredentials(home: string, realHome: string, files: readonly string[]): void {
  for (const file of files) {
    const target = join(realDirectory(home, dirname(file)), file.split('/').at(-1) as string);
    const source = join(realHome, file);
    clearNonLink(target);
    if (!existsSync(source)) {
      rmSync(target, { force: true });
      continue;
    }
    const staging = `${target}.${randomUUID()}`;
    symlinkSync(source, staging);
    renameSync(staging, target);
  }
}

function readJsonObject(path: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function writeJsonObject(
  home: string,
  file: string,
  value: Record<string, unknown>,
): string {
  const path = join(realDirectory(home, dirname(file)), file.split('/').at(-1) as string);
  clearNonLink(path);
  const staging = `${path}.${randomUUID()}`;
  writeFileSync(staging, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(staging, path);
  return path;
}

export function prepareAntigravityHome(input: {
  cairnHome: string;
  realHome: string;
  apiKey: boolean;
}): string {
  const home = agentHomeDir(input.cairnHome, input.apiKey ? 'antigravity-api-key' : 'antigravity');
  mkdirSync(home, { recursive: true, mode: 0o700 });
  linkCredentials(home, input.realHome, input.apiKey ? [] : ANTIGRAVITY_CREDENTIAL_FILES);
  writeAntigravityAuthSettings(
    home,
    input.apiKey ? 'gemini-api-key' : 'oauth-personal',
    input.apiKey ? undefined : input.realHome,
  );
  return home;
}

export function writeAntigravityOAuthCredential(
  home: string,
  credential: AntigravityOAuthStepCredential,
  cairnHome?: string,
): void {
  const authType = credential.authMethod === 'business' ? 'oauth-business' : 'oauth-personal';
  writeAntigravityAuthSettings(home, authType);
  if (cairnHome !== undefined) {
    const sharedHome = realDirectory(cairnHome, join('homes', ANTIGRAVITY_OAUTH_SHARED_HOME));
    const sharedAcpDir = realDirectory(sharedHome, join('.gemini', 'antigravity-acp'));
    const profileAcpDir = realDirectory(home, join('.gemini', 'antigravity-acp'));
    for (const name of ANTIGRAVITY_OAUTH_PERSISTENT_DIRS) {
      const target = realDirectory(sharedAcpDir, name);
      const link = join(profileAcpDir, name);
      if (lstatOrNull(link) === null) symlinkSync(target, link);
    }
  }
  const freshAccess =
    credential.token !== undefined &&
    credential.expiresAt !== undefined &&
    credential.expiresAt > Date.now()
      ? { token: credential.token, expiry: new Date(credential.expiresAt).toISOString() }
      : null;
  if (credential.refreshToken !== undefined) {
    writeJsonObject(home, '.gemini/antigravity-acp/antigravity-oauth-token', {
      token: {
        access_token: freshAccess?.token ?? '',
        token_type: 'Bearer',
        refresh_token: credential.refreshToken,
        expiry: freshAccess?.expiry ?? '2020-01-01T00:00:00Z',
      },
      auth_method: credential.authMethod ?? 'consumer',
    });
    return;
  }
  if (credential.token === undefined || credential.expiresAt === undefined) {
    throw new Error('Antigravity OAuth credential is missing both refresh token and access token');
  }
  writeJsonObject(home, '.gemini/antigravity-acp/antigravity-oauth-token', {
    token: {
      access_token: credential.token,
      token_type: 'Bearer',
      expiry: new Date(credential.expiresAt).toISOString(),
    },
  });
}

export function antigravityFileStorageEnv(home: string): Record<string, string> {
  return {
    GEMINI_HOME: join(home, '.gemini'),
    GEMINI_CLI_HOME: home,
    AGY_ACP_FORCE_FILE_STORAGE: '1',
    AGY_CLI_FORCE_FILE_TOKEN_STORAGE: '1',
    AGY_CLI_DISABLE_AUTO_UPDATE: '1',
    SSH_CONNECTION: '127.0.0.1 0 127.0.0.1 0',
  };
}

export function writeAntigravityAuthSettings(
  home: string,
  auth: 'gemini-api-key' | 'oauth-personal' | 'oauth-business' = 'gemini-api-key',
  oauthHome?: string,
): void {
  const settingsFile = '.gemini/antigravity-cli/settings.json';
  const userGcp =
    oauthHome === undefined ? undefined : readJsonObject(join(oauthHome, settingsFile)).gcp;
  writeJsonObject(home, settingsFile, {
    ...(auth === 'gemini-api-key' ? { modelProvider: 'gemini' } : {}),
    ...(userGcp === undefined ? {} : { gcp: userGcp }),
  });
  const acpSettingsFile = '.gemini/antigravity-acp/settings.json';
  const acpUserGcp =
    oauthHome === undefined ? undefined : readJsonObject(join(oauthHome, acpSettingsFile)).gcp;
  writeJsonObject(home, acpSettingsFile, {
    auth: { type: auth },
    ...(acpUserGcp === undefined ? {} : { gcp: acpUserGcp }),
  });
}

export function prepareGeminiHome(input: { cairnHome: string; realHome: string }): string {
  const home = agentHomeDir(input.cairnHome, 'gemini');
  mkdirSync(home, { recursive: true, mode: 0o700 });
  linkCredentials(home, input.realHome, GEMINI_CREDENTIAL_FILES);
  const settingsFile = '.gemini/settings.json';
  const userSecurity = readJsonObject(join(input.realHome, settingsFile)).security;
  const userAuth =
    typeof userSecurity === 'object' && userSecurity !== null
      ? (userSecurity as Record<string, unknown>).auth
      : undefined;
  writeJsonObject(
    home,
    settingsFile,
    userAuth === undefined ? {} : { security: { auth: userAuth } },
  );
  return home;
}
