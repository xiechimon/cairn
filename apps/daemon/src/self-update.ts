import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  accessSync,
  constants,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  isServerVersionNewer,
  isValidSemverVersion,
  type RunnerAutoUpdateReason,
  type RunnerAutoUpdateReport,
  type RunnerAutoUpdateState,
  resolveUpdateFeedBase,
  runnerPlatformKey,
  runnerReleaseManifestSchema,
  runnerUpdateFrom,
} from '@cairn/shared';
import { DAEMON_BUILD_RELEASE_VERSION } from './build-info.js';

const execFileAsync = promisify(execFile);

export const SELF_UPDATE_EXIT_CODE = 75;
export const RUNNER_SELF_UPDATE_BACKOFF_MS = 30 * 60_000;
export const RUNNER_SELF_UPDATE_DRAIN_CAP_MS = 30 * 60_000;
export const RUNNER_PROBATION_SUSTAINED_MS = 30_000;
export const RUNNER_PREBOOT_DEADLINE_MS = 60_000;

export interface SelfUpdateNotice {
  failedVersion: string;
  restoredVersion: string;
  reason: string;
  at: number;
}

export interface SelfUpdateDiskState {
  activeVersion: string | null;
  previousVersion: string | null;
  pending: string | null;
  blocked: Record<string, { at: number; reason: string }>;
  notice: SelfUpdateNotice | null;
}

export interface SelfUpdateHealthyRecord {
  attemptId: string;
  version: string;
  status: 'booted' | 'confirmed';
  at: number;
}

export type RunnerInstallClassification =
  | { supported: true; reason: null }
  | {
      supported: false;
      reason: 'desktop-bundled' | 'homebrew' | 'docker' | 'development' | 'read-only';
    };

export function selfUpdatePaths(cairnHome: string) {
  const root = join(cairnHome, 'self-update');
  return {
    root,
    versionsDir: join(root, 'versions'),
    stateFile: join(root, 'state.json'),
    healthyFile: join(root, 'healthy.json'),
  };
}

export function currentRunnerPlatformKey(
  platform: string = process.platform,
  arch: string = process.arch,
): string {
  return runnerPlatformKey(platform, arch);
}

export function readRunnerReleaseVersion(
  env: NodeJS.ProcessEnv = process.env,
  fallbackVersion: string | null = DAEMON_BUILD_RELEASE_VERSION,
): string | null {
  const fromEnv = env.CAIRN_RUNNER_RELEASE_VERSION?.trim();
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv;
  if (fallbackVersion !== null && fallbackVersion !== '' && fallbackVersion !== '0.0.0') {
    return fallbackVersion;
  }
  return null;
}

export function emptySelfUpdateState(): SelfUpdateDiskState {
  return {
    activeVersion: null,
    previousVersion: null,
    pending: null,
    blocked: {},
    notice: null,
  };
}

export function readSelfUpdateState(cairnHome: string): SelfUpdateDiskState {
  const { stateFile } = selfUpdatePaths(cairnHome);
  if (!existsSync(stateFile)) return emptySelfUpdateState();
  try {
    const raw = JSON.parse(readFileSync(stateFile, 'utf8')) as Partial<SelfUpdateDiskState>;
    const blocked: Record<string, { at: number; reason: string }> = {};
    if (raw.blocked !== null && typeof raw.blocked === 'object' && !Array.isArray(raw.blocked)) {
      for (const [k, v] of Object.entries(raw.blocked)) {
        if (
          v !== null &&
          typeof v === 'object' &&
          typeof v.at === 'number' &&
          typeof v.reason === 'string'
        ) {
          blocked[k] = { at: v.at, reason: v.reason };
        }
      }
    }
    const notice =
      raw.notice !== null &&
      typeof raw.notice === 'object' &&
      typeof raw.notice.failedVersion === 'string' &&
      typeof raw.notice.restoredVersion === 'string' &&
      typeof raw.notice.reason === 'string' &&
      typeof raw.notice.at === 'number'
        ? raw.notice
        : null;
    return {
      activeVersion:
        typeof raw.activeVersion === 'string' && raw.activeVersion !== ''
          ? raw.activeVersion
          : null,
      previousVersion:
        typeof raw.previousVersion === 'string' && raw.previousVersion !== ''
          ? raw.previousVersion
          : null,
      pending: typeof raw.pending === 'string' && raw.pending !== '' ? raw.pending : null,
      blocked,
      notice,
    };
  } catch {
    return emptySelfUpdateState();
  }
}

