import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
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
import { join } from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import { insidePath, unsafeManagedVersion, verifiedManagedBin } from './managed-bin.js';

const exec = promisify(execFile);

export const ANTIGRAVITY_REGISTRY_URL =
  'https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json';
export const ANTIGRAVITY_ARCHIVE_HOST = 'dl.google.com';

const LOCK_STALE_MS = 15 * 60_000;
const FETCH_TIMEOUT_MS = 15_000;
const DOWNLOAD_TIMEOUT_MS = 120_000;

const registryAgentSchema = z.object({
  id: z.string(),
  version: z.string(),
  distribution: z
    .object({
      binary: z
        .record(
          z.string(),
          z.object({
            archive: z.string().url(),
            cmd: z.string(),
            args: z.array(z.string()).optional(),
            sha256: z.string().regex(/^[a-f0-9]{64}$/i),
          }),
        )
        .nullish(),
    })
    .optional(),
});

const registrySchema = z.object({ agents: z.array(z.unknown()) });

const installMarkerSchema = z.object({
  version: z.string(),
  url: z.string(),
  archiveSha256: z.string(),
  binRelPath: z.string(),
  binSha256: z.string(),
  args: z.array(z.string()).default([]),
  installedAt: z.number(),
});
type InstallMarker = z.infer<typeof installMarkerSchema>;

const LEGACY_SPAWN_ARGS = ['acp'];

function markerArgs(args: string[]): string[] {
  return args.length === 1 && args[0] === LEGACY_SPAWN_ARGS[0] ? [] : args;
}

export interface AntigravityManagedBin {
  version: string;
  binPath: string;
  args: string[];
}

export interface AntigravityInstallOptions {
  root: string;
  platform?: string;
  arch?: string;
  fetchImpl?: typeof fetch;
  registryUrl?: string;
  archiveHost?: string;
  log?: (message: string) => void;
}

function platformKey(platform: string, arch: string): string | null {
  const os = platform === 'darwin' ? 'darwin' : platform === 'linux' ? 'linux' : null;
  const cpu = arch === 'arm64' ? 'aarch64' : arch === 'x64' ? 'x86_64' : null;
  return os !== null && cpu !== null ? `${os}-${cpu}` : null;
}

export function antigravityInstallSupported(platform: string, arch: string): boolean {
  return platformKey(platform, arch) !== null;
}

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function trustedArchive(url: string, host: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname === host;
  } catch {
    return false;
  }
}

function readManagedInstall(versionDir: string): AntigravityManagedBin | null {
  let marker: InstallMarker;
  try {
    marker = installMarkerSchema.parse(
      JSON.parse(readFileSync(join(versionDir, '.install-complete'), 'utf8')),
    );
  } catch {
    return null;
  }
  const bin = verifiedManagedBin(versionDir);
  if (bin === null) return null;
  return { version: marker.version, binPath: bin.command, args: markerArgs(bin.args) };
}

export function currentAntigravityManagedInstall(root: string): AntigravityManagedBin | null {
  try {
    const currentJson = JSON.parse(readFileSync(join(root, 'current.json'), 'utf8')) as {
      version?: unknown;
    };
    if (typeof currentJson.version === 'string' && !unsafeManagedVersion(currentJson.version)) {
      const found = readManagedInstall(join(root, 'versions', currentJson.version));
      if (found !== null) return found;
    }
  } catch {}
  const versions = join(root, 'versions');
  try {
    for (const entry of readdirSync(versions).sort().reverse()) {
      const found = readManagedInstall(join(versions, entry));
      if (found !== null) return found;
    }
  } catch {}
  return null;
}

export async function ensureAntigravityManagedInstall(
  options: AntigravityInstallOptions,
): Promise<AntigravityManagedBin | null> {
  return (
    currentAntigravityManagedInstall(options.root) ?? (await installAntigravityManaged(options))
  );
}

