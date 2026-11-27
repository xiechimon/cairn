import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { sha256File } from '@cairn/shared/managed-bin';
import { findAdb, spawnAdb } from './phone-probe.js';

const PLATFORM_TOOLS_URL =
  'https://dl.google.com/android/repository/platform-tools_r37.0.3-darwin.zip';
const PLATFORM_TOOLS_ZIP_SHA256 =
  'df21339b9371fef9b19264404338dc686f59a88a1dce634b963da344909001d6';
const PLATFORM_TOOLS_ADB_SHA256 =
  'a1c4253c2f7336dd3e600689aef1c451ca0c74a614ea8495a79058fcd7299de3';
const PREPARATION_ERROR = 'phone support preparation failed';
const DOWNLOAD_TIMEOUT_MS = 60_000;

export interface PhoneAdbArtifact {
  url: string;
  zipSha256: string;
  adbSha256: string;
}

export interface RunFileResult {
  code: number;
  stdout: Buffer;
  stderr: Buffer;
}

export type RunFile = (
  file: string,
  args: readonly string[],
  opts?: { timeoutMs?: number; signal?: AbortSignal },
) => Promise<RunFileResult>;

export interface PhoneAdbBootstrapOptions {
  home: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  log?: (msg: string) => void;
  fetchImpl?: typeof fetch;
  runFile?: RunFile;
  extractZip?: (zipPath: string, destination: string, signal?: AbortSignal) => Promise<void>;
  artifact?: PhoneAdbArtifact;
  findAdbImpl?: (env: NodeJS.ProcessEnv) => string | null;
}

export interface PhoneAdbBootstrap {
  detectExisting(signal?: AbortSignal): Promise<string | null>;
  ensure(signal?: AbortSignal): Promise<string>;
}

const DEFAULT_ARTIFACT: PhoneAdbArtifact = {
  url: PLATFORM_TOOLS_URL,
  zipSha256: PLATFORM_TOOLS_ZIP_SHA256,
  adbSha256: PLATFORM_TOOLS_ADB_SHA256,
};

function defaultRunFile(file: string): ReturnType<typeof spawnAdb> {
  return spawnAdb(file);
}

function sha256Bytes(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function regularFile(path: string): boolean {
  try {
    const stat = lstatSync(path);
    return stat.isFile() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

export function createPhoneAdbBootstrap(opts: PhoneAdbBootstrapOptions): PhoneAdbBootstrap {
  const env = opts.env ?? process.env;
  const platform = opts.platform ?? process.platform;
  const artifact = opts.artifact ?? DEFAULT_ARTIFACT;
  const log = opts.log ?? (() => {});
  const fetchImpl = opts.fetchImpl ?? fetch;
  const runFile = opts.runFile ?? ((file, args, runOpts) => defaultRunFile(file)(args, runOpts));
  const findAdbImpl = opts.findAdbImpl ?? findAdb;
  const root = join(opts.home, 'phone');
  const target = join(root, 'platform-tools');
  const adbPath = join(target, 'adb');
  const markerPath = join(target, '.cairn-phone-adb.json');
  let preparing: Promise<string> | null = null;

  const extractZip =
    opts.extractZip ??
    (async (zipPath, destination, signal) => {
      const extracted = await runFile('/usr/bin/ditto', ['-xk', zipPath, destination], {
        timeoutMs: 30_000,
        ...(signal !== undefined ? { signal } : {}),
      });
      if (extracted.code !== 0) throw new Error('platform-tools extraction failed');
    });

  function managedCache(): string | null {
    if (!regularFile(adbPath) || !regularFile(markerPath)) return null;
    try {
      const marker = JSON.parse(readFileSync(markerPath, 'utf8')) as Record<string, unknown>;
      if (
        marker.url !== artifact.url ||
        marker.zipSha256 !== artifact.zipSha256 ||
        marker.adbSha256 !== artifact.adbSha256 ||
        sha256File(adbPath) !== artifact.adbSha256
      ) {
        return null;
      }
      return adbPath;
    } catch {
      return null;
    }
  }

  async function compatible(path: string, signal?: AbortSignal): Promise<boolean> {
    try {
      const version = await runFile(path, ['version'], { timeoutMs: 5_000, signal });
      if (version.code !== 0) return false;
      const help = await runFile(path, ['--help'], { timeoutMs: 5_000, signal });
      return help.code === 0 && /^\s*pair\s/m.test(help.stdout.toString('utf8'));
    } catch {
      return false;
    }
  }

  async function prepare(signal?: AbortSignal): Promise<string> {
    const staging = join(root, `.prepare-${randomBytes(8).toString('hex')}`);
    try {
      if (platform !== 'darwin') throw new Error('managed adb is available only on macOS');
      if (signal?.aborted === true) throw new Error('phone support preparation was cancelled');
      mkdirSync(staging, { recursive: true });
      const zipPath = join(staging, 'platform-tools.zip');
      const signals = [AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)];
      if (signal !== undefined) signals.push(signal);
      const response = await fetchImpl(artifact.url, { signal: AbortSignal.any(signals) });
      if (!response.ok) throw new Error(`platform-tools download failed: HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (sha256Bytes(bytes) !== artifact.zipSha256)
        throw new Error('platform-tools hash mismatch');
      writeFileSync(zipPath, bytes);
      await extractZip(zipPath, staging, signal);
      const stagedAdb = join(staging, 'platform-tools', 'adb');
      if (!regularFile(stagedAdb) || sha256File(stagedAdb) !== artifact.adbSha256)
        throw new Error('extracted adb hash mismatch');
      chmodSync(stagedAdb, 0o755);
      writeFileSync(
        join(staging, 'platform-tools', '.cairn-phone-adb.json'),
        JSON.stringify({
          url: artifact.url,
          zipSha256: artifact.zipSha256,
          adbSha256: artifact.adbSha256,
        }),
      );
      rmSync(target, { recursive: true, force: true });
      await rename(join(staging, 'platform-tools'), target);
      return adbPath;
    } catch (error) {
      log(`${PREPARATION_ERROR}: ${error instanceof Error ? error.message : String(error)}`);
      throw new Error(PREPARATION_ERROR);
    } finally {
      await rm(staging, { recursive: true, force: true }).catch(() => {});
    }
  }

  async function detectExisting(signal?: AbortSignal): Promise<string | null> {
    const existing = findAdbImpl(env);
    if (existing !== null && (await compatible(existing, signal))) return existing;
    return managedCache();
  }

  return {
    detectExisting,
    async ensure(signal) {
      const existing = await detectExisting(signal);
      if (existing !== null) return existing;
      preparing ??= prepare(signal).finally(() => {
        preparing = null;
      });
      return preparing;
    },
  };
}
