import { randomUUID } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, sep } from 'node:path';

export const ANTIGRAVITY_CREDENTIAL_FILES = [
  '.gemini/antigravity-cli/antigravity-oauth-token',
  '.gemini/jetski-standalone-oauth-token',
] as const;
export const GEMINI_CREDENTIAL_FILES = [
  '.gemini/oauth_creds.json',
  '.gemini/google_accounts.json',
] as const;
const MAC_KEYCHAINS = 'Library/Keychains';

export function claudeConfigDir(cairnHome: string): string {
  return join(cairnHome, 'claude');
}

export function agentHomeDir(cairnHome: string, name: string): string {
  return join(cairnHome, 'agent-homes', name);
}

function lstatOrNull(path: string) {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
}

function realDirectory(home: string, relative: string): string {
  let current = home;
  for (const part of relative.split(sep).filter((segment) => segment !== '.')) {
    current = join(current, part);
    const stat = lstatOrNull(current);
    if (stat?.isDirectory()) continue;
    if (stat !== null) rmSync(current, { recursive: true, force: true });
    mkdirSync(current, { mode: 0o700 });
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

function writeJsonObject(home: string, file: string, value: Record<string, unknown>): void {
  const path = join(realDirectory(home, dirname(file)), file.split('/').at(-1) as string);
  clearNonLink(path);
  const staging = `${path}.${randomUUID()}`;
  writeFileSync(staging, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(staging, path);
}

function keychainFiles(platform: NodeJS.Platform): string[] {
  return platform === 'darwin' ? [MAC_KEYCHAINS] : [];
}

export function prepareAntigravityHome(input: {
  cairnHome: string;
  realHome: string;
  apiKey: boolean;
  platform?: NodeJS.Platform;
}): string {
  const home = agentHomeDir(input.cairnHome, input.apiKey ? 'antigravity-api-key' : 'antigravity');
  mkdirSync(home, { recursive: true, mode: 0o700 });
  linkCredentials(home, input.realHome, [
    ...(input.apiKey ? [] : ANTIGRAVITY_CREDENTIAL_FILES),
    ...keychainFiles(input.platform ?? process.platform),
  ]);
  const settingsFile = '.gemini/antigravity-cli/settings.json';
  const userGcp = input.apiKey ? undefined : readJsonObject(join(input.realHome, settingsFile)).gcp;
  writeJsonObject(home, settingsFile, {
    ...(input.apiKey ? { modelProvider: 'gemini' } : {}),
    ...(userGcp === undefined ? {} : { gcp: userGcp }),
  });
  return home;
}

export function prepareGeminiHome(input: {
  cairnHome: string;
  realHome: string;
  platform?: NodeJS.Platform;
}): string {
  const home = agentHomeDir(input.cairnHome, 'gemini');
  mkdirSync(home, { recursive: true, mode: 0o700 });
  linkCredentials(home, input.realHome, [
    ...GEMINI_CREDENTIAL_FILES,
    ...keychainFiles(input.platform ?? process.platform),
  ]);
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
