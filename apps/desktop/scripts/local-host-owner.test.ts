import { createHmac } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ACCESS_TOKEN_FILE_NAME,
  formatAccessTokenFile,
  LOCAL_PROOF_PATH,
  LOCAL_PROOF_PREFIX,
} from '@cairn/shared';
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  matchesSigningTarget,
  ownerSigningUrls,
  resolveLocalHostOwner,
} from '../src/local-host-owner.js';
import { SERVER_OWNER_FILE } from '../src/resident-host.js';

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cairn-local-host-owner-'));
  dirs.push(dir);
  return dir;
}

function seedLocalHome(
  base: string,
  name: string,
  environmentId: string,
  token: string,
  ownerPort?: number,
): string {
  const home = join(base, name);
  mkdirSync(join(home, 'server'), { recursive: true, mode: 0o700 });
  writeFileSync(join(home, 'server', 'environment-id'), `${environmentId}\n`, { mode: 0o600 });
  writeFileSync(join(home, ACCESS_TOKEN_FILE_NAME), formatAccessTokenFile(token), { mode: 0o600 });
  if (ownerPort !== undefined) {
    writeFileSync(
      join(home, SERVER_OWNER_FILE),
      JSON.stringify({
        pid: process.pid,
        port: ownerPort,
        origin: `http://127.0.0.1:${ownerPort}`,
        managedBy: 'launchd',
        startedAt: Date.now(),
      }),
      { mode: 0o600 },
    );
  }
  return home;
}

