import { createHash, randomUUID } from 'node:crypto';
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { isAbsolute, join } from 'node:path';
import {
  compareManagedVersions,
  isNewerManagedVersion,
  type ManagedUpdateRuntime,
  type RuntimeUpdateStatus,
} from '@cairn/shared';
import { unsafeManagedVersion } from '@cairn/shared/managed-bin';
import { z } from 'zod';
import { ensurePrivateDir } from '../private-fs.js';
import { contains } from './confine.js';

const LOCK_STALE_MS = 15 * 60_000;
export const DEFAULT_UPDATE_CHECK_INTERVAL_MS = 60 * 60_000;
export const PROVIDER_UPDATE_CHECKS_ENV = 'CAIRN_PROVIDER_UPDATE_CHECKS';

const installMarkerSchema = z.object({
  version: z.string(),
  url: z.string(),
  archiveSha256: z.string().optional(),
  tarballSha1: z.string().optional(),
  binRelPath: z.string(),
  binSha256: z.string(),
  args: z.array(z.string()).default([]),
  installedAt: z.number(),
});
type InstallMarker = z.infer<typeof installMarkerSchema>;

export interface ManagedRuntimeInstall {
  version: string;
  command: string;
  args: string[];
  binPath: string;
  versionDir: string | null;
  source: 'managed' | 'bundled' | 'override';
  home?: string;
}

export interface ManagedRuntimeLease extends ManagedRuntimeInstall {
  release(): void;
}

export interface ManagedRuntimeSeed {
  version: string | null;
  command: string;
  args: string[];
  binPath: string;
  source: 'bundled' | 'override';
}

export interface ManagedRuntimeRelease {
  version: string;
  url: string;
}

export interface ManagedRuntimeStaged {
  binRelPath: string;
  args: string[];
  archiveSha256?: string;
  tarballSha1?: string;
}

export interface ManagedRuntimeValidationInput {
  version: string;
  stagingDir: string;
  binPath: string;
  command: string;
  args: string[];
}

export type ManagedRuntimeValidationResult = { ok: true } | { ok: false; reason: string };

export interface ManagedRuntimeChannelContext {
  root: string;
  fetchImpl: typeof fetch;
  log: (message: string) => void;
}

export interface ManagedRuntimeChannel<
  TRelease extends ManagedRuntimeRelease = ManagedRuntimeRelease,
> {
  readonly id: ManagedUpdateRuntime;
  readonly defaultArgs: readonly string[];
  resolveRelease(
    ctx: ManagedRuntimeChannelContext,
    opts?: { useCache?: boolean },
  ): Promise<TRelease | null>;
  stage(
    release: TRelease,
    stagingDir: string,
    ctx: ManagedRuntimeChannelContext,
  ): Promise<ManagedRuntimeStaged>;
  launchFor(binPath: string, args: readonly string[]): { command: string; args: string[] };
  validate(
    staged: ManagedRuntimeValidationInput,
    ctx: ManagedRuntimeChannelContext,
  ): Promise<ManagedRuntimeValidationResult>;
}

export interface ManagedRuntime {
  current(): ManagedRuntimeInstall | null;
  acquire(): ManagedRuntimeLease | null;
  status(): RuntimeUpdateStatus;
  ensure(): Promise<ManagedRuntimeInstall | null>;
  checkForUpdate(opts?: { force?: boolean }): Promise<RuntimeUpdateStatus>;
  update(): Promise<ManagedRuntimeInstall | null>;
}

export interface ManagedRuntimeOptions {
  root: string;
  home?: string;
  fetchImpl?: typeof fetch;
  log?: (message: string) => void;
  updateChecksEnabled?: () => boolean;
  checkIntervalMs?: number;
  resolveSeed?: () => ManagedRuntimeSeed | null;
  onChange?: () => void;
  now?: () => number;
  validateOverride?: (
    staged: ManagedRuntimeValidationInput,
  ) => Promise<ManagedRuntimeValidationResult>;
}

export function defaultUpdateChecksEnabled(): boolean {
  return process.env[PROVIDER_UPDATE_CHECKS_ENV] !== '0';
}

export function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function markerOf(versionDir: string): InstallMarker | null {
  try {
    return installMarkerSchema.parse(
      JSON.parse(readFileSync(join(versionDir, '.install-complete'), 'utf8')),
    );
  } catch {
    return null;
  }
}

