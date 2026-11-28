import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync,
  cpSync,
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
import { insidePath, sha256File, unsafeManagedVersion, verifiedManagedBin } from './managed-bin.js';

const exec = promisify(execFile);

export const DOUBAO_CLI_VERSION_PINNED = '2.38.4';
export const DOUBAO_CLI_ARCHIVE_PREFIX =
  'https://lf-flow-web-cdn.doubao.com/obj/flow-doubao/doubao_cli/';

const LOCK_STALE_MS = 15 * 60_000;
const DOWNLOAD_TIMEOUT_MS = 600_000;
const VERSION_PROBE_TIMEOUT_MS = 60_000;
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;

export type DoubaoCliTarget = 'darwin-arm64';

const artifactEntrySchema = z.object({
  url: z.string().url(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i),
  root: z.string().min(1).max(200),
});

const artifactsManifestSchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  platforms: z.record(z.string(), artifactEntrySchema),
});

const installMarkerSchema = z.object({
  runtime: z.literal('doubao-cli'),
  version: z.string(),
  url: z.string(),
  archiveSha256: z.string(),
  binRelPath: z.string(),
  binSha256: z.string(),
  args: z.array(z.string()).default([]),
  installedAt: z.number(),
});

const binaryManifestSchema = z.object({
  schema_version: z.literal(1),
  version: z.string().min(1),
  target: z.string().min(1),
  entrypoint: z.string().min(1),
  files: z
    .array(
      z.object({
        path: z.string().min(1),
        sha256: z
          .string()
          .regex(/^[a-f0-9]{64}$/i)
          .optional(),
      }),
    )
    .min(1),
});

export interface DoubaoManagedBin {
  version: string;
  binPath: string;
  args: string[];
}

export interface DoubaoCliRelease {
  version: string;
  url: string;
  sha256: string;
  root: string;
  executableName: string;
  format: 'tar.gz' | 'zip';
}

export interface DoubaoInstallOptions {
  root: string;
  platform?: string;
  arch?: string;
  fetchImpl?: typeof fetch;
  archiveUrlPrefix?: string;
  release?: DoubaoCliRelease;
  signal?: AbortSignal;
  versionProbe?: boolean;
  protectedVersions?: () => Iterable<string>;
  log?: (message: string) => void;
}

export const DOUBAO_PINNED_ARTIFACTS = {
  version: '2.38.4',
  platforms: {
    'darwin-arm64': {
      url: 'https://lf-flow-web-cdn.doubao.com/obj/flow-doubao/doubao_cli/2.38.4/doubao-cli-2.38.4-darwin-arm64-signed-signed.tar.gz',
      sha256: '67bc91de35bf4c3d8c8525af4fbb51c91a19fd935745bd212a83495fbea5544a',
      root: 'doubao-cli-2.38.4-darwin-arm64',
    },
  } as Record<string, { url: string; sha256: string; root: string }>,
} as const;

export function doubaoCliTarget(platform: string, arch: string): DoubaoCliTarget | null {
  if (platform === 'darwin' && arch === 'arm64') return 'darwin-arm64';
  return null;
}

export function doubaoInstallSupported(platform: string, arch: string): boolean {
  return doubaoCliTarget(platform, arch) !== null;
}

export function safeArchiveEntryPath(name: string): boolean {
  if (name === '' || name.startsWith('/') || name.includes('\\') || name.includes(':')) {
    return false;
  }
  for (let i = 0; i < name.length; i += 1) {
    if (name.charCodeAt(i) < 0x20) return false;
  }
  return !name.split('/').some((part) => part === '..' || part === '.');
}

