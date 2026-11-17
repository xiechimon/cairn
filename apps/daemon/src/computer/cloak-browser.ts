import { randomUUID } from 'node:crypto';
import { link, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { binaryInfo, ensureBinary, getDefaultStealthArgs, licenseErrorFrom } from 'cloakbrowser';
import { z } from 'zod';
import { ComputerRefusal } from './provider.js';

export interface CloakSdk {
  binaryInfo(): { installed: boolean; binaryPath: string | null; version: string | null };
  ensureBinary(key: string): Promise<string>;
  getDefaultStealthArgs(): string[];
  licenseErrorFrom(error: unknown): Error | null;
}

function isValidLocale(value: string): boolean {
  if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(value) || value.length > 35) return false;
  try {
    return Intl.getCanonicalLocales(value)[0] === value;
  } catch {
    return false;
  }
}

function normalizeLocaleCandidate(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const base = raw.trim().split(/[.@]/)[0]?.replaceAll('_', '-') ?? '';
  if (!base || /^(?:c|posix)$/i.test(base)) return undefined;
  try {
    const canonical = Intl.getCanonicalLocales(base)[0];
    return canonical && isValidLocale(canonical) ? canonical : undefined;
  } catch {
    return undefined;
  }
}

function isValidTimezone(value: string): boolean {
  if (!/^[A-Za-z0-9_+/-]{1,64}$/.test(value)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function resolveHostBrowserLocaleAndTimezone(env: NodeJS.ProcessEnv): {
  locale: string;
  timezone: string;
} {
  const resolved = Intl.DateTimeFormat().resolvedOptions();
  const locale =
    normalizeLocaleCandidate(env.LC_ALL) ??
    normalizeLocaleCandidate(env.LC_MESSAGES) ??
    normalizeLocaleCandidate(env.LANG) ??
    normalizeLocaleCandidate(resolved.locale) ??
    'en-US';
  const envTimezone = env.TZ?.trim();
  const timezone =
    envTimezone && isValidTimezone(envTimezone)
      ? envTimezone
      : resolved.timeZone && isValidTimezone(resolved.timeZone)
        ? resolved.timeZone
        : 'UTC';
  return { locale, timezone };
}

const identitySchema = z
  .object({
    seed: z.number().int().min(10000).max(99999),
    platform: z.enum(['windows', 'macos', 'linux']),
    locale: z.string().refine(isValidLocale),
    timezone: z.string().refine(isValidTimezone),
  })
  .strict();

export interface CloakLaunch {
  executable: string;
  args: string[];
  env: Record<string, string>;
}

export class CloakBrowser {
  readonly licenseFile: string;
  private binary: string | undefined;
  private preparing: Promise<void> | undefined;
  version: string | null = null;

  constructor(
    private readonly env: NodeJS.ProcessEnv,
    private readonly sdk: CloakSdk = {
      binaryInfo,
      ensureBinary,
      getDefaultStealthArgs,
      licenseErrorFrom,
    },
  ) {
    this.licenseFile =
      env.CLOAKBROWSER_LICENSE_FILE ?? join(env.HOME ?? homedir(), '.cloakbrowser', 'license.key');
  }

  get ready(): boolean {
    return this.binary !== undefined;
  }

  private async key(): Promise<string> {
    const key = (await readFile(this.licenseFile, 'utf8').catch(() => '')).replace(
      /^[ \t\n\v\f\r]+|[ \t\n\v\f\r]+$/g,
      '',
    );
    if (!key || /[\0\r\n]/.test(key))
      throw new ComputerRefusal('CloakBrowser license file is missing, unreadable or empty');
    return key;
  }

  prepare(): Promise<void> {
    this.preparing ??= this.acquire().finally(() => {
      this.preparing = undefined;
    });
    return this.preparing;
  }

  private async acquire(): Promise<void> {
    this.binary = undefined;
    const key = await this.key();
    try {
      const info = this.sdk.binaryInfo();
      this.binary =
        info.installed && info.binaryPath ? info.binaryPath : await this.sdk.ensureBinary(key);
      this.version = info.installed ? info.version : this.sdk.binaryInfo().version;
    } catch (error) {
      this.binary = undefined;
      throw new ComputerRefusal(
        this.sdk.licenseErrorFrom(error)
          ? 'CloakBrowser license denied or unavailable'
          : 'CloakBrowser binary acquisition failed',
      );
    }
  }

  private async identity(profile: string): Promise<z.infer<typeof identitySchema>> {
    const file = join(profile, '.cairn-cloak-identity.json');
    try {
      return identitySchema.parse(JSON.parse(await readFile(file, 'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw new ComputerRefusal('CloakBrowser profile identity is invalid');
    }
    const defaults = this.sdk.getDefaultStealthArgs();
    const { locale, timezone } = resolveHostBrowserLocaleAndTimezone(this.env);
    const identity = identitySchema.parse({
      seed: Number(defaults.find((arg) => arg.startsWith('--fingerprint='))?.split('=')[1]),
      platform: defaults.find((arg) => arg.startsWith('--fingerprint-platform='))?.split('=')[1],
      locale,
      timezone,
    });
    await mkdir(profile, { recursive: true, mode: 0o700 });
    const temporary = join(profile, `.cloak-identity-${randomUUID()}`);
    await writeFile(temporary, JSON.stringify(identity), { flag: 'wx', mode: 0o600 });
    try {
      await link(temporary, file).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'EEXIST') throw error;
      });
    } finally {
      await unlink(temporary);
    }
    try {
      return identitySchema.parse(JSON.parse(await readFile(file, 'utf8')));
    } catch {
      throw new ComputerRefusal('CloakBrowser profile identity is invalid');
    }
  }

  async launch(profile: string): Promise<CloakLaunch> {
    if (!this.binary) throw new ComputerRefusal('CloakBrowser has not been prepared');
    const key = await this.key();
    const identity = await this.identity(profile);
    return {
      executable: this.binary,
      args: [
        '--no-sandbox',
        `--fingerprint=${identity.seed}`,
        `--fingerprint-platform=${identity.platform}`,
        `--lang=${identity.locale}`,
        `--fingerprint-locale=${identity.locale}`,
        `--fingerprint-timezone=${identity.timezone}`,
        '--ignore-gpu-blocklist',
        '--start-maximized',
        '--ozone-platform=x11',
        '--password-store=basic',
        '--no-first-run',
        '--no-default-browser-check',
        '--hide-crash-restore-bubble',
        '--restore-last-session',
      ],
      env: { CLOAKBROWSER_LICENSE_KEY: key },
    };
  }
}

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export async function writeCloakLauncher(
  directory: string,
  profile: string,
  engine: CloakBrowser,
  proxy?: string,
): Promise<void> {
  const launch = await engine.launch(profile);
  const launcher = join(directory, 'cloak-browser');
  const args = [
    ...launch.args,
    `--user-data-dir=${profile}`,
    ...(proxy ? [`--proxy-server=${proxy}`] : []),
  ];
  await writeFile(
    launcher,
    [
      '#!/bin/bash',
      'set -euo pipefail',
      'unset CLOAKBROWSER_LICENSE_KEY WAYLAND_DISPLAY WAYLAND_SOCKET __GLX_VENDOR_LIBRARY_NAME',
      `lock=${shellQuote(join(profile, 'SingletonLock'))}`,
      'if [[ -L $lock ]]; then',
      '  owner=$(readlink "$lock")',
      `  pid=\${owner##*-}`,
      '  [[ $pid =~ ^[0-9]+$ ]] || exit 1',
      '  if kill -0 "$pid" 2>/dev/null; then exit 1; fi',
      'fi',
      'shopt -s extglob',
      'key=',
      `if IFS= read -r -d '' key < ${shellQuote(engine.licenseFile)}; then exit 1; fi`,
      `key=\${key##+([ $'\\t\\n\\v\\f\\r'])}`,
      `key=\${key%%+([ $'\\t\\n\\v\\f\\r'])}`,
      "[[ -n $key && $key != *[$'\\r\\n']* ]] || exit 1",
      'CLOAKBROWSER_LICENSE_KEY=$key',
      'export CLOAKBROWSER_LICENSE_KEY',
      `exec ${[launch.executable, ...args].map(shellQuote).join(' ')} "$@"`,
      '',
    ].join('\n'),
    { mode: 0o700 },
  );
}