function writeJson0600(filePath: string, data: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  renameSync(tempPath, filePath);
}

export function writeSelfUpdateState(cairnHome: string, state: SelfUpdateDiskState): void {
  writeJson0600(selfUpdatePaths(cairnHome).stateFile, state);
}

export function readHealthyRecord(cairnHome: string): SelfUpdateHealthyRecord | null {
  const { healthyFile } = selfUpdatePaths(cairnHome);
  if (!existsSync(healthyFile)) return null;
  try {
    const raw = JSON.parse(readFileSync(healthyFile, 'utf8')) as Partial<SelfUpdateHealthyRecord>;
    if (
      typeof raw.attemptId === 'string' &&
      typeof raw.version === 'string' &&
      (raw.status === 'booted' || raw.status === 'confirmed') &&
      typeof raw.at === 'number'
    ) {
      return raw as SelfUpdateHealthyRecord;
    }
    return null;
  } catch {
    return null;
  }
}

export function writeHealthyRecord(cairnHome: string, record: SelfUpdateHealthyRecord): void {
  writeJson0600(selfUpdatePaths(cairnHome).healthyFile, record);
}

export function clearHealthyRecord(cairnHome: string): void {
  const { healthyFile } = selfUpdatePaths(cairnHome);
  rmSync(healthyFile, { force: true });
}