export function parseDoubaoArtifactsRelease(
  value: unknown,
  platform: string,
  arch: string,
  archiveUrlPrefix = DOUBAO_CLI_ARCHIVE_PREFIX,
): DoubaoCliRelease | null {
  const target = doubaoCliTarget(platform, arch);
  if (target === null) return null;
  const parsed = artifactsManifestSchema.safeParse(value);
  if (!parsed.success) return null;
  if (compareVersions(parsed.data.version, DOUBAO_CLI_VERSION_PINNED) < 0) return null;
  const artifact = parsed.data.platforms[target];
  if (artifact === undefined) return null;
  const url = new URL(artifact.url);
  if (url.protocol !== 'https:' || url.username || url.password) return null;
  if (!artifact.url.startsWith(archiveUrlPrefix)) return null;
  if (!safeArchiveEntryPath(artifact.root) || artifact.root.includes('/')) return null;
  return {
    version: parsed.data.version,
    url: artifact.url,
    sha256: artifact.sha256.toLowerCase(),
    root: artifact.root,
    executableName: platform === 'win32' ? 'doubao.exe' : 'doubao',
    format: platform === 'win32' ? 'zip' : 'tar.gz',
  };
}

function readDoubaoCliInstall(versionDir: string): DoubaoManagedBin | null {
  let marker: z.infer<typeof installMarkerSchema>;
  try {
    marker = installMarkerSchema.parse(
      JSON.parse(readFileSync(join(versionDir, '.install-complete'), 'utf8')),
    );
  } catch {
    return null;
  }
  if (compareVersions(marker.version, DOUBAO_CLI_VERSION_PINNED) < 0) return null;
  const bin = verifiedManagedBin(versionDir);
  if (bin === null) return null;
  return { version: marker.version, binPath: bin.command, args: bin.args };
}

export function doubaoCliInstalls(versionsDir: string): DoubaoManagedBin[] {
  let entries: string[];
  try {
    entries = readdirSync(versionsDir);
  } catch {
    return [];
  }
  return entries
    .sort((a, b) => compareVersions(b, a))
    .flatMap((entry) => {
      const found = readDoubaoCliInstall(join(versionsDir, entry));
      return found === null ? [] : [found];
    });
}

export function currentDoubaoManagedInstall(root: string): DoubaoManagedBin | null {
  try {
    const currentJson = JSON.parse(readFileSync(join(root, 'current.json'), 'utf8')) as {
      version?: unknown;
    };
    if (typeof currentJson.version === 'string' && !unsafeManagedVersion(currentJson.version)) {
      const found = readDoubaoCliInstall(join(root, 'versions', currentJson.version));
      if (found !== null) return found;
    }
  } catch {}
  return doubaoCliInstalls(join(root, 'versions'))[0] ?? null;
}

async function inspectDoubaoArchive(
  archivePath: string,
  format: 'tar.gz' | 'zip',
  expectedRoot: string,
): Promise<void> {
  const listArgs = format === 'tar.gz' ? ['-tzf', archivePath] : ['-tf', archivePath];
  const verboseArgs = format === 'tar.gz' ? ['-tvzf', archivePath] : ['-tvf', archivePath];
  const [listResult, verboseResult] = await Promise.all([
    exec('tar', listArgs, { timeout: 60_000, maxBuffer: 32 * 1024 * 1024 }),
    exec('tar', verboseArgs, { timeout: 60_000, maxBuffer: 32 * 1024 * 1024 }),
  ]);
  const entries = listResult.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && line !== '.' && line !== './');
  if (entries.length === 0) throw new Error('doubao archive is empty');
  for (const rawName of entries) {
    const normalized = rawName.replace(/^(?:\.\/)+/, '').replace(/\/$/, '');
    if (normalized === '') continue;
    if (!safeArchiveEntryPath(normalized)) {
      throw new Error(`doubao archive unsafe entry: ${rawName}`);
    }
    if (normalized !== expectedRoot && !normalized.startsWith(`${expectedRoot}/`)) {
      throw new Error(`doubao archive unexpected root entry: ${rawName}`);
    }
  }
  const detailLines = verboseResult.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
  if (detailLines.some((line) => !/^[-d]/.test(line))) {
    throw new Error('doubao archive contains symlink or special file');
  }
}

