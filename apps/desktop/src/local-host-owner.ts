import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { lookup as dnsLookup } from 'node:dns/promises';
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import { isIP } from 'node:net';
import { type NetworkInterfaceInfo, networkInterfaces as osNetworkInterfaces } from 'node:os';
import { join, resolve } from 'node:path';
import {
  ACCESS_TOKEN_FILE_NAME,
  BRAND,
  ENV_VARS,
  LOCAL_PROOF_PATH,
  LOCAL_PROOF_PREFIX,
  localProofResponseSchema,
  parseAccessTokenFile,
  remoteDescriptorSchema,
} from '@cairn/shared';
import { DEFAULT_RESIDENT_PORT, SERVER_OWNER_FILE } from './resident-host.js';

const MAX_LOCAL_FILE_BYTES = 16_384;
const PROBE_TIMEOUT_MS = 2_500;
const NONCE_BYTES = 24;
const IPV4_MAPPED_HEX = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/;

export interface LocalHostOwner {
  origin: string;
  token: string;
  home: string;
  environmentId: string;
}

interface LocalHomeCandidate {
  home: string;
  environmentId: string;
  token: string;
  ownerPort: number | null;
}

export interface ResolveLocalHostOwnerOptions {
  origin: string;
  candidateHomes: readonly string[];
  lookup?: (hostname: string) => Promise<ReadonlyArray<{ address: string; family: number }>>;
  networkInterfaces?: () => NodeJS.Dict<NetworkInterfaceInfo[]>;
  fetchImpl?: typeof fetch;
}

export function ownerSigningUrls(origin: string): string[] {
  const parsed = new URL(origin);
  const wsProtocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
  return [`${parsed.protocol}//${parsed.host}/*`, `${wsProtocol}//${parsed.host}/*`];
}

export function matchesSigningTarget(requestUrl: string, origin: string): boolean {
  let target: URL;
  let expected: URL;
  try {
    target = new URL(requestUrl);
    expected = new URL(origin);
  } catch {
    return false;
  }
  const expectedWs = expected.protocol === 'https:' ? 'wss:' : 'ws:';
  if (target.protocol !== expected.protocol && target.protocol !== expectedWs) return false;
  return target.host === expected.host;
}

function isOwnedRealDir(path: string): boolean {
  try {
    const stat = lstatSync(path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return false;
    if (process.getuid !== undefined && stat.uid !== process.getuid()) return false;
    return true;
  } catch {
    return false;
  }
}

export function defaultLocalServerHomes(opts: {
  env: NodeJS.ProcessEnv;
  desktopCairnHome: string;
  homeDir: string;
}): string[] {
  const raw = [
    opts.env[ENV_VARS.home],
    opts.desktopCairnHome,
    join(opts.homeDir, '.cairn-server'),
    join(opts.homeDir, BRAND.homeDirName),
  ].filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '');
  const seen = new Set<string>();
  const homes: string[] = [];
  for (const dir of raw) {
    const resolved = resolve(dir);
    if (!isOwnedRealDir(resolved)) continue;
    let key = resolved;
    try {
      key = realpathSync(resolved);
    } catch {}
    if (seen.has(key)) continue;
    seen.add(key);
    homes.push(resolved);
  }
  return homes;
}

function normalizeAddress(raw: string): string {
  const strippedZone = raw.trim().toLowerCase().split('%')[0] ?? '';
  const unwrapped =
    strippedZone.startsWith('[') && strippedZone.endsWith(']')
      ? strippedZone.slice(1, -1)
      : strippedZone;
  if (isIP(unwrapped) === 4) return unwrapped;
  if (isIP(unwrapped) === 6) {
    const parsed = URL.parse(`http://[${unwrapped}]/`);
    const canonical =
      parsed === null ? unwrapped : parsed.hostname.replace(/^\[/, '').replace(/\]$/, '');
    const mapped = IPV4_MAPPED_HEX.exec(canonical);
    if (mapped !== null) {
      const high = Number.parseInt(mapped[1] ?? '0', 16);
      const low = Number.parseInt(mapped[2] ?? '0', 16);
      return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
    }
    return canonical;
  }
  return unwrapped.startsWith('::ffff:') ? unwrapped.slice('::ffff:'.length) : unwrapped;
}

function isLoopbackIp(ip: string): boolean {
  const normalized = normalizeAddress(ip);
  return normalized === '::1' || normalized.startsWith('127.');
}

function readOwnedFile(path: string): string | null {
  let fd: number | undefined;
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) return null;
    if (process.getuid !== undefined && stat.uid !== process.getuid()) return null;
    fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const opened = fstatSync(fd);
    if (!opened.isFile() || opened.size > MAX_LOCAL_FILE_BYTES) return null;
    if (process.getuid !== undefined && opened.uid !== process.getuid()) return null;
    return readFileSync(fd, 'utf8');
  } catch {
    return null;
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {}
    }
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readOwnedServerOwnerPort(home: string): number | null {
  const raw = readOwnedFile(join(home, SERVER_OWNER_FILE));
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as { pid?: unknown; port?: unknown };
    if (
      typeof parsed.port !== 'number' ||
      !Number.isInteger(parsed.port) ||
      parsed.port < 1 ||
      parsed.port > 65535
    ) {
      return null;
    }
    if (typeof parsed.pid !== 'number' || !Number.isInteger(parsed.pid) || parsed.pid <= 0) {
      return null;
    }
    if (!pidAlive(parsed.pid)) return null;
    return parsed.port;
  } catch {
    return null;
  }
}

