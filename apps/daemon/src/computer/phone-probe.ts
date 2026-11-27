import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { cutTailOfLastLine, isPrivateIpv4Endpoint, type MachinePhoneReport } from '@cairn/shared';

export interface AdbResult {
  code: number;
  stdout: Buffer;
  stderr: Buffer;
}

export interface AdbRunOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  input?: Buffer;
}

export type AdbRun = (args: readonly string[], opts?: AdbRunOptions) => Promise<AdbResult>;

export const ADB_TIMEOUT_MS = 15_000;

export function spawnAdb(adbPath: string): AdbRun {
  return (args, opts = {}) =>
    new Promise((resolve, reject) => {
      const child = spawn(adbPath, [...args], {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: opts.timeoutMs ?? ADB_TIMEOUT_MS,
        signal: opts.signal,
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
      child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
      child.on('error', reject);
      child.on('close', (code, signalName) => {
        if (signalName !== null) {
          reject(new Error(`adb ${args.join(' ')} killed by ${signalName}`));
          return;
        }
        resolve({
          code: code ?? -1,
          stdout: Buffer.concat(stdout),
          stderr: Buffer.concat(stderr),
        });
      });
      if (opts.input !== undefined) child.stdin.end(opts.input);
      else child.stdin.end();
    });
}

const ADB_CANDIDATE_DIRS = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin'];

export function findAdb(env: NodeJS.ProcessEnv = process.env): string | null {
  const pathDirs = (env.PATH ?? '').split(delimiter).filter((dir) => dir !== '');
  const home = env.HOME ?? '';
  const candidates = [
    ...pathDirs.map((dir) => join(dir, 'adb')),
    ...ADB_CANDIDATE_DIRS.map((dir) => join(dir, 'adb')),
    ...(home !== ''
      ? [
          join(home, 'Library/Android/sdk/platform-tools/adb'),
          join(home, 'Android/Sdk/platform-tools/adb'),
        ]
      : []),
  ];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export const ADB_INSTALL_HINT =
  'Install Android platform-tools (brew install --cask android-platform-tools), then restart the Cairn runner';

export interface AdbDeviceEntry {
  serial: string;
  state: string;
  model: string | null;
  usb: string | null;
}

export interface MdnsService {
  name: string;
  address: string;
  serviceType: string;
}

export function parseAdbDevices(output: string): AdbDeviceEntry[] {
  const entries: AdbDeviceEntry[] = [];
  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('List of devices') || trimmed.startsWith('*'))
      continue;
    const [serial, state, ...attrs] = trimmed.split(/\s+/);
    if (serial === undefined || state === undefined) continue;
    const modelAttr = attrs.find((attr) => attr.startsWith('model:'));
    const usbAttr = attrs.find((attr) => attr.startsWith('usb:'));
    entries.push({
      serial,
      state,
      model: modelAttr === undefined ? null : modelAttr.slice(6).replace(/_/g, ' '),
      usb: usbAttr === undefined ? null : usbAttr.slice(4),
    });
  }
  return entries;
}

export function parseMdnsServices(output: string): MdnsService[] {
  const services: MdnsService[] = [];
  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('List of discovered')) continue;
    const match =
      /^(\S+)\s+(\S+)\s+(\S+:\d+)$/.exec(trimmed) ?? /^(\S+)\s+()(\S+:\d+)$/.exec(trimmed);
    if (match === null) continue;
    services.push({ name: match[1]!, serviceType: match[2]!, address: match[3]! });
  }
  return services;
}

const LOCKED_PATTERN =
  /mDreamingLockscreen=true|mShowingLockscreen=true|isStatusBarKeyguard=true|mKeyguardShowing=true/;

export function dumpsysLocked(output: string): boolean {
  return LOCKED_PATTERN.test(output);
}

function ipOf(address: string): string {
  const index = address.lastIndexOf(':');
  return index === -1 ? address : address.slice(0, index);
}

const MDNS_SERIAL_SUFFIX = /-(?=[0-9A-Za-z]*\d)[0-9A-Za-z]{8,}$/;

function mdnsName(name: string): string {
  const stripped = cutTailOfLastLine(name.replace(/^adb-/, ''), /\._adb/)
    .replace(/\.$/, '')
    .replace(MDNS_SERIAL_SUFFIX, '');
  return stripped.replace(/[-_]/g, ' ');
}

export interface AndroidPhoneProbe {
  reports: MachinePhoneReport[];
  serialByDeviceId: Map<string, string>;
}

function localTransport(device: AdbDeviceEntry): boolean {
  return device.usb !== null || device.serial.startsWith('emulator-');
}