function validateExtractedRuntime(
  runtimeDir: string,
  platform: string,
  arch: string,
  release: DoubaoCliRelease,
): string {
  const manifestPath = join(runtimeDir, 'manifest.json');
  const manifest = binaryManifestSchema.parse(JSON.parse(readFileSync(manifestPath, 'utf8')));
  const expectedTarget = platform === 'win32' ? 'win-x64' : `${platform}-${arch}`;
  if (manifest.version !== release.version || manifest.entrypoint !== release.executableName) {
    throw new Error('doubao runtime manifest mismatch');
  }
  if (platform !== 'win32' && manifest.target !== expectedTarget) {
    throw new Error('doubao runtime target mismatch');
  }
  const realRoot = realpathSync(runtimeDir);
  for (const entry of manifest.files) {
    if (!safeArchiveEntryPath(entry.path)) {
      throw new Error(`unsafe runtime file path: ${entry.path}`);
    }
    const targetFile = join(runtimeDir, entry.path);
    const stat = lstatSync(targetFile);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      !insidePath(realRoot, realpathSync(targetFile))
    ) {
      throw new Error(`invalid runtime file: ${entry.path}`);
    }
    if (entry.sha256 !== undefined && sha256File(targetFile) !== entry.sha256.toLowerCase()) {
      throw new Error(`checksum mismatch for runtime file: ${entry.path}`);
    }
  }
  const binPath = join(runtimeDir, release.executableName);
  const binStat = lstatSync(binPath);
  if (
    !binStat.isFile() ||
    binStat.isSymbolicLink() ||
    !insidePath(realRoot, realpathSync(binPath))
  ) {
    throw new Error('doubao entrypoint missing');
  }
  return binPath;
}

function writeCurrentVersion(root: string, version: string): void {
  const pending = join(root, `.current.json.${randomUUID()}`);
  writeFileSync(pending, JSON.stringify({ version }), { flag: 'wx' });
  renameSync(pending, join(root, 'current.json'));
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
      chmodSync(dir, 0o700);
      rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
}

