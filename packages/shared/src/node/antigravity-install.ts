import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync,
  existsSync,
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
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import { compareVersions } from '../antigravity-local.js';
import { insidePath, unsafeManagedVersion, verifiedManagedBin } from './managed-bin.js';

const exec = promisify(execFile);

export const ANTIGRAVITY_CLI_MANIFEST_BASE =
  'https://antigravity-cli-auto-updater-974169037036.us-central1.run.app/manifests';
export const ANTIGRAVITY_CLI_ARCHIVE_PREFIX =
  'https://storage.googleapis.com/antigravity-public/antigravity-cli/';
export const ANTIGRAVITY_CLI_MIN_VERSION = '1.5.0';
export const ANTIGRAVITY_ACP_ARGS = ['acp', '--app-data-dir', 'antigravity-acp'];

const LOCK_STALE_MS = 15 * 60_000;
const FETCH_TIMEOUT_MS = 15_000;
const DOWNLOAD_TIMEOUT_MS = 600_000;
const VERSION_PROBE_TIMEOUT_MS = 60_000;
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;

const releaseSchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  url: z.string(),
  sha512: z.string().regex(/^[a-f0-9]{128}$/i),
});

const installMarkerSchema = z.object({
  runtime: z.literal('agy-cli'),
  version: z.string(),
  url: z.string(),
  archiveSha512: z.string(),
  binRelPath: z.string(),
  binSha256: z.string(),
  args: z.array(z.string()).default([]),
  installedAt: z.number(),
});
type InstallMarker = z.infer<typeof installMarkerSchema>;

export interface AntigravityManagedBin {
  version: string;
  binPath: string;
  args: string[];
}

export interface AntigravityInstallOptions {
  root: string;
  platform?: string;
  arch?: string;
  musl?: boolean;
  fetchImpl?: typeof fetch;
  manifestBaseUrl?: string;
  archiveUrlPrefix?: string;
  versionProbe?: boolean;
  validate?: (bin: AntigravityManagedBin) => Promise<boolean>;
  protectedVersions?: () => Iterable<string>;
  log?: (message: string) => void;
}

export function antigravityCliTarget(platform: string, arch: string, musl = false): string | null {
  if (!['darwin', 'linux', 'win32'].includes(platform) || !['x64', 'arm64'].includes(arch)) {
    return null;
  }
  const os = platform === 'win32' ? 'windows' : platform;
  const cpu = arch === 'x64' ? 'amd64' : arch;
  return `${os}_${cpu}${platform === 'linux' && musl ? '_musl' : ''}`;
}

export function antigravityInstallSupported(platform: string, arch: string): boolean {
  return antigravityCliTarget(platform, arch) !== null;
}

function hostIsMusl(): boolean {
  try {
    return readdirSync('/lib').some(
      (entry) => entry.startsWith('ld-musl-') || entry.startsWith('libc.musl-'),
    );
  } catch {
    return false;
  }
}

interface CliRelease {
  version: string;
  url: string;
  sha512: string;
  executableName: string;
  format: 'tar.gz' | 'exe';
}