export function normalizeAndroidId(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  return /^[0-9a-f]{8,64}$/.test(trimmed) ? `android:${trimmed}` : null;
}

function mdnsInstanceSerial(service: MdnsService): string {
  return `${service.name}.${service.serviceType.replace(/\.$/, '')}`;
}

export function mergePhoneReports(
  devices: readonly AdbDeviceEntry[],
  mdns: readonly MdnsService[],
  locks: ReadonlyMap<string, boolean>,
  stableIds: ReadonlyMap<string, string> = new Map(),
): MachinePhoneReport[] {
  const reports = new Map<string, MachinePhoneReport>();
  const transports = new Map<string, string>();
  const transportLocal = new Map<string, boolean>();
  for (const device of devices) {
    const deviceId = stableIds.get(device.serial) ?? device.serial;
    const existingTransport = transports.get(deviceId);
    const preferred = localTransport(device);
    if (existingTransport !== undefined && !(preferred && transportLocal.get(deviceId) === false))
      continue;
    transports.set(deviceId, device.serial);
    transportLocal.set(deviceId, preferred);
    const link =
      device.state === 'device'
        ? locks.get(device.serial) === true
          ? 'locked'
          : 'ready'
        : device.state === 'unauthorized'
          ? 'unauthorized'
          : 'offline';
    reports.set(deviceId, {
      deviceId,
      platform: 'android',
      name: device.model ?? deviceId,
      link,
    });
  }
  for (const service of mdns) {
    const ip = ipOf(service.address);
    const instance = mdnsInstanceSerial(service);
    const attached = devices.some(
      (device) => ipOf(device.serial) === ip || device.serial.replace(/\.$/, '') === instance,
    );
    if (attached) continue;
    const attachedId = stableIds.get(service.address) ?? service.address;
    if (reports.has(attachedId)) continue;
    reports.set(service.address, {
      deviceId: service.address,
      platform: 'android',
      name: mdnsName(service.name) || service.address,
      link: 'seen',
    });
  }
  return [...reports.values()];
}

export async function probeAndroidPhones(adb: AdbRun): Promise<AndroidPhoneProbe> {
  const devicesOut = await adb(['devices', '-l']);
  const mdnsOut = await adb(['mdns', 'services']).catch(() => ({
    code: 0,
    stdout: Buffer.alloc(0),
    stderr: Buffer.alloc(0),
  }));
  const devices = parseAdbDevices(devicesOut.stdout.toString('utf8'));
  const services = parseMdnsServices(mdnsOut.stdout.toString('utf8'));
  const connectServices = services.filter(
    (service) =>
      service.serviceType.startsWith('_adb-tls-connect') && isPrivateIpv4Endpoint(service.address),
  );
  const connectAddresses = new Set(connectServices.map((service) => service.address));
  const connectInstances = new Set(connectServices.map(mdnsInstanceSerial));
  const corroborated = devices.filter(
    (device) =>
      localTransport(device) ||
      connectAddresses.has(device.serial) ||
      connectInstances.has(device.serial.replace(/\.$/, '')),
  );
  const locks = new Map<string, boolean>();
  const stableIds = new Map<string, string>();
  await Promise.all(
    corroborated
      .filter((device) => device.state === 'device')
      .map(async (device) => {
        try {
          const [idOut, windowOut] = await Promise.all([
            adb(['-s', device.serial, 'shell', 'settings', 'get', 'secure', 'android_id']),
            adb(['-s', device.serial, 'shell', 'dumpsys', 'window']),
          ]);
          const stableId = normalizeAndroidId(idOut.stdout.toString('utf8'));
          if (stableId !== null) stableIds.set(device.serial, stableId);
          locks.set(
            device.serial,
            windowOut.code !== 0 || dumpsysLocked(windowOut.stdout.toString('utf8')),
          );
        } catch {
          locks.set(device.serial, true);
        }
      }),
  );
  const identified = corroborated.filter(
    (device) => device.state !== 'device' || stableIds.has(device.serial),
  );
  const reports = mergePhoneReports(identified, services, locks, stableIds);
  const serialByDeviceId = new Map<string, string>();
  const serialLocal = new Map<string, boolean>();
  for (const device of identified) {
    const deviceId = stableIds.get(device.serial) ?? device.serial;
    const existing = serialByDeviceId.get(deviceId);
    const preferred = localTransport(device);
    if (existing === undefined || (preferred && serialLocal.get(deviceId) === false))
      serialByDeviceId.set(deviceId, device.serial);
    if (existing === undefined || serialByDeviceId.get(deviceId) === device.serial)
      serialLocal.set(deviceId, preferred);
  }
  return { reports, serialByDeviceId };
}