function invalidRelativePath(relPath: string): boolean {
  return (
    relPath === '' ||
    isAbsolute(relPath) ||
    relPath.startsWith('/') ||
    relPath.startsWith('\\') ||
    relPath.split(/[/\\]/).includes('..')
  );
}

export function createManagedRuntime<TRelease extends ManagedRuntimeRelease>(
  channel: ManagedRuntimeChannel<TRelease>,
  options: ManagedRuntimeOptions,
): ManagedRuntime {
  const { root } = options;
  const fetchImpl = options.fetchImpl ?? fetch;
  const log = options.log ?? (() => {});
  const updateChecksEnabled = options.updateChecksEnabled ?? defaultUpdateChecksEnabled;
  const checkIntervalMs = options.checkIntervalMs ?? DEFAULT_UPDATE_CHECK_INTERVAL_MS;
  const now = options.now ?? (() => Date.now());
  const ctx: ManagedRuntimeChannelContext = { root, fetchImpl, log };

  const leases = new Map<string, number>();
  let availableVersion: string | null = null;
  let phase: 'idle' | 'updating' | 'failed' = 'idle';
  let lastCheckedAt = 0;
  let pendingEnsure: Promise<ManagedRuntimeInstall | null> | null = null;
  let pendingCheck: Promise<RuntimeUpdateStatus> | null = null;
  let pendingUpdate: Promise<ManagedRuntimeInstall | null> | null = null;

  function installFor(versionDir: string): ManagedRuntimeInstall | null {
    const marker = markerOf(versionDir);
    if (marker === null || invalidRelativePath(marker.binRelPath)) return null;
    const binPath = join(versionDir, marker.binRelPath);
    try {
      if (!contains(realpathSync(versionDir), realpathSync(binPath))) return null;
      if (sha256File(binPath) !== marker.binSha256.toLowerCase()) return null;
    } catch {
      return null;
    }
    if (options.home !== undefined) ensurePrivateDir(options.home);
    const launch = channel.launchFor(binPath, marker.args);
    return {
      version: marker.version,
      command: launch.command,
      args: launch.args,
      binPath,
      versionDir,
      source: 'managed',
      ...(options.home !== undefined ? { home: options.home } : {}),
    };
  }

  function managedCurrent(): ManagedRuntimeInstall | null {
    try {
      const pointer = JSON.parse(readFileSync(join(root, 'current.json'), 'utf8')) as {
        version?: unknown;
      };
      if (typeof pointer.version === 'string' && !unsafeManagedVersion(pointer.version)) {
        const found = installFor(join(root, 'versions', pointer.version));
        if (found !== null) return found;
      }
    } catch {}
    const versionsDir = join(root, 'versions');
    try {
      const versions = readdirSync(versionsDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !unsafeManagedVersion(entry.name))
        .map((entry) => entry.name)
        .sort((a, b) => compareManagedVersions(b, a));
      for (const version of versions) {
        const found = installFor(join(versionsDir, version));
        if (found !== null) return found;
      }
    } catch {}
    return null;
  }

  function current(): ManagedRuntimeInstall | null {
    const seed = options.resolveSeed?.() ?? null;
    if (seed?.source === 'override') {
      return {
        version: seed.version ?? '',
        command: seed.command,
        args: [...seed.args],
        binPath: seed.binPath,
        versionDir: null,
        source: 'override',
        ...(options.home !== undefined ? { home: options.home } : {}),
      };
    }
    const managed = managedCurrent();
    if (
      managed !== null &&
      (seed === null ||
        seed.version === null ||
        isNewerManagedVersion(managed.version, seed.version))
    ) {
      return managed;
    }
    if (seed !== null) {
      return {
        version: seed.version ?? '',
        command: seed.command,
        args: [...seed.args],
        binPath: seed.binPath,
        versionDir: null,
        source: 'bundled',
        ...(options.home !== undefined ? { home: options.home } : {}),
      };
    }
    return managed;
  }

  function pruneInactiveVersions(): void {
    const activeDir = managedCurrent()?.versionDir;
    const versionsDir = join(root, 'versions');
    let entries: string[];
    try {
      entries = readdirSync(versionsDir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const dir = join(versionsDir, entry);
      if (dir === activeDir) continue;
      if ((leases.get(dir) ?? 0) > 0) continue;
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {}
    }
  }

  function acquire(): ManagedRuntimeLease | null {
    const install = current();
    if (install === null) return null;
    const leasedDir = install.versionDir;
    if (leasedDir !== null) {
      leases.set(leasedDir, (leases.get(leasedDir) ?? 0) + 1);
    }
    let released = false;
    return {
      ...install,
      release() {
        if (released) return;
        released = true;
        if (leasedDir === null) return;
        const remaining = (leases.get(leasedDir) ?? 1) - 1;
        if (remaining > 0) {
          leases.set(leasedDir, remaining);
          return;
        }
        leases.delete(leasedDir);
        if (leasedDir !== managedCurrent()?.versionDir) {
          pruneInactiveVersions();
        }
      },
    };
  }

  function status(): RuntimeUpdateStatus {
    const active = current();
    const installedVersion = active !== null && active.version !== '' ? active.version : null;
    const available =
      active?.source === 'override' || availableVersion === null
        ? null
        : installedVersion === null || isNewerManagedVersion(availableVersion, installedVersion)
          ? availableVersion
          : null;
    return {
      installedVersion,
      availableVersion: available,
      phase,
    };
  }

  function writeCurrentPointer(version: string): void {
    mkdirSync(root, { recursive: true });
    const tmp = join(root, `.current-${randomUUID()}.tmp`);
    writeFileSync(tmp, `${JSON.stringify({ version })}\n`, { mode: 0o600 });
    renameSync(tmp, join(root, 'current.json'));
  }

  async function withLock<T>(
    fn: () => Promise<T>,
  ): Promise<{ acquired: true; value: T } | { acquired: false }> {
    const lock = join(root, '.install.lock');
    const owner = randomUUID();
    const ownerFile = join(lock, 'owner');
    mkdirSync(root, { recursive: true });
    try {
      try {
        if (now() - statSync(lock).mtimeMs > LOCK_STALE_MS) {
          const evicted = join(root, `.install.lock.stale-${randomUUID()}`);
          renameSync(lock, evicted);
          rmSync(evicted, { recursive: true, force: true });
        }
      } catch {}
      mkdirSync(lock);
      writeFileSync(ownerFile, owner, { mode: 0o600 });
    } catch {
      return { acquired: false };
    }
    try {
      return { acquired: true, value: await fn() };
    } finally {
      try {
        if (readFileSync(ownerFile, 'utf8') === owner) {
          rmSync(lock, { recursive: true, force: true });
        }
      } catch {}
    }
  }

  async function validateStaged(
    input: ManagedRuntimeValidationInput,
  ): Promise<ManagedRuntimeValidationResult> {
    if (options.validateOverride !== undefined) return options.validateOverride(input);
    return channel.validate(input, ctx);
  }

  async function stageAndActivate(
    release: TRelease,
  ): Promise<{ ok: true; install: ManagedRuntimeInstall } | { ok: false; error: string }> {
    if (unsafeManagedVersion(release.version)) {
      return { ok: false, error: `${channel.id} release version is unsafe: ${release.version}` };
    }
    const versionDir = join(root, 'versions', release.version);
    const existing = installFor(versionDir);
    if (existing !== null) {
      const checked = await validateStaged({
        version: release.version,
        stagingDir: versionDir,
        binPath: existing.binPath,
        command: existing.command,
        args: existing.args,
      });
      if (!checked.ok) {
        return { ok: false, error: checked.reason };
      }
      writeCurrentPointer(release.version);
      pruneInactiveVersions();
      return { ok: true, install: existing };
    }

    mkdirSync(root, { recursive: true });
    const staging = mkdtempSync(join(root, '.staging-'));
    try {
      log(`downloading ${channel.id} ${release.version}…`);
      const staged = await channel.stage(release, staging, ctx);
      if (invalidRelativePath(staged.binRelPath)) {
        throw new Error(`${channel.id} staged binary path is invalid`);
      }
      const stagedBin = join(staging, staged.binRelPath);
      if (!lstatSync(stagedBin).isFile()) {
        throw new Error(`${channel.id} staged binary is not a regular file`);
      }
      if (!contains(realpathSync(staging), realpathSync(stagedBin))) {
        throw new Error(`${channel.id} staged binary escapes staging directory`);
      }
      const launch = channel.launchFor(stagedBin, staged.args);
      const checked = await validateStaged({
        version: release.version,
        stagingDir: staging,
        binPath: stagedBin,
        command: launch.command,
        args: launch.args,
      });
      if (!checked.ok) {
        throw new Error(checked.reason);
      }
      const marker: InstallMarker = {
        version: release.version,
        url: release.url,
        ...(staged.archiveSha256 !== undefined ? { archiveSha256: staged.archiveSha256 } : {}),
        ...(staged.tarballSha1 !== undefined ? { tarballSha1: staged.tarballSha1 } : {}),
        binRelPath: staged.binRelPath,
        binSha256: sha256File(stagedBin),
        args: staged.args,
        installedAt: now(),
      };
      const markerPending = join(staging, '.install-complete.pending');
      writeFileSync(markerPending, `${JSON.stringify(marker)}\n`, { flag: 'wx', mode: 0o600 });
      renameSync(markerPending, join(staging, '.install-complete'));
      if ((leases.get(versionDir) ?? 0) > 0) {
        throw new Error(
          `${channel.id} ${release.version} directory is leased by a running session`,
        );
      }
      mkdirSync(join(root, 'versions'), { recursive: true });
      rmSync(versionDir, { recursive: true, force: true });
      renameSync(staging, versionDir);
      writeCurrentPointer(release.version);
      pruneInactiveVersions();
      const verified = installFor(versionDir);
      if (verified === null) {
        throw new Error(`${channel.id} ${release.version} failed verification after activation`);
      }
      log(`${channel.id} ${release.version} installed`);
      return { ok: true, install: verified };
    } catch (error) {
      rmSync(staging, { recursive: true, force: true });
      const message = error instanceof Error ? error.message : String(error);
      log(`${channel.id} install failed: ${message}`);
      return { ok: false, error: message };
    }
  }

  async function ensureImpl(): Promise<ManagedRuntimeInstall | null> {
    const existing = current();
    if (existing !== null) return existing;
    const release = await channel.resolveRelease(ctx, { useCache: true });
    if (release === null) return current();
    const locked = await withLock(() => stageAndActivate(release));
    if (locked.acquired && locked.value.ok) {
      if (availableVersion === release.version) availableVersion = null;
      phase = 'idle';
      options.onChange?.();
      return locked.value.install;
    }
    return installFor(join(root, 'versions', release.version)) ?? current();
  }

  async function checkForUpdateImpl(opts?: { force?: boolean }): Promise<RuntimeUpdateStatus> {
    const seed = options.resolveSeed?.() ?? null;
    if (seed?.source === 'override' || !updateChecksEnabled()) {
      if (availableVersion !== null) {
        availableVersion = null;
        options.onChange?.();
      }
      return status();
    }
    if (!opts?.force && lastCheckedAt > 0 && now() - lastCheckedAt < checkIntervalMs) {
      return status();
    }
    lastCheckedAt = now();
    const release = await channel.resolveRelease(ctx, { useCache: false });
    if (release === null) return status();
    const active = current();
    const activeVersion = active !== null && active.version !== '' ? active.version : null;
    const nextAvailable =
      activeVersion === null || isNewerManagedVersion(release.version, activeVersion)
        ? release.version
        : null;
    if (nextAvailable !== availableVersion) {
      availableVersion = nextAvailable;
      options.onChange?.();
    }
    return status();
  }

  async function updateImpl(): Promise<ManagedRuntimeInstall | null> {
    const seed = options.resolveSeed?.() ?? null;
    if (seed?.source === 'override') return current();
    phase = 'updating';
    options.onChange?.();
    const release = await channel.resolveRelease(ctx, { useCache: false });
    if (release === null) {
      phase = 'failed';
      options.onChange?.();
      return null;
    }
    const active = current();
    const activeVersion = active !== null && active.version !== '' ? active.version : null;
    if (activeVersion !== null && !isNewerManagedVersion(release.version, activeVersion)) {
      availableVersion = null;
      phase = 'idle';
      options.onChange?.();
      return active;
    }
    const locked = await withLock(() => stageAndActivate(release));
    if (!locked.acquired) {
      phase = 'idle';
      options.onChange?.();
      return current();
    }
    if (!locked.value.ok) {
      availableVersion = release.version;
      phase = 'failed';
      options.onChange?.();
      return null;
    }
    availableVersion = null;
    phase = 'idle';
    options.onChange?.();
    return locked.value.install;
  }

  return {
    current,
    acquire,
    status,
    ensure: () => (pendingEnsure ??= ensureImpl().finally(() => (pendingEnsure = null))),
    checkForUpdate: (opts) =>
      (pendingCheck ??= checkForUpdateImpl(opts).finally(() => (pendingCheck = null))),
    update: () => (pendingUpdate ??= updateImpl().finally(() => (pendingUpdate = null))),
  };
}