function defaultWritableCheck(dirPath: string): boolean {
  let probe = resolve(dirPath);
  while (!existsSync(probe)) {
    const parent = dirname(probe);
    if (parent === probe) return false;
    probe = parent;
  }
  try {
    accessSync(probe, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export function classifyRunnerInstall(opts: {
  cairnHome: string;
  scriptPath: string;
  env?: NodeJS.ProcessEnv;
  isWritable?: (path: string) => boolean;
}): RunnerInstallClassification {
  const env = opts.env ?? process.env;
  const normalizedScript = opts.scriptPath.replaceAll('\\', '/');
  if (
    env.CAIRN_DESKTOP_BUNDLED === '1' ||
    normalizedScript.includes('.app/Contents/') ||
    normalizedScript.toLowerCase().includes('/resources/runner/')
  ) {
    return { supported: false, reason: 'desktop-bundled' };
  }
  if (env.CAIRN_DOCKER === '1' || env.container === 'docker' || existsSync('/.dockerenv')) {
    return { supported: false, reason: 'docker' };
  }
  if (
    normalizedScript.startsWith('/opt/homebrew/') ||
    normalizedScript.startsWith('/home/linuxbrew/.linuxbrew/') ||
    normalizedScript.includes('/Cellar/') ||
    normalizedScript.includes('/homebrew/')
  ) {
    return { supported: false, reason: 'homebrew' };
  }
  if (
    env.VITEST !== undefined ||
    env.NODE_ENV === 'test' ||
    normalizedScript.includes('/vitest/') ||
    normalizedScript.endsWith('.ts') ||
    normalizedScript.includes('/apps/daemon/src/')
  ) {
    return { supported: false, reason: 'development' };
  }
  const { versionsDir } = selfUpdatePaths(opts.cairnHome);
  const checkWritable = opts.isWritable ?? defaultWritableCheck;
  if (env.CAIRN_RUNNER_READ_ONLY === '1') {
    return { supported: false, reason: 'read-only' };
  }
  const insideSlot = resolve(opts.scriptPath).startsWith(`${resolve(versionsDir)}/`);
  const scriptParent = dirname(opts.scriptPath);
  const canWrite =
    checkWritable(versionsDir) &&
    (insideSlot || env.CAIRN_SELF_UPDATE_WRITABLE === '1' || checkWritable(scriptParent));
  if (!canWrite) {
    return { supported: false, reason: 'read-only' };
  }
  return { supported: true, reason: null };
}

export function syncBaseBinaryOverride(
  cairnHome: string,
  baseReleaseVersion: string | null,
): SelfUpdateDiskState {
  const state = readSelfUpdateState(cairnHome);
  if (baseReleaseVersion === null || state.activeVersion === null) return state;
  if (
    baseReleaseVersion === state.activeVersion ||
    isServerVersionNewer(baseReleaseVersion, state.activeVersion)
  ) {
    const keepPending =
      state.pending !== null && isServerVersionNewer(state.pending, baseReleaseVersion)
        ? state.pending
        : null;
    const next: SelfUpdateDiskState = {
      ...state,
      activeVersion: null,
      pending: keepPending,
      notice: null,
    };
    writeSelfUpdateState(cairnHome, next);
    return next;
  }
  return state;
}

export function resolveSlotEntryPath(slotDir: string): string | null {
  const nested = join(slotDir, 'dist', 'cli.mjs');
  if (existsSync(nested)) return nested;
  const flat = join(slotDir, 'cli.mjs');
  if (existsSync(flat)) return flat;
  return null;
}

export function pruneOldVersionSlots(cairnHome: string, keepVersions: ReadonlySet<string>): void {
  const { versionsDir } = selfUpdatePaths(cairnHome);
  if (!existsSync(versionsDir)) return;
  for (const name of readdirSync(versionsDir)) {
    if (name.startsWith('.staging-') || !keepVersions.has(name)) {
      rmSync(join(versionsDir, name), { recursive: true, force: true });
    }
  }
}

export function isRunnerWorkIdle(opts: {
  inFlightSteps: number;
  pendingUploads: ReadonlyArray<{ state: string; stepId: string }>;
  strandedAttempts: ReadonlyMap<string, number>;
  maxStrandedAttempts: number;
  activeAntigravityVerifies: number;
  activeComputerCalls: number;
  activeScreens: number;
}): boolean {
  if (opts.inFlightSteps > 0) return false;
  if (opts.activeAntigravityVerifies > 0) return false;
  if (opts.activeComputerCalls > 0) return false;
  if (opts.activeScreens > 0) return false;
  for (const entry of opts.pendingUploads) {
    if (entry.state !== 'awaiting-upload') continue;
    const attempts = opts.strandedAttempts.get(entry.stepId) ?? 0;
    if (attempts <= opts.maxStrandedAttempts) return false;
  }
  return true;
}

function assertSafeArchiveEntry(entryName: string, extractRoot: string): string {
  const normalized = entryName.replaceAll('\\', '/');
  if (
    normalized.startsWith('/') ||
    /^[A-Za-z]:/.test(normalized) ||
    normalized.split('/').includes('..')
  ) {
    throw new Error(`unsafe archive entry path: ${entryName}`);
  }
  const resolvedEntry = resolve(extractRoot, normalized);
  const rel = relative(extractRoot, resolvedEntry);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`archive entry escapes destination: ${entryName}`);
  }
  return resolvedEntry;
}

async function verifyTarSafety(archivePath: string, extractRoot: string): Promise<void> {
  const { stdout } = await execFileAsync('tar', ['-tvzf', archivePath], {
    maxBuffer: 8 * 1024 * 1024,
  });
  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '') continue;
    const parts = line.split(/\s+/);
    const mode = parts[0] ?? '';
    const arrowIndex = line.indexOf(' -> ');
    const entryName =
      arrowIndex !== -1
        ? (line.slice(0, arrowIndex).split(/\s+/).at(-1) ?? '')
        : (parts.at(-1) ?? '');
    const resolvedEntry = assertSafeArchiveEntry(entryName, extractRoot);
    if (mode.startsWith('l') && arrowIndex !== -1) {
      const linkTarget = line.slice(arrowIndex + 4).trim();
      if (isAbsolute(linkTarget)) {
        throw new Error(`absolute symlink target in archive: ${linkTarget}`);
      }
      const resolvedLink = resolve(dirname(resolvedEntry), linkTarget);
      const linkRel = relative(extractRoot, resolvedLink);
      if (linkRel.startsWith('..') || isAbsolute(linkRel)) {
        throw new Error(`symlink target escapes destination: ${linkTarget}`);
      }
    }
  }
}

