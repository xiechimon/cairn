import { expect, test } from 'vitest';
import {
  type HostIdentitySources,
  hostKeyOf,
  probeHostKey,
  readHardwareId,
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

test('usableHardwareId rejects empty, oversized and control-character ids', () => {
  expect(usableHardwareId(null)).toBeNull();
  expect(usableHardwareId('   ')).toBeNull();
  expect(usableHardwareId('x'.repeat(257))).toBeNull();
  expect(usableHardwareId('ab\nc')).toBeNull();
  expect(usableHardwareId('  hardware-1  ')).toBe('hardware-1');
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

test('hostKeyOf is a 64-hex sha256 of the hardware id and runner home', () => {
  const a = hostKeyOf({ hardwareId: 'hw-1', home: '/r/home' });
  expect(a).toMatch(/^[a-f0-9]{64}$/);
  expect(hostKeyOf({ hardwareId: 'hw-2', home: '/r/home' })).not.toBe(a);
  expect(hostKeyOf({ hardwareId: 'hw-1', home: '/r/other' })).not.toBe(a);
});

test('probeHostKey is restart-stable for one host', () => {
  expect(probeHostKey('/runner/home', sources())).toBe(probeHostKey('/runner/home', sources()));
  expect(probeHostKey('/runner/home', sources())).not.toBe(
    probeHostKey('/runner/other', sources()),
  );
});

test('probeHostKey returns null when no hardware id can be read', () => {
  expect(probeHostKey('/runner/home', sources({ run: () => null }))).toBeNull();
  expect(probeHostKey('/runner/home', sources({ platform: 'linux' }))).toBeNull();
});