function makeProof(token: string, environmentId: string, nonce: string): string {
  return createHmac('sha256', token)
    .update(`${LOCAL_PROOF_PREFIX}${environmentId}:${nonce}`)
    .digest('hex');
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('resolveLocalHostOwner', () => {
  const ENV_ID = '0f9d3a52-6c1e-4b7a-9d3e-5a1c2b4d6e80';
  const TOKEN = 'host-owner-token-0123456789abcdef0123456789abcdef';

  test('recognizes a tailnet hostname resolving to this host via mutual HMAC proof without sending the token', async () => {
    const root = tempDir();
    const serverHome = seedLocalHome(root, '.cairn-server', ENV_ID, TOKEN);
    const seenAuthUrls: string[] = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const headers = new Headers(init?.headers);
      if (headers.has('authorization')) seenAuthUrls.push(url);
      if (url.endsWith('/api/remote/descriptor')) {
        return Response.json({ environmentId: ENV_ID, version: 1 });
      }
      if (url === `http://127.0.0.1:8787${LOCAL_PROOF_PATH}` && typeof init?.body === 'string') {
        const { nonce } = JSON.parse(init.body) as { nonce: string };
        return Response.json({ proof: makeProof(TOKEN, ENV_ID, nonce) });
      }
      return new Response(null, { status: 404 });
    }) as unknown as typeof fetch;

    const resolved = await resolveLocalHostOwner({
      origin: 'http://mac-mini.tail0000.ts.net:8787',
      candidateHomes: [serverHome],
      lookup: async () => [{ address: '100.64.0.21', family: 4 }],
      networkInterfaces: () => ({
        utun4: [
          {
            address: '100.64.0.21',
            netmask: '255.255.255.255',
            family: 'IPv4',
            mac: '00:00:00:00:00:00',
            internal: false,
            cidr: '100.64.0.21/32',
          },
        ],
      }),
      fetchImpl,
    });

    expect(resolved).toEqual({
      origin: 'http://127.0.0.1:8787',
      token: TOKEN,
      home: serverHome,
      environmentId: ENV_ID,
    });
    expect(seenAuthUrls).toEqual([]);
  });

  test('rejects a local port squatter echoing the public environmentId without valid HMAC proof', async () => {
    const root = tempDir();
    const serverHome = seedLocalHome(root, '.cairn-server', ENV_ID, TOKEN);
    const seenAuthUrls: string[] = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const headers = new Headers(init?.headers);
      if (headers.has('authorization')) seenAuthUrls.push(url);
      if (url.endsWith('/api/remote/descriptor')) {
        return Response.json({ environmentId: ENV_ID, version: 1 });
      }
      if (url.endsWith(LOCAL_PROOF_PATH)) {
        return Response.json({ proof: '0'.repeat(64) });
      }
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;

    const resolved = await resolveLocalHostOwner({
      origin: 'http://mac-mini.tail0000.ts.net:8787',
      candidateHomes: [serverHome],
      lookup: async () => [{ address: '100.64.0.21', family: 4 }],
      networkInterfaces: () => ({
        utun4: [
          {
            address: '100.64.0.21',
            netmask: '255.255.255.255',
            family: 'IPv4',
            mac: '00:00:00:00:00:00',
            internal: false,
            cidr: '100.64.0.21/32',
          },
        ],
      }),
      fetchImpl,
    });

    expect(resolved).toBeNull();
    expect(seenAuthUrls).toEqual([]);
  });

  test('prefers validated server-owner.json port before default loopback port and canonicalizes port 80', async () => {
    const root = tempDir();
    const serverHome = seedLocalHome(root, '.cairn-server', ENV_ID, TOKEN, 9123);
    const probed: string[] = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      probed.push(url);
      if (url.endsWith('/api/remote/descriptor')) {
        return Response.json({ environmentId: ENV_ID, version: 1 });
      }
      if (url === `http://127.0.0.1:9123${LOCAL_PROOF_PATH}` && typeof init?.body === 'string') {
        const { nonce } = JSON.parse(init.body) as { nonce: string };
        return Response.json({ proof: makeProof(TOKEN, ENV_ID, nonce) });
      }
      return new Response(null, { status: 404 });
    }) as unknown as typeof fetch;

    const resolved = await resolveLocalHostOwner({
      origin: 'https://mac-mini.tail0000.ts.net',
      candidateHomes: [serverHome],
      lookup: async () => [{ address: '100.64.0.21', family: 4 }],
      networkInterfaces: () => ({
        utun4: [
          {
            address: '100.64.0.21',
            netmask: '255.255.255.255',
            family: 'IPv4',
            mac: '00:00:00:00:00:00',
            internal: false,
            cidr: '100.64.0.21/32',
          },
        ],
      }),
      fetchImpl,
    });

    expect(resolved?.origin).toBe('http://127.0.0.1:9123');
    expect(probed).not.toContain('http://127.0.0.1:8787/api/remote/descriptor');
  });

  test('never treats a remote host as local and never sends any probe off-host', async () => {
    const root = tempDir();
    const serverHome = seedLocalHome(root, '.cairn-server', ENV_ID, TOKEN);
    const fetchImpl = vi.fn(async () =>
      Response.json({ environmentId: ENV_ID, version: 1 }),
    ) as unknown as typeof fetch;

    const resolved = await resolveLocalHostOwner({
      origin: 'http://mac-mini.tail0000.ts.net:8787',
      candidateHomes: [serverHome],
      lookup: async () => [{ address: '100.64.0.21', family: 4 }],
      networkInterfaces: () => ({
        utun4: [
          {
            address: '100.64.0.22',
            netmask: '255.255.255.255',
            family: 'IPv4',
            mac: '00:00:00:00:00:00',
            internal: false,
            cidr: '100.64.0.22/32',
          },
        ],
      }),
      fetchImpl,
    });

    expect(resolved).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('rejects DNS names that resolve to a mix of local and non-local addresses', async () => {
    const root = tempDir();
    const serverHome = seedLocalHome(root, '.cairn-server', ENV_ID, TOKEN);
    const fetchImpl = vi.fn() as unknown as typeof fetch;

    const resolved = await resolveLocalHostOwner({
      origin: 'http://rebind.example.com:8787',
      candidateHomes: [serverHome],
      lookup: async () => [
        { address: '127.0.0.1', family: 4 },
        { address: '203.0.113.5', family: 4 },
      ],
      networkInterfaces: () => ({}),
      fetchImpl,
    });

    expect(resolved).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('returns null without sending proof when the local port runs a different environmentId', async () => {
    const root = tempDir();
    const serverHome = seedLocalHome(root, '.cairn-server', ENV_ID, TOKEN);
    const seenProof: string[] = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith(LOCAL_PROOF_PATH)) seenProof.push(url);
      return Response.json({ environmentId: 'other-env-id', version: 1 });
    }) as unknown as typeof fetch;

    const resolved = await resolveLocalHostOwner({
      origin: 'http://127.0.0.1:8787',
      candidateHomes: [serverHome],
      lookup: async () => [{ address: '127.0.0.1', family: 4 }],
      networkInterfaces: () => ({}),
      fetchImpl,
    });

    expect(resolved).toBeNull();
    expect(seenProof).toEqual([]);
  });

  test('enforces exact canonical host+port and scheme in matchesSigningTarget to block cross-port token leaks', () => {
    expect(ownerSigningUrls('http://127.0.0.1:8787')).toEqual([
      'http://127.0.0.1:8787/*',
      'ws://127.0.0.1:8787/*',
    ]);
    expect(ownerSigningUrls('https://cairn.example.com:8443')).toEqual([
      'https://cairn.example.com:8443/*',
      'wss://cairn.example.com:8443/*',
    ]);
    expect(matchesSigningTarget('http://127.0.0.1/api/teams', 'http://127.0.0.1')).toBe(true);
    expect(matchesSigningTarget('ws://127.0.0.1/stream', 'http://127.0.0.1')).toBe(true);
    expect(matchesSigningTarget('http://127.0.0.1:3000/img.png', 'http://127.0.0.1')).toBe(false);
    expect(matchesSigningTarget('https://127.0.0.1/api/teams', 'http://127.0.0.1')).toBe(false);
    expect(matchesSigningTarget('http://127.0.0.1:8787/api/teams', 'http://127.0.0.1:8787')).toBe(
      true,
    );
    expect(matchesSigningTarget('http://127.0.0.1:8788/api/teams', 'http://127.0.0.1:8787')).toBe(
      false,
    );
  });
});