function loadLocalHomes(candidateHomes: readonly string[]): LocalHomeCandidate[] {
  const loaded: LocalHomeCandidate[] = [];
  for (const home of candidateHomes) {
    if (!isOwnedRealDir(home)) continue;
    const serverDir = join(home, 'server');
    if (!isOwnedRealDir(serverDir)) continue;
    const envIdRaw = readOwnedFile(join(serverDir, 'environment-id'));
    const tokenRaw = readOwnedFile(join(home, ACCESS_TOKEN_FILE_NAME));
    if (envIdRaw === null || tokenRaw === null) continue;
    const environmentId = envIdRaw.trim();
    const token = parseAccessTokenFile(tokenRaw);
    if (environmentId === '' || token === null) continue;
    loaded.push({
      home,
      environmentId,
      token,
      ownerPort: readOwnedServerOwnerPort(home),
    });
  }
  return loaded;
}

function localInterfaceSet(getInterfaces: () => NodeJS.Dict<NetworkInterfaceInfo[]>): Set<string> {
  const addresses = new Set<string>(['127.0.0.1', '::1']);
  const map = getInterfaces();
  for (const entries of Object.values(map)) {
    if (entries === undefined) continue;
    for (const info of entries) {
      const normalized = normalizeAddress(info.address);
      if (normalized !== '') addresses.add(normalized);
    }
  }
  return addresses;
}

function formatHostIp(ip: string): string {
  return ip.includes(':') ? `[${ip}]` : ip;
}

function canonicalOrigin(raw: string): string | null {
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

async function fetchDescriptorEnvironmentId(
  origin: string,
  fetchImpl: typeof fetch,
): Promise<string | null> {
  try {
    const res = await fetchImpl(`${origin}/api/remote/descriptor`, {
      redirect: 'error',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!res.ok || res.redirected) return null;
    const parsed = remoteDescriptorSchema.safeParse(await res.json());
    return parsed.success ? parsed.data.environmentId : null;
  } catch {
    return null;
  }
}

async function verifyLocalProof(
  origin: string,
  environmentId: string,
  token: string,
  fetchImpl: typeof fetch,
): Promise<boolean> {
  const nonce = randomBytes(NONCE_BYTES).toString('hex');
  try {
    const res = await fetchImpl(`${origin}${LOCAL_PROOF_PATH}`, {
      method: 'POST',
      redirect: 'error',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nonce }),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!res.ok || res.redirected) return false;
    const parsed = localProofResponseSchema.safeParse(await res.json());
    if (!parsed.success) return false;
    const expected = createHmac('sha256', token)
      .update(`${LOCAL_PROOF_PREFIX}${environmentId}:${nonce}`)
      .digest();
    const actual = Buffer.from(parsed.data.proof, 'hex');
    return actual.byteLength === expected.byteLength && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function literalLocalCandidates(
  parsed: URL,
  resolvedIps: readonly string[],
  homes: readonly LocalHomeCandidate[],
): string[] {
  const candidates: string[] = [];
  const add = (raw: string) => {
    const normalized = canonicalOrigin(raw);
    if (normalized !== null && !candidates.includes(normalized)) candidates.push(normalized);
  };
  for (const home of homes) {
    if (home.ownerPort !== null) add(`http://127.0.0.1:${home.ownerPort}`);
  }
  if (parsed.protocol === 'http:') {
    const port = parsed.port || '80';
    add(`http://127.0.0.1:${port}`);
    for (const ip of resolvedIps) {
      if (!isLoopbackIp(ip)) add(`http://${formatHostIp(ip)}:${port}`);
      else if (ip === '::1') add(`http://[::1]:${port}`);
    }
  } else {
    add(`http://127.0.0.1:${DEFAULT_RESIDENT_PORT}`);
  }
  return candidates;
}

export async function resolveLocalHostOwner(
  opts: ResolveLocalHostOwnerOptions,
): Promise<LocalHostOwner | null> {
  let parsed: URL;
  try {
    parsed = new URL(opts.origin);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;

  const homes = loadLocalHomes(opts.candidateHomes);
  if (homes.length === 0) return null;

  const localIps = localInterfaceSet(opts.networkInterfaces ?? osNetworkInterfaces);
  const isLocal = (ip: string): boolean => isLoopbackIp(ip) || localIps.has(ip);
  const host = normalizeAddress(parsed.hostname);
  let resolvedIps: string[];
  if (host === 'localhost') {
    resolvedIps = ['127.0.0.1'];
  } else if (isIP(host) !== 0) {
    if (!isLocal(host)) return null;
    resolvedIps = [host];
  } else {
    const lookup = opts.lookup ?? ((hostname: string) => dnsLookup(hostname, { all: true }));
    let records: ReadonlyArray<{ address: string; family: number }>;
    try {
      records = await lookup(host);
    } catch {
      return null;
    }
    if (records.length === 0) return null;
    resolvedIps = records.map((entry) => normalizeAddress(entry.address));
    if (!resolvedIps.every(isLocal)) return null;
  }

  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const originEnvId = await fetchDescriptorEnvironmentId(parsed.origin, fetchImpl);
  if (originEnvId === null) return null;

  const matchedHome = homes.find((home) => home.environmentId === originEnvId);
  if (matchedHome === undefined) return null;

  for (const candidate of literalLocalCandidates(parsed, resolvedIps, [matchedHome])) {
    const candidateEnvId =
      candidate === parsed.origin
        ? originEnvId
        : await fetchDescriptorEnvironmentId(candidate, fetchImpl);
    if (candidateEnvId !== matchedHome.environmentId) continue;
    if (
      await verifyLocalProof(candidate, matchedHome.environmentId, matchedHome.token, fetchImpl)
    ) {
      return {
        origin: candidate,
        token: matchedHome.token,
        home: matchedHome.home,
        environmentId: matchedHome.environmentId,
      };
    }
  }

  return null;
}
