import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ComputerCall, MachinePhoneReport } from '@cairn/shared';
import { phoneManageParamsSchema, phoneManageResultSchema, sleep } from '@cairn/shared';
import { sha256File } from '@cairn/shared/managed-bin';
import type { HostScreen } from './host-screen.js';
import { AndroidPhone } from './phone-android.js';
import {
  ADB_INSTALL_HINT,
  type AdbRun,
  findAdb,
  probeAndroidPhones,
  spawnAdb,
} from './phone-probe.js';

const YADB_URL = 'https://github.com/ysbing/YADB/releases/download/v1.1.3/yadb';
const YADB_SHA256 = '5274791fd4d915f39621806382980534ddfdb2bff961037fb9ffeac0ee00d3c6';
const PROBE_INTERVAL_MS = 15_000;

export interface Phones {
  usable(): boolean;
  reports(): MachinePhoneReport[];
  refresh(): Promise<void>;
  setAdbPath(path: string): void;
  setConsented(list: readonly { deviceId: string; phoneId: string }[]): void;
  screen(call: ComputerCall): HostScreen | null;
  manage(call: ComputerCall, signal?: AbortSignal): Promise<{ text: string }>;
  killAll(): Promise<void>;
}

export interface PhonesOptions {
  home: string;
  env?: NodeJS.ProcessEnv;
  log?: (msg: string) => void;
  probeMs?: number;
  adbPath?: string | null;
  expectAdb?: boolean;
  run?: AdbRun;
  spawnAdbImpl?: (path: string) => AdbRun;
  yadbLocal?: string | null;
  checkConsent?: (phoneId: string, deviceId: string, callId?: string) => Promise<boolean>;
  prepareAdb?: (signal?: AbortSignal) => Promise<string>;
  onAdbReady?: () => void;
  onStale?: () => void;
}

const YADB_FETCH_TIMEOUT_MS = 30_000;

function yadbHashOk(target: string): boolean {
  try {
    return sha256File(target) === YADB_SHA256;
  } catch {
    return false;
  }
}