async function installAntigravityManaged(
  options: AntigravityInstallOptions,
): Promise<AntigravityManagedBin | null> {
  const root = options.root;
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const fetchImpl = options.fetchImpl ?? fetch;
  const registryUrl = options.registryUrl ?? ANTIGRAVITY_REGISTRY_URL;
  const archiveHost = options.archiveHost ?? ANTIGRAVITY_ARCHIVE_HOST;
  const log = options.log ?? (() => {});
  const key = platformKey(platform, arch);
  if (key === null) return null;

  let body: string | null = null;
  try {
    const response = await fetchImpl(registryUrl, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`antigravity registry HTTP ${response.status}`);
    body = await response.text();
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'registry-cache.json'), body);
  } catch {
    try {
      body = readFileSync(join(root, 'registry-cache.json'), 'utf8');
    } catch {
      return null;
    }
  }
  if (body === null) return null;

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(body);
  } catch {
    return null;
  }
  const parsed = registrySchema.safeParse(parsedJson);
  if (!parsed.success) {
    log('antigravity registry did not match the expected shape');
    return null;
  }
  const rawAgent = parsed.data.agents.find(
    (entry) =>
      typeof entry === 'object' &&
      entry !== null &&
      ((entry as Record<string, unknown>).id === 'antigravity-acp' ||
        (entry as Record<string, unknown>).id === 'antigravity'),
  );
  const parsedAgent = registryAgentSchema.safeParse(rawAgent);
  if (!parsedAgent.success) {
    log('antigravity registry entry is missing or malformed');
    return null;
  }
  const agent = parsedAgent.data;
  const binary = agent.distribution?.binary?.[key];
  if (binary === undefined) {
    log(`antigravity registry has no binary entry for ${key}`);
    return null;
  }
  const binRelCandidate = binary.cmd.replace(/^\.[/\\]/, '').replaceAll('\\', '/');
  if (
    unsafeManagedVersion(agent.version) ||
    binRelCandidate.split('/').includes('..') ||
    binRelCandidate.startsWith('/')
  ) {
    log(`antigravity registry entry has an unsafe version or cmd: ${agent.version} ${binary.cmd}`);
    return null;
  }
  if (!trustedArchive(binary.archive, archiveHost)) {
    log(`antigravity registry archive url is untrusted: ${binary.archive}`);
    return null;
  }
  const versionDir = join(root, 'versions', agent.version);
  const existing = readManagedInstall(versionDir);
  if (existing !== null) return existing;

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

  const staging = mkdtempSync(join(root, '.staging-'));
  try {
    log(`downloading antigravity ${agent.version}…`);
    const response = await fetchImpl(binary.archive, {
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`antigravity download: HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const archiveSha256 = createHash('sha256').update(bytes).digest('hex');
    if (archiveSha256 !== binary.sha256.toLowerCase()) {
      throw new Error('antigravity archive checksum mismatch');
    }
    const isZip = binary.archive.toLowerCase().endsWith('.zip');
    const archivePath = join(staging, isZip ? 'antigravity.zip' : 'antigravity.tar.gz');
    writeFileSync(archivePath, bytes);
    if (isZip) {
      await exec('unzip', ['-o', '-q', archivePath, '-d', staging], { timeout: 60_000 });
    } else {
      await exec('tar', ['-xzf', archivePath, '-C', staging], { timeout: 60_000 });
    }
    rmSync(archivePath, { force: true });

    const binRelPath = binary.cmd.replace(/^\.[/\\]/, '').replaceAll('\\', '/');
    let binPath = join(staging, binRelPath);
    if (!existsSync(binPath)) {
      const tops = readdirSync(staging).filter((entry) =>
        statSync(join(staging, entry)).isDirectory(),
      );
      const top = tops[0];
      if (tops.length !== 1 || top === undefined) {
        throw new Error('antigravity archive layout unrecognized');
      }
      binPath = join(staging, top, binRelPath);
      if (!existsSync(binPath)) throw new Error('antigravity archive has no binary');
    }
    if (!lstatSync(binPath).isFile()) throw new Error('antigravity archive binary is not a file');
    if (!insidePath(realpathSync(staging), realpathSync(binPath)))
      throw new Error('antigravity archive binary escapes the archive');
    const marker: InstallMarker = {
      version: agent.version,
      url: binary.archive,
      archiveSha256,
      binRelPath: binPath.slice(staging.length + 1),
      binSha256: sha256File(binPath),
      args: binary.args ?? [],
      installedAt: Date.now(),
    };
    const markerPath = join(staging, '.install-complete');
    const markerStaging = join(staging, '.install-complete.pending');
    writeFileSync(markerStaging, JSON.stringify(marker), { flag: 'wx' });
    renameSync(markerStaging, markerPath);
    rmSync(versionDir, { recursive: true, force: true });
    mkdirSync(join(root, 'versions'), { recursive: true });
    renameSync(staging, versionDir);
    writeFileSync(join(root, 'current.json'), JSON.stringify({ version: agent.version }));
    log(`antigravity ${agent.version} installed`);
    return readManagedInstall(versionDir);
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    log(`antigravity install failed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  } finally {
    try {
      rmSync(lock, { recursive: true, force: true });
    } catch {}
  }
}
