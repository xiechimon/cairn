import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { BRAND } from '@cairn/shared';
import { z } from 'zod';

const exec = promisify(execFile);

const REGISTRY_URL = 'https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json';
const NPM_REGISTRY_URL = 'https://registry.npmjs.org';
const FETCH_TIMEOUT_MS = 15_000;
const DOWNLOAD_TIMEOUT_MS = 120_000;
const LOCK_STALE_MS = 15 * 60_000;

const registrySchema = z.object({
  agents: z.array(
    z.object({
      id: z.string(),
      distribution: z
        .object({
          npx: z.object({ package: z.string(), args: z.array(z.string()).default([]) }).optional(),
        })
        .optional(),
    }),
  ),
});

const npmDistSchema = z.object({
  dist: z.object({
    tarball: z
      .string()
      .url()
      .refine((url) => url.startsWith('https://')),
    shasum: z.string().optional(),
    integrity: z.string().optional(),
  }),
});

const installMarkerSchema = z.object({
  version: z.string(),
  url: z.string(),
  tarballSha1: z.string().optional(),
  binRelPath: z.string(),
  binSha256: z.string(),
  args: z.array(z.string()).default(['--acp']),
  installedAt: z.number(),
});
type InstallMarker = z.infer<typeof installMarkerSchema>;

export interface GeminiInstall {
  version: string;
  command: string;
  args: string[];
}

export interface GeminiManaged {
  current(): GeminiInstall | null;
  ensure(): Promise<GeminiInstall | null>;
}

