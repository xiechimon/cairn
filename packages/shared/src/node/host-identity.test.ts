import { expect, test } from 'vitest';
import {
  collectLegacyHostKeys,
  type HostIdentitySources,
  hostKeyOf,
  legacyHostKeyOf,
  probeHostIdentity,
  probeHostKey,
  readHardwareId,
  standardLegacyRunnerHomes,
  usableHardwareId,
} from './host-identity.js';

const IOREG_OUT = `
+-o IOPlatformExpertDevice  <class IOPlatformExpertDevice>
    {
      "IOPlatformUUID" = "12345678-1234-1234-1234-1234567890AB"
    }
`;

function sources(overrides: Partial<HostIdentitySources> = {}): HostIdentitySources {
  return {
    platform: 'darwin',
    readFile: () => null,
    run: () => IOREG_OUT,
    ...overrides,
  };
}

test('usableHardwareId rejects empty, oversized, control-character and placeholder ids', () => {
  expect(usableHardwareId(null)).toBeNull();
  expect(usableHardwareId('   ')).toBeNull();
  expect(usableHardwareId('x'.repeat(257))).toBeNull();
  expect(usableHardwareId('ab\nc')).toBeNull();
  expect(usableHardwareId('uninitialized')).toBeNull();
  expect(usableHardwareId('UNINITIALIZED')).toBeNull();
  expect(usableHardwareId('empty')).toBeNull();
  expect(usableHardwareId('unknown')).toBeNull();
  expect(usableHardwareId('00000000000000000000000000000000')).toBeNull();
  expect(usableHardwareId('00000000-0000-0000-0000-000000000000')).toBeNull();
  expect(usableHardwareId('11111111-1111-1111-1111-111111111111')).toBeNull();
  expect(usableHardwareId('ffffffff-ffff-ffff-ffff-ffffffffffff')).toBeNull();
  expect(usableHardwareId('03000200-0400-0500-0006-000700080009')).toBeNull();
  expect(usableHardwareId('  hardware-1  ')).toBe('hardware-1');
  expect(
    collectLegacyHostKeys(
      null,
      Array.from({ length: 12 }, (_, idx) => `${idx}`.repeat(64).slice(0, 64)),
    ),
  ).toHaveLength(8);
});

test('readHardwareId parses IOPlatformUUID on darwin', () => {
  expect(readHardwareId(sources())).toBe('12345678-1234-1234-1234-1234567890AB');
  expect(readHardwareId(sources({ run: () => null }))).toBeNull();
});

test('readHardwareId prefers /etc/machine-id on linux, falling back to the dbus copy', () => {
  const files: Record<string, string> = {};
  const linux = (read: (path: string) => string | null) =>
    sources({ platform: 'linux', readFile: read });
  expect(
    readHardwareId(
      linux((path) => files[path] ?? (path === '/etc/machine-id' ? 'machine-1' : null)),
    ),
  ).toBe('machine-1');
  expect(
    readHardwareId(linux((path) => (path === '/var/lib/dbus/machine-id' ? 'dbus-1' : null))),
  ).toBe('dbus-1');
  expect(readHardwareId(linux(() => null))).toBeNull();
});

test('hostKeyOf is a 64-hex sha256 of the hardware id alone', () => {
  const a = hostKeyOf('hw-1');
  expect(a).toMatch(/^[a-f0-9]{64}$/);
  expect(hostKeyOf('hw-2')).not.toBe(a);
  expect(legacyHostKeyOf({ hardwareId: 'hw-1', home: '/r/home' })).not.toBe(a);
  expect(legacyHostKeyOf({ hardwareId: 'hw-1', home: '/r/home' })).not.toBe(
    legacyHostKeyOf({ hardwareId: 'hw-1', home: '/r/other' }),
  );
});

test('probeHostKey and probeHostIdentity keep one host key across runner homes', () => {
  const macSources = sources({ userHome: '/Users/owner' });
  const desktop = probeHostIdentity(
    '/Users/owner/Library/Application Support/Cairn/runner',
    macSources,
  );
  const cli = probeHostIdentity('/Users/owner/.cairn', macSources);
  expect(desktop?.hostKey).toBe(probeHostKey(macSources));
  expect(desktop?.hostKey).toBe(cli?.hostKey);
  expect(desktop?.legacyHostKey).not.toBe(cli?.legacyHostKey);
  expect(cli?.legacyHostKeys).toContain(desktop?.legacyHostKey);
  expect(cli?.legacyHostKeys).toContain(cli?.legacyHostKey);
  expect(desktop?.legacyHostKeys).toContain(cli?.legacyHostKey);
  expect(
    standardLegacyRunnerHomes({
      home: '/Users/owner/.cairn',
      platform: 'darwin',
      userHome: '/Users/owner',
    }),
  ).toEqual([
    '/Users/owner/.cairn',
    '/Users/owner/Library/Application Support/Cairn/runner',
    '/Users/owner/Library/Application Support/Cairn/runner-home',
  ]);
  expect(
    collectLegacyHostKeys(desktop?.hostKey, [
      desktop?.legacyHostKey,
      desktop?.hostKey,
      cli?.legacyHostKey,
      desktop?.legacyHostKey,
    ]),
  ).toEqual([desktop?.legacyHostKey, cli?.legacyHostKey]);
});

test('probeHostKey returns null when no hardware id can be read', () => {
  expect(probeHostKey(sources({ run: () => null }))).toBeNull();
  expect(probeHostKey(sources({ platform: 'linux' }))).toBeNull();
  expect(probeHostIdentity('/runner/home', sources({ run: () => null }))).toBeNull();
});