export function parseAntigravityCliRelease(
  value: unknown,
  platform: string,
  arch: string,
  musl: boolean,
  archiveUrlPrefix: string,
): CliRelease | null {
  if (antigravityCliTarget(platform, arch, musl) === null) return null;
  const parsed = releaseSchema.safeParse(value);
  if (!parsed.success) return null;
  const manifest = parsed.data;
  if (compareVersions(manifest.version, ANTIGRAVITY_CLI_MIN_VERSION) < 0) return null;
  const os = platform === 'darwin' ? 'mac' : platform === 'win32' ? 'windows' : 'linux';
  const cpu = arch === 'x64' ? 'x64' : 'arm64';
  const suffix = platform === 'linux' && musl ? '_musl' : '';
  const extension = platform === 'win32' ? 'exe' : 'tar.gz';
  const folder = `${platform === 'win32' ? 'windows' : platform}-${arch === 'arm64' ? 'arm' : 'x64'}${suffix ? '-musl' : ''}`;
  const prefix = `${archiveUrlPrefix}${manifest.version}-`;
  const rest = manifest.url.startsWith(prefix) ? manifest.url.slice(prefix.length) : '';
  if (
    !/^\d+\//.test(rest) ||
    rest.replace(/^\d+\//, '') !== `${folder}/cli_${os}_${cpu}${suffix}.${extension}`
  ) {
    return null;
  }
  return {
    version: manifest.version,
    url: manifest.url,
    sha512: manifest.sha512.toLowerCase(),
    executableName: platform === 'win32' ? 'agy.exe' : 'antigravity',
    format: platform === 'win32' ? 'exe' : 'tar.gz',
  };
}

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function readAntigravityCliInstall(versionDir: string): AntigravityManagedBin | null {
  let marker: InstallMarker;
  try {
    marker = installMarkerSchema.parse(
      JSON.parse(readFileSync(join(versionDir, '.install-complete'), 'utf8')),
    );
  } catch {
    return null;
  }
  if (compareVersions(marker.version, ANTIGRAVITY_CLI_MIN_VERSION) < 0) return null;
  const bin = verifiedManagedBin(versionDir);
  if (bin === null) return null;
  return { version: marker.version, binPath: bin.command, args: bin.args };
}

export function antigravityCliInstalls(versionsDir: string): AntigravityManagedBin[] {
  let entries: string[];
  try {
    entries = readdirSync(versionsDir);
  } catch {
    return [];
  }
  return entries
    .sort((a, b) => compareVersions(b, a))
    .flatMap((entry) => {
      const found = readAntigravityCliInstall(join(versionsDir, entry));
      return found === null ? [] : [found];
    });
}

export function currentAntigravityManagedInstall(root: string): AntigravityManagedBin | null {
  try {
    const currentJson = JSON.parse(readFileSync(join(root, 'current.json'), 'utf8')) as {
      version?: unknown;
    };
    if (typeof currentJson.version === 'string' && !unsafeManagedVersion(currentJson.version)) {
      const found = readAntigravityCliInstall(join(root, 'versions', currentJson.version));
      if (found !== null) return found;
    }
  } catch {}
  return antigravityCliInstalls(join(root, 'versions'))[0] ?? null;
}

export function pruneAntigravityVersions(
  root: string,
  protectedVersions: Iterable<string> = [],
): void {
  const keep = new Set<string>(protectedVersions);
  const current = currentAntigravityManagedInstall(root);
  if (current !== null) keep.add(current.version);
  pruneVersions(join(root, 'versions'), keep);
}

export async function ensureAntigravityManagedInstall(
  options: AntigravityInstallOptions,
): Promise<AntigravityManagedBin | null> {
  const root = options.root;
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const musl = options.musl ?? (platform === 'linux' && hostIsMusl());
  const target = antigravityCliTarget(platform, arch, musl);
  if (target === null) return null;
  const fetchImpl = options.fetchImpl ?? fetch;
  const manifestBase = options.manifestBaseUrl ?? ANTIGRAVITY_CLI_MANIFEST_BASE;
  const archiveUrlPrefix = options.archiveUrlPrefix ?? ANTIGRAVITY_CLI_ARCHIVE_PREFIX;
  const log = options.log ?? (() => {});

  let body: string | null = null;
  try {
    const response = await fetchImpl(`${manifestBase}/${target}.json`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`antigravity manifest HTTP ${response.status}`);
    body = await response.text();
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'channel-cache.json'), body);
  } catch {
    try {
      body = readFileSync(join(root, 'channel-cache.json'), 'utf8');
    } catch {
      return currentAntigravityManagedInstall(root);
    }
  }
  if (body === null) return currentAntigravityManagedInstall(root);

  let manifestJson: unknown;
  try {
    manifestJson = JSON.parse(body);
  } catch {
    return currentAntigravityManagedInstall(root);
  }
  const release = parseAntigravityCliRelease(manifestJson, platform, arch, musl, archiveUrlPrefix);
  const current = currentAntigravityManagedInstall(root);
  if (release === null) {
    log('antigravity release manifest did not match the expected channel layout');
    return current;
  }
  if (current !== null && compareVersions(current.version, release.version) >= 0) {
    pruneVersions(
      join(root, 'versions'),
      new Set([current.version, ...(options.protectedVersions?.() ?? [])]),
    );
    return current;
  }

  const lock = join(root, '.install.lock');
  mkdirSync(root, { recursive: true });
  try {
    try {
      if (Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS) rmSync(lock, { recursive: true });
    } catch {}
    mkdirSync(lock);
  } catch {
    return currentAntigravityManagedInstall(root);
  }

  try {
    const afterLock = currentAntigravityManagedInstall(root);
    if (afterLock !== null && compareVersions(afterLock.version, release.version) >= 0) {
      pruneVersions(
        join(root, 'versions'),
        new Set([afterLock.version, ...(options.protectedVersions?.() ?? [])]),
      );
      return afterLock;
    }
    return await installRelease(options, root, platform, release, afterLock, fetchImpl, log);
  } finally {
    try {
      rmSync(lock, { recursive: true, force: true });
    } catch {}
  }
}

