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
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { BRAND } from '@cairn/shared';
import { sha256File, unsafeManagedVersion } from '@cairn/shared/managed-bin';
import { z } from 'zod';
import { ensurePrivateDir } from '../private-fs.js';
import { toolInstallRoot } from '../runtime-homes.js';
import { contains } from './confine.js';

const exec = promisify(execFile);

const MANIFEST_URL = 'https://static.devin.ai/cli/current/manifest.json';
const ARCHIVE_HOST = 'static.devin.ai';
const LOCK_STALE_MS = 15 * 60_000;
const FETCH_TIMEOUT_MS = 15_000;
const DOWNLOAD_TIMEOUT_MS = 120_000;

const manifestSchema = z.object({
  version: z.string(),
  platforms: z.record(
    z.string(),
    z.object({
      url: z.string().url(),
      sha256: z.string().regex(/^[a-f0-9]{64}$/i),
    }),
  ),
});

const installMarkerSchema = z.object({
  version: z.string(),
  url: z.string(),
  archiveSha256: z.string(),
  binRelPath: z.string(),
  binSha256: z.string(),
  args: z.array(z.string()).default(['acp']),
  installedAt: z.number(),
});
type InstallMarker = z.infer<typeof installMarkerSchema>;

export interface DevinInstall {
  version: string;
  binPath: string;
  args: string[];
  home: string;
}

export interface DevinManaged {
  current(): DevinInstall | null;
  ensure(): Promise<DevinInstall | null>;
}

export interface DevinManagedOptions {
  root?: string;
  home?: string;
  platform?: string;
  arch?: string;
  fetchImpl?: typeof fetch;
  manifestUrl?: string;
  archiveHost?: string;
  log?: (message: string) => void;
}

export function devinInstallRoot(cairnHome: string): string {
  return toolInstallRoot(cairnHome, 'devin');
}

function trustedArchive(url: string, host: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname === host;
  } catch {
    return false;
  }
}

function platformKey(platform: string, arch: string): string | null {
  const os = platform === 'darwin' ? 'darwin' : platform === 'linux' ? 'linux' : null;
  const cpu = arch === 'arm64' ? 'aarch64' : arch === 'x64' ? 'x86_64' : null;
  return os !== null && cpu !== null ? `${os}-${cpu}` : null;
}

const MANIFEST_TARGETS: Record<string, string> = {
  'darwin-aarch64': 'aarch64-apple-darwin',
  'darwin-x86_64': 'x86_64-apple-darwin',
  'linux-aarch64': 'aarch64-unknown-linux',
  'linux-x86_64': 'x86_64-unknown-linux',
};

function markerOf(versionDir: string): InstallMarker | null {
  try {
    return installMarkerSchema.parse(
      JSON.parse(readFileSync(join(versionDir, '.install-complete'), 'utf8')),
    );
  } catch {
    return null;
  }
}