async function extractRunnerArchive(archivePath: string, extractDir: string): Promise<void> {
  if (archivePath.endsWith('.tar.gz')) {
    await verifyTarSafety(archivePath, extractDir);
    await execFileAsync('tar', ['-xzf', archivePath, '-C', extractDir]);
    return;
  }
  if (process.platform === 'win32') {
    const psScript = [
      'Add-Type -AssemblyName System.IO.Compression.FileSystem;',
      '$z = [System.IO.Compression.ZipFile]::OpenRead($env:ARCHIVE_SRC);',
      'try { $z.Entries | ForEach-Object { $_.FullName } } finally { $z.Dispose() }',
    ].join(' ');
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', psScript],
      {
        env: { ...process.env, ARCHIVE_SRC: archivePath },
        maxBuffer: 8 * 1024 * 1024,
      },
    );
    for (const rawLine of stdout.split(/\r?\n/)) {
      const entry = rawLine.trim();
      if (entry !== '') assertSafeArchiveEntry(entry, extractDir);
    }
    await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Expand-Archive -LiteralPath $env:ARCHIVE_SRC -DestinationPath $env:ARCHIVE_DST -Force',
      ],
      { env: { ...process.env, ARCHIVE_SRC: archivePath, ARCHIVE_DST: extractDir } },
    );
    return;
  }
  const { stdout } = await execFileAsync('unzip', ['-Z1', archivePath], {
    maxBuffer: 8 * 1024 * 1024,
  });
  for (const rawLine of stdout.split(/\r?\n/)) {
    const entry = rawLine.trim();
    if (entry !== '') assertSafeArchiveEntry(entry, extractDir);
  }
  if (process.platform === 'darwin') {
    await execFileAsync('/usr/bin/ditto', ['-x', '-k', archivePath, extractDir]);
  } else {
    await execFileAsync('unzip', ['-q', archivePath, '-d', extractDir]);
  }
}

function readSlotVerifiedMarker(slotDir: string): { version: string; sha256: string } | null {
  const markerPath = join(slotDir, '.verified.json');
  if (!existsSync(markerPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(markerPath, 'utf8')) as {
      version?: unknown;
      sha256?: unknown;
    };
    if (typeof parsed.version === 'string' && typeof parsed.sha256 === 'string') {
      return { version: parsed.version, sha256: parsed.sha256 };
    }
    return null;
  } catch {
    return null;
  }
}

async function downloadAndVerifyArchive(opts: {
  url: string;
  size: number;
  sha256: string;
  destPath: string;
  fetchImpl: typeof fetch;
  signal?: AbortSignal;
}): Promise<void> {
  const res = await opts.fetchImpl(opts.url, {
    headers: { 'User-Agent': 'Cairn-Runner' },
    signal: opts.signal,
  });
  if (!res.ok || res.body === null) {
    throw new Error(`download failed HTTP ${res.status}`);
  }
  const hash = createHash('sha256');
  const file = createWriteStream(opts.destPath, { mode: 0o600 });
  let bytes = 0;
  for await (const chunk of res.body) {
    hash.update(chunk);
    bytes += chunk.byteLength;
    if (!file.write(chunk)) {
      await new Promise<void>((r) => file.once('drain', r));
    }
  }
  await new Promise<void>((resolveEnd, rejectEnd) =>
    file.end((err?: Error | null) => (err ? rejectEnd(err) : resolveEnd())),
  );
  if (bytes !== opts.size || hash.digest('hex') !== opts.sha256) {
    const err = new Error('checksum-mismatch');
    err.name = 'ChecksumMismatchError';
    throw err;
  }
}