async function downloadYadb(target: string, log: (msg: string) => void): Promise<string | null> {
  if (existsSync(target)) {
    if (yadbHashOk(target)) return target;
    rmSync(target, { force: true });
    log('yadb cache failed the pinned hash; re-downloading');
  }
  try {
    const response = await fetch(YADB_URL, {
      signal: AbortSignal.timeout(YADB_FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      log(`yadb download failed: HTTP ${response.status}`);
      return null;
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (digest !== YADB_SHA256) {
      log(`yadb download failed: sha256 ${digest} != pinned ${YADB_SHA256}`);
      return null;
    }
    mkdirSync(join(target, '..'), { recursive: true });
    const tmp = `${target}.download`;
    writeFileSync(tmp, bytes);
    renameSync(tmp, target);
    return target;
  } catch (error) {
    log(`yadb download failed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

export function createPhones(opts: PhonesOptions): Phones {
  let adbPath = opts.adbPath !== undefined ? opts.adbPath : findAdb(opts.env);
  const log = opts.log ?? (() => {});
  if (adbPath === null && opts.expectAdb !== true) log(`adb not found: ${ADB_INSTALL_HINT}`);
  let adbImpl: AdbRun | null = opts.run ?? (adbPath !== null ? spawnAdb(adbPath) : null);
  let preparingAdb: Promise<string> | null = null;
  const adoptAdb = (prepared: string): void => {
    const wasUsable = adbPath !== null;
    adbPath = prepared;
    if (opts.run === undefined) adbImpl = spawnAdb(prepared);
    if (!wasUsable) opts.onAdbReady?.();
    void refresh();
  };
  const prepareManagedAdb = (signal?: AbortSignal): Promise<string> => {
    const prepare = opts.prepareAdb;
    if (prepare === undefined) return Promise.reject(new Error('adb not found'));
    preparingAdb ??= prepare(signal)
      .then((prepared) => {
        if (signal?.aborted === true) throw new Error('phone support preparation was cancelled');
        adoptAdb(prepared);
        return prepared;
      })
      .finally(() => {
        preparingAdb = null;
      });
    return preparingAdb;
  };
  const adb: AdbRun =
    opts.run ??
    (async (args, runOpts) => {
      if (adbImpl === null) await prepareManagedAdb(runOpts?.signal);
      if (adbImpl === null) throw new Error('adb not found');
      return adbImpl(args, runOpts);
    });
  const yadbTarget = join(opts.home, 'phone', 'yadb');
  let latest: MachinePhoneReport[] = [];
  let serialByDeviceId = new Map<string, string>();
  let probeRunning: Promise<void> | null = null;
  const consented = new Map<string, string>();
  const drivers = new Map<string, AndroidPhone>();
  const driverPhoneIds = new Map<string, string>();
  const timer =
    adbPath !== null || opts.run !== undefined || opts.expectAdb === true
      ? setInterval(() => void refresh(), opts.probeMs ?? PROBE_INTERVAL_MS)
      : null;
  timer?.unref?.();

  const yadb =
    opts.yadbLocal !== undefined
      ? () => Promise.resolve(opts.yadbLocal ?? null)
      : () => downloadYadb(yadbTarget, log);

  async function refresh(): Promise<void> {
    if (probeRunning !== null) return probeRunning;
    if (adbImpl === null && opts.run === undefined) return;
    probeRunning = (async () => {
      try {
        const probe = await probeAndroidPhones(adb);
        latest = probe.reports;
        serialByDeviceId = probe.serialByDeviceId;
        for (const [deviceId, driver] of drivers) {
          const serial = serialByDeviceId.get(deviceId);
          if (serial !== undefined) driver.updateSerial(serial);
          else driver.markUnreachable();
        }
      } catch (error) {
        latest = [];
        serialByDeviceId = new Map();
        for (const driver of drivers.values()) driver.markUnreachable();
        log(`phone probe failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    })().finally(() => {
      probeRunning = null;
    });
    return probeRunning;
  }
  void refresh();

  function consentFor(
    phoneId: string,
    deviceId: string,
  ): ((callId?: string) => Promise<boolean>) | undefined {
    const check = opts.checkConsent;
    if (check === undefined) return undefined;
    return (callId) => check(phoneId, deviceId, callId);
  }

  function driverFor(deviceId: string): AndroidPhone | null {
    const cached = drivers.get(deviceId);
    if (cached !== undefined) {
      const phoneId = consented.get(deviceId);
      if (phoneId !== undefined) {
        cached.setConsent(consentFor(phoneId, deviceId));
        driverPhoneIds.set(deviceId, phoneId);
      }
      return cached;
    }
    const report = latest.find((entry) => entry.deviceId === deviceId);
    if (report !== undefined && report.platform !== 'android') return null;
    if (report === undefined && !consented.has(deviceId)) return null;
    const phoneId = consented.get(deviceId);
    const driver = new AndroidPhone({
      serial: serialByDeviceId.get(deviceId) ?? deviceId,
      adb,
      yadb,
      ...(phoneId !== undefined ? { consent: consentFor(phoneId, deviceId) } : {}),
    });
    drivers.set(deviceId, driver);
    if (phoneId !== undefined) driverPhoneIds.set(deviceId, phoneId);
    return driver;
  }

  return {
    usable: () => adbPath !== null,
    reports: () => latest,
    refresh,
    setAdbPath(path) {
      if (opts.run !== undefined || path === adbPath) return;
      adoptAdb(path);
    },
    setConsented(list) {
      consented.clear();
      const consentedPhoneIds = new Set<string>();
      for (const entry of list) {
        consented.set(entry.deviceId, entry.phoneId);
        consentedPhoneIds.add(entry.phoneId);
      }
      for (const deviceId of [...drivers.keys()]) {
        const phoneId = driverPhoneIds.get(deviceId);
        if (consented.has(deviceId) || (phoneId !== undefined && consentedPhoneIds.has(phoneId))) {
          continue;
        }
        const driver = drivers.get(deviceId);
        drivers.delete(deviceId);
        driverPhoneIds.delete(deviceId);
        void driver?.killAll().catch(() => {});
      }
    },
    screen(call) {
      const stamp = call.phone;
      if (stamp === undefined) return null;
      if (adbPath === null && opts.run === undefined && opts.prepareAdb === undefined) return null;
      if (consented.get(stamp.deviceId) !== stamp.phoneId) {
        void refresh().then(() => opts.onStale?.());
        return null;
      }
      const driver = driverFor(stamp.deviceId);
      if (driver === null) void refresh().then(() => opts.onStale?.());
      return driver;
    },
    async manage(call, signal) {
      const parsed = phoneManageParamsSchema.safeParse(call.params);
      if (!parsed.success) return { text: 'phone_manage params are not a known action' };
      const stamp = call.phone;
      if (stamp === undefined) return { text: 'phone_manage carries no consented phone stamp' };
      if (parsed.data.action !== 'forget' && consented.get(stamp.deviceId) !== stamp.phoneId) {
        void refresh().then(() => opts.onStale?.());
        const deadline = Date.now() + 3_000;
        while (Date.now() < deadline && consented.get(stamp.deviceId) !== stamp.phoneId)
          await sleep(50);
        if (consented.get(stamp.deviceId) !== stamp.phoneId)
          return { text: 'phone_manage carries no consented phone stamp' };
      }
      if (parsed.data.action === 'pair' && opts.prepareAdb !== undefined) {
        await prepareManagedAdb(signal);
      }
      const driver =
        driverFor(stamp.deviceId) ??
        new AndroidPhone({
          serial: serialByDeviceId.get(stamp.deviceId) ?? stamp.deviceId,
          adb,
          yadb,
          consent: consentFor(stamp.phoneId, stamp.deviceId),
        });
      if (parsed.data.action === 'pair') {
        const result = await driver.pair({
          ...(parsed.data.code !== undefined ? { code: parsed.data.code } : {}),
          ...(parsed.data.endpoint !== undefined ? { endpoint: parsed.data.endpoint } : {}),
          ...(signal !== undefined ? { signal } : {}),
          callId: call.callId,
        });
        drivers.delete(stamp.deviceId);
        driverPhoneIds.delete(stamp.deviceId);
        driver.setConsent(consentFor(stamp.phoneId, result.deviceId));
        if (!driver.dropped) {
          const displaced = drivers.get(result.deviceId);
          if (displaced !== undefined && displaced !== driver)
            void displaced.killAll().catch(() => {});
          drivers.set(result.deviceId, driver);
          driverPhoneIds.set(result.deviceId, stamp.phoneId);
          await refresh();
          serialByDeviceId = new Map(serialByDeviceId);
          serialByDeviceId.set(result.deviceId, driver.transportSerial);
          queueMicrotask(() => opts.onStale?.());
        }
        return { text: JSON.stringify(phoneManageResultSchema.parse(result)) };
      }
      drivers.delete(stamp.deviceId);
      driverPhoneIds.delete(stamp.deviceId);
      const result = await driver.forget();
      void driver.killAll();
      return { text: JSON.stringify(phoneManageResultSchema.parse(result)) };
    },
    async killAll() {
      if (timer !== null) clearInterval(timer);
      for (const driver of drivers.values()) await driver.killAll();
      drivers.clear();
      driverPhoneIds.clear();
    },
  };
}