export interface GeminiManagedOptions {
  root?: string;
  nodePath?: string;
  fetchImpl?: typeof fetch;
  registryUrl?: string;
  npmRegistryUrl?: string;
  log?: (message: string) => void;
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

function unsafeVersion(version: string): boolean {
  return version === '' || /[/\\]/.test(version) || version.startsWith('.');
}

function parseNpmPackage(spec: string): { name: string; version: string } | null {
  const at = spec.lastIndexOf('@');
  if (at <= 0) return null;
  const version = spec.slice(at + 1);
  if (unsafeVersion(version)) return null;
  return { name: spec.slice(0, at), version };
}

function verifyTarball(bytes: Buffer, dist: { shasum?: string; integrity?: string }): boolean {
  if (typeof dist.integrity === 'string' && dist.integrity.startsWith('sha512-')) {
    const expected = Buffer.from(dist.integrity.slice('sha512-'.length), 'base64').toString('hex');
    return createHash('sha512').update(bytes).digest('hex') === expected;
  }
  if (typeof dist.shasum === 'string') {
    return createHash('sha1').update(bytes).digest('hex') === dist.shasum;
  }
  return false;
}

export function geminiInstallRoot(cairnHome: string): string {
  return join(cairnHome, 'tools', 'gemini');
}

export function createGeminiManaged(options: GeminiManagedOptions = {}): GeminiManaged {
  const root = options.root ?? geminiInstallRoot(join(homedir(), BRAND.homeDirName));
  const nodePath = options.nodePath ?? process.execPath;
  const fetchImpl = options.fetchImpl ?? fetch;
  const registryUrl = options.registryUrl ?? REGISTRY_URL;
  const npmRegistryUrl = options.npmRegistryUrl ?? NPM_REGISTRY_URL;
  const log = options.log ?? (() => {});
  let pending: Promise<GeminiInstall | null> | null = null;

  function installFor(versionDir: string): GeminiInstall | null {
    const marker = markerOf(versionDir);
    if (marker === null) return null;
    const binPath = join(versionDir, marker.binRelPath);
    try {
      const bytes = readFileSync(binPath);
      if (createHash('sha256').update(bytes).digest('hex') !== marker.binSha256) return null;
    } catch {
      return null;
    }
    return { version: marker.version, command: nodePath, args: [binPath, ...marker.args] };
  }

  function current(): GeminiInstall | null {
    try {
      const currentJson = JSON.parse(readFileSync(join(root, 'current.json'), 'utf8')) as {
        version?: unknown;
      };
      if (typeof currentJson.version === 'string' && !unsafeVersion(currentJson.version)) {
        const found = installFor(join(root, 'versions', currentJson.version));
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

  async function fetchJson(url: string): Promise<unknown | null> {
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!response.ok) return null;
      return await response.json();
    } catch {
      return null;
    }
  }

  async function install(): Promise<GeminiInstall | null> {
    const registry = registrySchema.safeParse(await fetchJson(registryUrl));
    if (!registry.success) {
      log('gemini ACP registry did not match the expected shape');
      return null;
    }
    const agent = registry.data.agents.find((entry) => entry.id === 'gemini');
    const pkg = agent?.distribution?.npx?.package;
    const npmArgs = agent?.distribution?.npx?.args ?? [];
    if (pkg === undefined) {
      log('gemini ACP registry has no npx distribution');
      return null;
    }
    const parsed = parseNpmPackage(pkg);
    if (parsed === null) {
      log(`gemini registry package spec is unparseable: ${pkg}`);
      return null;
    }
    const existing = current();
    if (existing !== null && existing.version === parsed.version) return existing;
    const meta = npmDistSchema.safeParse(
      await fetchJson(`${npmRegistryUrl}/${parsed.name.replace('/', '%2f')}/${parsed.version}`),
    );
    if (!meta.success) {
      log(`gemini npm metadata for ${pkg} did not match the expected shape`);
      return null;
    }
    const lock = `${root}.lock`;
    mkdirSync(root, { recursive: true });
    try {
      try {
        if (Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS) {
          rmSync(lock, { recursive: true });
        }
      } catch {}
      mkdirSync(lock);
    } catch {
      return current();
    }
    try {
      const response = await fetchImpl(meta.data.dist.tarball, {
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      });
      if (!response.ok) {
        log(`gemini tarball download failed: HTTP ${response.status}`);
        return null;
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!verifyTarball(bytes, meta.data.dist)) {
        log('gemini tarball checksum mismatch');
        return null;
      }
      const staging = mkdtempSync(join(root, '.staging-'));
      try {
        const tarballPath = join(staging, 'pkg.tgz');
        writeFileSync(tarballPath, bytes);
        await exec('tar', ['-xzf', tarballPath, '-C', staging, 'package/bundle/gemini.js']);
        const bundle = join(staging, 'package', 'bundle', 'gemini.js');
        if (!existsSync(bundle)) {
          log('gemini tarball has no bundle/gemini.js');
          return null;
        }
        const binSha256 = createHash('sha256').update(readFileSync(bundle)).digest('hex');
        const versionDir = join(root, 'versions', parsed.version);
        rmSync(versionDir, { recursive: true, force: true });
        mkdirSync(join(versionDir, 'bundle'), { recursive: true });
        renameSync(bundle, join(versionDir, 'bundle', 'gemini.js'));
        const marker: InstallMarker = {
          version: parsed.version,
          url: meta.data.dist.tarball,
          ...(meta.data.dist.shasum !== undefined ? { tarballSha1: meta.data.dist.shasum } : {}),
          binRelPath: 'bundle/gemini.js',
          binSha256,
          args: npmArgs,
          installedAt: Date.now(),
        };
        writeFileSync(join(versionDir, '.install-complete'), `${JSON.stringify(marker)}\n`, {
          mode: 0o600,
        });
        mkdirSync(root, { recursive: true });
        writeFileSync(
          join(root, 'current.json'),
          `${JSON.stringify({ version: parsed.version })}\n`,
        );
      } finally {
        rmSync(staging, { recursive: true, force: true });
      }
      return installFor(join(root, 'versions', parsed.version));
    } catch (error) {
      log(`gemini install failed: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    } finally {
      try {
        rmSync(lock, { recursive: true, force: true });
      } catch {}
    }
  }

  return {
    current,
    ensure: () => {
      pending ??= install().finally(() => {
        pending = null;
      });
      return pending;
    },
  };
}