async function smokeTestSlot(cliPath: string): Promise<void> {
  try {
    await execFileAsync(process.execPath, [cliPath, '--version'], {
      timeout: 10_000,
      env: { ...process.env, CAIRN_SELF_UPDATE_CHILD: '1' },
    });
  } catch (error) {
    const err = new Error(
      `smoke test failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    err.name = 'SmokeTestFailedError';
    throw err;
  }
}

export interface RunnerSelfUpdater {
  report(): RunnerAutoUpdateReport;
  notifyUpdateAvailable(targetVersion: string): Promise<void>;
  tickDrain(): Promise<void>;
  markBooted(): void;
  recordPresenceResult(ok: boolean): void;
  stop(): void;
}

export function createRunnerSelfUpdater(opts: {
  cairnHome: string;
  currentVersion: string | null;
  scriptPath?: string;
  install?: RunnerInstallClassification;
  attemptId?: string | null;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  now?: () => number;
  isIdle: () => boolean;
  pauseClaims: () => void;
  resumeClaims: () => void;
  exitForSwap: (code: number) => void;
  drainCapMs?: number;
  probationMs?: number;
  onStateChange?: () => void;
  log?: (line: string) => void;
}): RunnerSelfUpdater {
  const env = opts.env ?? process.env;
  const fetchFn = opts.fetchImpl ?? globalThis.fetch;
  const now = opts.now ?? Date.now;
  const scriptPath = opts.scriptPath ?? process.argv[1] ?? '';
  const install =
    opts.install ?? classifyRunnerInstall({ cairnHome: opts.cairnHome, scriptPath, env });
  const drainCapMs = opts.drainCapMs ?? RUNNER_SELF_UPDATE_DRAIN_CAP_MS;
  const probationMs = opts.probationMs ?? RUNNER_PROBATION_SUSTAINED_MS;

  let state: RunnerAutoUpdateState = install.supported ? 'idle' : 'unsupported';
  let targetVersion: string | null = null;
  let reason: RunnerAutoUpdateReason | null = install.supported ? null : install.reason;
  let stagedVersion: string | null = null;
  let drainStartedAt: number | null = null;
  let drainTimer: ReturnType<typeof setInterval> | null = null;
  let stagingTask: Promise<void> | null = null;
  let stopped = false;
  const backoffUntil = new Map<string, number>();

  const attemptId = opts.attemptId ?? env.CAIRN_SELF_UPDATE_ATTEMPT ?? null;
  const attemptTarget = env.CAIRN_SELF_UPDATE_TARGET ?? opts.currentVersion;
  let bootedAt: number | null = null;
  let healthySince: number | null = null;
  let probationConfirmed = false;

  async function stageVersion(version: string): Promise<void> {
    if (!isValidSemverVersion(version)) return;
    state = 'downloading';
    targetVersion = version;
    reason = null;
    opts.onStateChange?.();
    const { versionsDir } = selfUpdatePaths(opts.cairnHome);
    const destDir = join(versionsDir, version);
    const { releasesBase, runnerManifestUrl } = resolveUpdateFeedBase(env);
    const stagingDir = join(versionsDir, `.staging-${version}-${now()}`);
    try {
      const manifestRes = await fetchFn(runnerManifestUrl, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(15_000),
      });
      if (!manifestRes.ok) {
        reason = 'offline';
        state = 'failed';
        backoffUntil.set(version, now() + RUNNER_SELF_UPDATE_BACKOFF_MS);
        return;
      }
      const parsedManifest = runnerReleaseManifestSchema.safeParse(await manifestRes.json());
      if (!parsedManifest.success) {
        reason = 'failed';
        state = 'failed';
        backoffUntil.set(version, now() + RUNNER_SELF_UPDATE_BACKOFF_MS);
        return;
      }
      const asset = runnerUpdateFrom(
        parsedManifest.data,
        opts.currentVersion,
        process.arch,
        process.platform,
        releasesBase,
      );
      if (asset === null || asset.version !== version) {
        reason = 'no-asset';
        state = 'failed';
        backoffUntil.set(version, now() + RUNNER_SELF_UPDATE_BACKOFF_MS);
        return;
      }
      const existingMarker = readSlotVerifiedMarker(destDir);
      if (
        existingMarker !== null &&
        existingMarker.version === version &&
        existingMarker.sha256 === asset.sha256 &&
        resolveSlotEntryPath(destDir) !== null
      ) {
        stagedVersion = version;
        enterDrain();
        return;
      }
      mkdirSync(stagingDir, { recursive: true, mode: 0o700 });
      const archivePath = join(stagingDir, asset.name);
      await downloadAndVerifyArchive({
        url: asset.url,
        size: asset.size,
        sha256: asset.sha256,
        destPath: archivePath,
        fetchImpl: fetchFn,
        signal: AbortSignal.timeout(120_000),
      });
      const extractDir = join(stagingDir, 'root');
      mkdirSync(extractDir, { recursive: true, mode: 0o700 });
      await extractRunnerArchive(archivePath, extractDir);
      const cliEntry = resolveSlotEntryPath(extractDir);
      if (cliEntry === null) {
        throw new Error('runner archive missing cli.mjs entry');
      }
      await smokeTestSlot(cliEntry);
      writeJson0600(join(extractDir, '.verified.json'), {
        version,
        sha256: asset.sha256,
        verifiedAt: now(),
      });
      rmSync(destDir, { recursive: true, force: true });
      renameSync(extractDir, destDir);
      rmSync(stagingDir, { recursive: true, force: true });
      stagedVersion = version;
      enterDrain();
    } catch (error) {
      rmSync(stagingDir, { recursive: true, force: true });
      if (error instanceof Error && error.name === 'ChecksumMismatchError') {
        reason = 'checksum-mismatch';
      } else if (error instanceof Error && error.name === 'SmokeTestFailedError') {
        reason = 'smoke-failed';
      } else {
        reason = 'failed';
      }
      state = 'failed';
      targetVersion = version;
      backoffUntil.set(version, now() + RUNNER_SELF_UPDATE_BACKOFF_MS);
      opts.log?.(
        `self-update stage failed for ${version}: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      if (state === 'failed') opts.onStateChange?.();
    }
  }

  function enterDrain(): void {
    if (stopped || stagedVersion === null) return;
    state = 'waiting-idle';
    targetVersion = stagedVersion;
    reason = null;
    drainStartedAt ??= now();
    opts.pauseClaims();
    opts.onStateChange?.();
    if (drainTimer === null) {
      drainTimer = setInterval(() => {
        void tickDrain();
      }, 500);
      drainTimer.unref?.();
    }
  }

  async function tickDrain(): Promise<void> {
    if (stopped || stagedVersion === null || state !== 'waiting-idle') return;
    const elapsed = drainStartedAt === null ? 0 : now() - drainStartedAt;
    if (!opts.isIdle()) {
      if (elapsed < drainCapMs) return;
      if (drainTimer !== null) {
        clearInterval(drainTimer);
        drainTimer = null;
      }
      const deferredVersion = stagedVersion;
      stagedVersion = null;
      drainStartedAt = null;
      state = 'idle';
      targetVersion = null;
      reason = null;
      backoffUntil.set(deferredVersion, now() + RUNNER_SELF_UPDATE_BACKOFF_MS);
      opts.resumeClaims();
      opts.onStateChange?.();
      opts.log?.(
        `runner self-update deferred ${deferredVersion}: work remained active after drain cap`,
      );
      return;
    }
    if (drainTimer !== null) {
      clearInterval(drainTimer);
      drainTimer = null;
    }
    state = 'swapping';
    const current = readSelfUpdateState(opts.cairnHome);
    writeSelfUpdateState(opts.cairnHome, {
      ...current,
      pending: stagedVersion,
    });
    opts.log?.(`runner self-update swapping to ${stagedVersion}`);
    opts.exitForSwap(SELF_UPDATE_EXIT_CODE);
  }

  return {
    report(): RunnerAutoUpdateReport {
      if (!install.supported) {
        return { supported: false, state: 'unsupported', reason: install.reason };
      }
      const disk = readSelfUpdateState(opts.cairnHome);
      if (state === 'idle' && disk.notice !== null) {
        return {
          supported: true,
          state: 'rolled-back',
          reason: 'blocked',
          failedVersion: disk.notice.failedVersion,
          restoredVersion: disk.notice.restoredVersion,
        };
      }
      return {
        supported: true,
        state,
        ...(targetVersion !== null ? { targetVersion } : {}),
        ...(reason !== null ? { reason } : {}),
      };
    },
    async notifyUpdateAvailable(nextVersion: string): Promise<void> {
      if (!install.supported || stopped) return;
      if (!isValidSemverVersion(nextVersion)) return;
      if (state === 'waiting-idle' || state === 'swapping') return;
      const disk = readSelfUpdateState(opts.cairnHome);
      if (disk.blocked[nextVersion] !== undefined) return;
      const backoff = backoffUntil.get(nextVersion);
      if (backoff !== undefined && now() < backoff) return;
      if (opts.currentVersion !== null && !isServerVersionNewer(nextVersion, opts.currentVersion)) {
        return;
      }
      if (stagingTask !== null) {
        await stagingTask;
        return;
      }
      stagingTask = stageVersion(nextVersion).finally(() => {
        stagingTask = null;
      });
      await stagingTask;
    },
    tickDrain,
    markBooted(): void {
      if (attemptId === null || attemptTarget === null || bootedAt !== null) return;
      bootedAt = now();
      writeHealthyRecord(opts.cairnHome, {
        attemptId,
        version: attemptTarget,
        status: 'booted',
        at: bootedAt,
      });
    },
    recordPresenceResult(ok: boolean): void {
      if (attemptId === null || attemptTarget === null || probationConfirmed) return;
      if (!ok) {
        healthySince = null;
        return;
      }
      const ts = now();
      if (bootedAt === null) {
        bootedAt = ts;
        writeHealthyRecord(opts.cairnHome, {
          attemptId,
          version: attemptTarget,
          status: 'booted',
          at: ts,
        });
      }
      healthySince ??= ts;
      if (ts - healthySince >= probationMs) {
        probationConfirmed = true;
        writeHealthyRecord(opts.cairnHome, {
          attemptId,
          version: attemptTarget,
          status: 'confirmed',
          at: ts,
        });
      }
    },
    stop(): void {
      stopped = true;
      if (drainTimer !== null) {
        clearInterval(drainTimer);
        drainTimer = null;
      }
      opts.resumeClaims();
    },
  };
}