async function installRelease(
  options: DoubaoInstallOptions,
  root: string,
  platform: string,
  arch: string,
  release: DoubaoCliRelease,
  previous: DoubaoManagedBin | null,
  fetchImpl: typeof fetch,
  log: (message: string) => void,
): Promise<DoubaoManagedBin | null> {
  const versionsRoot = join(root, 'versions');
  const versionDir = join(versionsRoot, release.version);
  const staging = mkdtempSync(join(root, '.staging-'));
  const rollback = () => {
    rmSync(staging, { recursive: true, force: true });
    return previous;
  };
  try {
    if (options.signal?.aborted) throw new Error('doubao install aborted');
    log(`downloading doubao ${release.version}…`);
    const downloadSignal =
      options.signal !== undefined
        ? AbortSignal.any([AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS), options.signal])
        : AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS);
    const response = await fetchImpl(release.url, { signal: downloadSignal });
    if (!response.ok) throw new Error(`doubao download: HTTP ${response.status}`);
    const length = Number(response.headers.get('content-length') ?? '0');
    if (length > MAX_ARCHIVE_BYTES) throw new Error('doubao archive exceeds the size limit');
    const bytes = Buffer.from(await response.arrayBuffer());
    if (options.signal?.aborted) throw new Error('doubao install aborted');
    if (bytes.byteLength > MAX_ARCHIVE_BYTES) {
      throw new Error('doubao archive exceeds the size limit');
    }
    if (createHash('sha256').update(bytes).digest('hex') !== release.sha256) {
      throw new Error('doubao archive checksum mismatch');
    }

    const unpack = join(staging, 'unpack');
    mkdirSync(unpack);
    const archivePath = join(staging, release.format === 'zip' ? 'doubao.zip' : 'doubao.tar.gz');
    writeFileSync(archivePath, bytes);
    await inspectDoubaoArchive(archivePath, release.format, release.root);
    const extractArgs =
      release.format === 'tar.gz'
        ? ['-xzf', archivePath, '-C', unpack]
        : ['-xf', archivePath, '-C', unpack];
    await exec('tar', extractArgs, { timeout: 60_000 });
    rmSync(archivePath, { force: true });

    const extractedRoot = join(unpack, release.root);
    const payloadDir = join(staging, 'runtime');
    cpSync(extractedRoot, payloadDir, { recursive: true });
    rmSync(unpack, { recursive: true, force: true });

    const binPath = validateExtractedRuntime(payloadDir, platform, arch, release);
    if (platform !== 'win32') chmodSync(binPath, 0o755);

    if (options.versionProbe !== false) {
      const probe = await exec(binPath, ['--version'], {
        timeout: VERSION_PROBE_TIMEOUT_MS,
        env: {
          PATH: process.env.PATH ?? '',
          HOME: process.env.HOME ?? tmpdir(),
          TMPDIR: process.env.TMPDIR ?? tmpdir(),
          DOUBAO_CLI_NO_UPDATE_CHECK: '1',
        },
      }).catch(() => null);
      if (probe === null || !`${probe.stdout}${probe.stderr}`.includes(release.version)) {
        throw new Error(`doubao ${release.version} failed the version probe`);
      }
    }

    const marker = {
      runtime: 'doubao-cli',
      version: release.version,
      url: release.url,
      archiveSha256: release.sha256,
      binRelPath: release.executableName,
      binSha256: sha256File(binPath),
      args: ['acp', 'serve'],
      installedAt: Date.now(),
    };
    const markerPath = join(payloadDir, '.install-complete');
    const markerStaging = join(payloadDir, '.install-complete.pending');
    writeFileSync(markerStaging, JSON.stringify(marker), { flag: 'wx' });
    renameSync(markerStaging, markerPath);
    if (platform !== 'win32') {
      chmodSync(binPath, 0o555);
      chmodSync(markerPath, 0o400);
    }

    if (options.signal?.aborted) throw new Error('doubao install aborted');
    rmSync(versionDir, { recursive: true, force: true });
    mkdirSync(versionsRoot, { recursive: true });
    renameSync(payloadDir, versionDir);
    if (platform !== 'win32') chmodSync(versionDir, 0o700);
    rmSync(staging, { recursive: true, force: true });
    writeCurrentVersion(root, release.version);
    pruneVersions(
      versionsRoot,
      new Set([release.version, ...(options.protectedVersions?.() ?? [])]),
    );
    log(`doubao ${release.version} installed`);
    return readDoubaoCliInstall(versionDir);
  } catch (error) {
    log(`doubao install failed: ${error instanceof Error ? error.message : String(error)}`);
    return rollback();
  }
}

export async function ensureDoubaoManagedInstall(
  options: DoubaoInstallOptions,
): Promise<DoubaoManagedBin | null> {
  if (options.signal?.aborted) return null;
  const root = options.root;
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  if (!doubaoInstallSupported(platform, arch)) return null;
  const fetchImpl = options.fetchImpl ?? fetch;
  const log = options.log ?? (() => {});

  const release =
    options.release ??
    parseDoubaoArtifactsRelease(
      DOUBAO_PINNED_ARTIFACTS,
      platform,
      arch,
      options.archiveUrlPrefix ?? DOUBAO_CLI_ARCHIVE_PREFIX,
    );
  const current = currentDoubaoManagedInstall(root);
  if (release === null) return current;
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
    return currentDoubaoManagedInstall(root);
  }

  try {
    const afterLock = currentDoubaoManagedInstall(root);
    if (afterLock !== null && compareVersions(afterLock.version, release.version) >= 0) {
      pruneVersions(
        join(root, 'versions'),
        new Set([afterLock.version, ...(options.protectedVersions?.() ?? [])]),
      );
      return afterLock;
    }
    return await installRelease(options, root, platform, arch, release, afterLock, fetchImpl, log);
  } finally {
    try {
      rmSync(lock, { recursive: true, force: true });
    } catch {}
  }
}