async function inspectTarArchive(archivePath: string): Promise<void> {
  const [listResult, verboseResult] = await Promise.all([
    exec('tar', ['-tzf', archivePath], { timeout: 60_000 }),
    exec('tar', ['-tvzf', archivePath], { timeout: 60_000 }),
  ]);
  const entries = listResult.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
  for (const entry of entries) {
    if (entry.startsWith('/') || entry.split(/[/\\]/).includes('..')) {
      throw new Error('antigravity archive entry escapes the target directory');
    }
  }
  const detailLines = verboseResult.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
  let regularFiles = 0;
  for (const line of detailLines) {
    const kind = line[0];
    if (kind === '-') {
      regularFiles += 1;
    } else if (kind !== 'd') {
      throw new Error('antigravity archive contains an unsupported entry type');
    }
  }
  if (regularFiles !== 1) throw new Error('antigravity archive layout unrecognized');
}

function writeCurrentVersion(root: string, version: string): void {
  const pending = join(root, `.current.json.${randomUUID()}`);
  writeFileSync(pending, JSON.stringify({ version }), { flag: 'wx' });
  renameSync(pending, join(root, 'current.json'));
}

async function installRelease(
  options: AntigravityInstallOptions,
  root: string,
  platform: string,
  release: CliRelease,
  previous: AntigravityManagedBin | null,
  fetchImpl: typeof fetch,
  log: (message: string) => void,
): Promise<AntigravityManagedBin | null> {
  const versionsRoot = join(root, 'versions');
  const versionDir = join(versionsRoot, release.version);
  const staging = mkdtempSync(join(root, '.staging-'));
  const rollback = () => {
    rmSync(staging, { recursive: true, force: true });
    return previous;
  };
  try {
    log(`downloading antigravity ${release.version}…`);
    const response = await fetchImpl(release.url, {
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`antigravity download: HTTP ${response.status}`);
    const length = Number(response.headers.get('content-length') ?? '0');
    if (length > MAX_ARCHIVE_BYTES) throw new Error('antigravity archive exceeds the size limit');
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength > MAX_ARCHIVE_BYTES)
      throw new Error('antigravity archive exceeds the size limit');
    if (createHash('sha512').update(bytes).digest('hex') !== release.sha512) {
      throw new Error('antigravity archive checksum mismatch');
    }

    let binPath: string;
    if (release.format === 'exe') {
      binPath = join(staging, release.executableName);
      writeFileSync(binPath, bytes, { mode: 0o755 });
    } else {
      const unpack = join(staging, 'unpack');
      mkdirSync(unpack);
      const archivePath = join(staging, 'antigravity.tar.gz');
      writeFileSync(archivePath, bytes);
      await inspectTarArchive(archivePath);
      await exec('tar', ['-xzf', archivePath, '-C', unpack], { timeout: 60_000 });
      rmSync(archivePath, { force: true });
      const files = walkFiles(unpack);
      if (files.length !== 1) throw new Error('antigravity archive layout unrecognized');
      const extracted = files[0] as string;
      if (!insidePath(realpathSync(unpack), realpathSync(extracted))) {
        throw new Error('antigravity archive binary escapes the archive');
      }
      binPath = join(staging, release.executableName);
      renameSync(extracted, binPath);
      rmSync(unpack, { recursive: true, force: true });
      chmodSync(binPath, 0o755);
    }

    if (options.versionProbe !== false) {
      const probe = await exec(binPath, ['--version'], {
        timeout: VERSION_PROBE_TIMEOUT_MS,
        env: {
          PATH: process.env.PATH ?? '',
          HOME: process.env.HOME ?? tmpdir(),
          TMPDIR: process.env.TMPDIR ?? tmpdir(),
          AGY_CLI_DISABLE_AUTO_UPDATE: '1',
        },
      }).catch(() => null);
      if (probe === null || !`${probe.stdout}${probe.stderr}`.includes(release.version)) {
        throw new Error(`antigravity ${release.version} failed the version probe`);
      }
    }
    if (options.validate !== undefined) {
      const candidate = { version: release.version, binPath, args: [...ANTIGRAVITY_ACP_ARGS] };
      const valid = await options.validate(candidate).catch(() => false);
      if (!valid) throw new Error(`antigravity ${release.version} failed the ACP validation`);
    }

    const marker: InstallMarker = {
      runtime: 'agy-cli',
      version: release.version,
      url: release.url,
      archiveSha512: release.sha512,
      binRelPath: release.executableName,
      binSha256: sha256File(binPath),
      args: [...ANTIGRAVITY_ACP_ARGS],
      installedAt: Date.now(),
    };
    const markerPath = join(staging, '.install-complete');
    const markerStaging = join(staging, '.install-complete.pending');
    writeFileSync(markerStaging, JSON.stringify(marker), { flag: 'wx' });
    renameSync(markerStaging, markerPath);
    if (platform !== 'win32') {
      chmodSync(binPath, 0o555);
      chmodSync(markerPath, 0o400);
    }
    if (existsSync(versionDir)) unlockDir(versionDir);
    rmSync(versionDir, { recursive: true, force: true });
    mkdirSync(versionsRoot, { recursive: true });
    renameSync(staging, versionDir);
    if (platform !== 'win32') chmodSync(versionDir, 0o700);
    writeCurrentVersion(root, release.version);
    rmSync(join(root, 'registry-cache.json'), { force: true });
    pruneVersions(
      versionsRoot,
      new Set([release.version, ...(options.protectedVersions?.() ?? [])]),
    );
    log(`antigravity ${release.version} installed`);
    return readAntigravityCliInstall(versionDir);
  } catch (error) {
    log(`antigravity install failed: ${error instanceof Error ? error.message : String(error)}`);
    return rollback();
  }
}

function walkFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      found.push(...walkFiles(path));
    } else if (entry.isFile()) {
      found.push(path);
    }
  }
  return found;
}

function unlockDir(dir: string): void {
  try {
    chmodSync(dir, 0o700);
  } catch {}
}

function pruneVersions(versionsRoot: string, keepVersions: ReadonlySet<string>): void {
  let entries: string[];
  try {
    entries = readdirSync(versionsRoot);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (keepVersions.has(entry) || unsafeManagedVersion(entry)) continue;
    const dir = join(versionsRoot, entry);
    try {
      const stat = lstatSync(dir);
      if (!stat.isDirectory() || stat.isSymbolicLink()) continue;
      unlockDir(dir);
      rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
}