export function createDevinManaged(options: DevinManagedOptions = {}): DevinManaged {
  const root = options.root ?? devinInstallRoot(join(homedir(), BRAND.homeDirName));
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const fetchImpl = options.fetchImpl ?? fetch;
  const manifestUrl = options.manifestUrl ?? MANIFEST_URL;
  const archiveHost = options.archiveHost ?? ARCHIVE_HOST;
  const log = options.log ?? (() => {});
  const key = platformKey(platform, arch);
  const home = options.home ?? join(root, 'home');
  let pending: Promise<DevinInstall | null> | null = null;

  function installFor(versionDir: string): DevinInstall | null {
    const marker = markerOf(versionDir);
    if (marker === null) return null;
    const binPath = join(versionDir, marker.binRelPath);
    try {
      if (!contains(realpathSync(versionDir), realpathSync(binPath))) return null;
      if (sha256File(binPath) !== marker.binSha256) return null;
    } catch {
      return null;
    }
    ensurePrivateDir(home);
    return { version: marker.version, binPath, args: marker.args, home };
  }

  function current(): DevinInstall | null {
    try {
      const current = JSON.parse(readFileSync(join(root, 'current.json'), 'utf8')) as {
        version?: unknown;
      };
      if (typeof current.version === 'string' && !unsafeManagedVersion(current.version)) {
        const found = installFor(join(root, 'versions', current.version));
        if (found !== null) return found;
      }
    } catch {}
    const versions = join(root, 'versions');
    try {
      for (const entry of readdirSync(versions).sort().reverse()) {
        const found = installFor(join(versions, entry));
        if (found !== null) return found;
      }
    } catch {}
    return null;
  }

  interface InstallSpec {
    version: string;
    archive: string;
    binRelPath: string;
    args: string[];
    archiveSha256?: string;
  }

  async function fetchCachedJson(url: string, cacheName: string): Promise<string | null> {
    try {
      const response = await fetchImpl(url, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`${cacheName} HTTP ${response.status}`);
      const text = await response.text();
      mkdirSync(root, { recursive: true });
      writeFileSync(join(root, cacheName), text);
      return text;
    } catch {
      try {
        return readFileSync(join(root, cacheName), 'utf8');
      } catch {
        return null;
      }
    }
  }

  function parseJson(text: string): unknown {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  async function manifestSpec(): Promise<InstallSpec | null> {
    if (key === null) return null;
    const target = MANIFEST_TARGETS[key];
    if (target === undefined) return null;
    const body = await fetchCachedJson(manifestUrl, 'manifest-cache.json');
    if (body === null) return null;
    const parsed = manifestSchema.safeParse(parseJson(body));
    if (!parsed.success) {
      log('devin manifest did not match the expected shape');
      return null;
    }
    const entry = parsed.data.platforms[target];
    if (entry === undefined) {
      log(`devin manifest has no archive for ${target}`);
      return null;
    }
    if (unsafeManagedVersion(parsed.data.version)) {
      log(`devin manifest has an unsafe version: ${parsed.data.version}`);
      return null;
    }
    if (!trustedArchive(entry.url, archiveHost)) {
      log(`devin manifest archive url is untrusted: ${entry.url}`);
      return null;
    }
    return {
      version: parsed.data.version,
      archive: entry.url,
      binRelPath: 'bin/devin',
      args: ['acp'],
      archiveSha256: entry.sha256.toLowerCase(),
    };
  }

  async function install(spec: InstallSpec): Promise<DevinInstall | null> {
    const versionDir = join(root, 'versions', spec.version);
    const existing = installFor(versionDir);
    if (existing !== null) return existing;
    const staging = mkdtempSync(join(root, '.staging-'));
    try {
      log(`downloading devin ${spec.version}…`);
      const response = await fetchImpl(spec.archive, {
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`devin download: HTTP ${response.status}`);
      const tarball = join(staging, 'devin.tar.gz');
      const bytes = Buffer.from(await response.arrayBuffer());
      const archiveSha256 = createHash('sha256').update(bytes).digest('hex');
      if (spec.archiveSha256 !== undefined && archiveSha256 !== spec.archiveSha256.toLowerCase()) {
        throw new Error('devin archive checksum mismatch');
      }
      writeFileSync(tarball, bytes);
      await exec('tar', ['-xzf', tarball, '-C', staging], { timeout: 60_000 });
      rmSync(tarball, { force: true });
      let binPath = join(staging, spec.binRelPath);
      if (!existsSync(binPath)) {
        const tops = readdirSync(staging).filter((entry) =>
          statSync(join(staging, entry)).isDirectory(),
        );
        const top = tops[0];
        if (tops.length !== 1 || top === undefined)
          throw new Error('devin archive layout unrecognized');
        binPath = join(staging, top, spec.binRelPath);
        if (!existsSync(binPath)) throw new Error('devin archive has no binary');
      }
      if (!lstatSync(binPath).isFile()) throw new Error('devin archive binary is not a file');
      if (!contains(realpathSync(staging), realpathSync(binPath)))
        throw new Error('devin archive binary escapes the archive');
      const marker: InstallMarker = {
        version: spec.version,
        url: spec.archive,
        archiveSha256,
        binRelPath: binPath.slice(staging.length + 1),
        binSha256: sha256File(binPath),
        args: spec.args,
        installedAt: Date.now(),
      };
      const markerPath = join(staging, '.install-complete');
      const markerStaging = join(staging, '.install-complete.pending');
      writeFileSync(markerStaging, JSON.stringify(marker), { flag: 'wx' });
      renameSync(markerStaging, markerPath);
      rmSync(versionDir, { recursive: true, force: true });
      mkdirSync(join(root, 'versions'), { recursive: true });
      renameSync(staging, versionDir);
      writeFileSync(join(root, 'current.json'), JSON.stringify({ version: spec.version }));
      log(`devin ${spec.version} installed`);
      return installFor(versionDir);
    } catch (error) {
      rmSync(staging, { recursive: true, force: true });
      log(`devin install failed: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  function withLock<T>(fn: () => Promise<T>): Promise<T> {
    const lock = join(root, '.install.lock');
    mkdirSync(root, { recursive: true });
    try {
      try {
        if (Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS) rmSync(lock, { recursive: true });
      } catch {}
      mkdirSync(lock);
    } catch {
      return Promise.resolve(null as T);
    }
    return fn().finally(() => {
      try {
        rmSync(lock, { recursive: true, force: true });
      } catch {}
    });
  }

  async function ensure(): Promise<DevinInstall | null> {
    if (key === null) return null;
    const spec = await manifestSpec();
    if (spec === null) return current();
    const done = await withLock(() => install(spec));
    if (done !== null) {
      writeFileSync(join(root, 'current.json'), JSON.stringify({ version: spec.version }));
      return done;
    }
    return installFor(join(root, 'versions', spec.version)) ?? current();
  }

  return {
    current,
    ensure: () => (pending ??= ensure().finally(() => (pending = null))),
  };
}
