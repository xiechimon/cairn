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
  setConsented(list: readonly { deviceId: string; phoneId: string }[]): void;
  screen(call: ComputerCall): HostScreen | null;
  manage(call: ComputerCall): Promise<{ text: string }>;
  killAll(): Promise<void>;
}

export interface PhonesOptions {
  home: string;
  env?: NodeJS.ProcessEnv;
  log?: (msg: string) => void;
  probeMs?: number;
  adbPath?: string | null;
  run?: AdbRun;
  yadbLocal?: string | null;
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
  const adbPath = opts.adbPath !== undefined ? opts.adbPath : findAdb(opts.env);
  const log = opts.log ?? (() => {});
  if (adbPath === null) log(`adb not found: ${ADB_INSTALL_HINT}`);
  const adb: AdbRun =
    opts.run ??
    (adbPath !== null ? spawnAdb(adbPath) : () => Promise.reject(new Error('adb not found')));
  const yadbTarget = join(opts.home, 'phone', 'yadb');
  let latest: MachinePhoneReport[] = [];
  let probing = false;
  const consented = new Map<string, string>();
  const drivers = new Map<string, AndroidPhone>();
  const timer =
    adbPath !== null || opts.run !== undefined
      ? setInterval(() => void refresh(), opts.probeMs ?? PROBE_INTERVAL_MS)
      : null;
  timer?.unref?.();

  const yadb =
    opts.yadbLocal !== undefined
      ? () => Promise.resolve(opts.yadbLocal ?? null)
      : () => downloadYadb(yadbTarget, log);

  async function refresh(): Promise<void> {
    if (probing) return;
    probing = true;
    try {
      latest = await probeAndroidPhones(adb);
    } catch (error) {
      log(`phone probe failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      probing = false;
    }
  }
  void refresh();

  function driverFor(deviceId: string): AndroidPhone | null {
    const cached = drivers.get(deviceId);
    if (cached !== undefined) return cached;
    const report = latest.find((entry) => entry.deviceId === deviceId);
    if (report !== undefined && report.platform !== 'android') return null;
    if (report === undefined && !consented.has(deviceId)) return null;
    const driver = new AndroidPhone({ serial: deviceId, adb, yadb });
    drivers.set(deviceId, driver);
    return driver;
  }

  return {
    usable: () => adbPath !== null,
    reports: () => latest,
    refresh,
    setConsented(list) {
      consented.clear();
      for (const entry of list) consented.set(entry.deviceId, entry.phoneId);
      for (const deviceId of [...drivers.keys()]) {
        if (consented.has(deviceId)) continue;
        const driver = drivers.get(deviceId);
        drivers.delete(deviceId);
        void driver?.killAll().catch(() => {});
      }
    },
    screen(call) {
      const stamp = call.phone;
      if (stamp === undefined) return null;
      if (adbPath === null && opts.run === undefined) return null;
      if (consented.get(stamp.deviceId) !== stamp.phoneId) {
        void refresh().then(() => opts.onStale?.());
        return null;
      }
      const driver = driverFor(stamp.deviceId);
      if (driver === null) void refresh().then(() => opts.onStale?.());
      return driver;
    },
    async manage(call) {
      const parsed = phoneManageParamsSchema.safeParse(call.params);
      if (!parsed.success) return { text: 'phone_manage params are not a known action' };
      const stamp = call.phone;
      if (stamp === undefined) return { text: 'phone_manage carries no consented phone stamp' };
      if (consented.get(stamp.deviceId) !== stamp.phoneId) {
        void refresh().then(() => opts.onStale?.());
        const deadline = Date.now() + 3_000;
        while (Date.now() < deadline && consented.get(stamp.deviceId) !== stamp.phoneId)
          await sleep(50);
        if (consented.get(stamp.deviceId) !== stamp.phoneId)
          return { text: 'phone_manage carries no consented phone stamp' };
      }
      const driver =
        driverFor(stamp.deviceId) ?? new AndroidPhone({ serial: stamp.deviceId, adb, yadb });
      if (parsed.data.action === 'pair') {
        const result = await driver.pair({
          ...(parsed.data.code !== undefined ? { code: parsed.data.code } : {}),
          ...(parsed.data.endpoint !== undefined ? { endpoint: parsed.data.endpoint } : {}),
        });
        drivers.delete(stamp.deviceId);
        if (!driver.dropped) {
          const displaced = drivers.get(result.deviceId);
          if (displaced !== undefined && displaced !== driver)
            void displaced.killAll().catch(() => {});
          drivers.set(result.deviceId, driver);
        }
        return { text: JSON.stringify(phoneManageResultSchema.parse(result)) };
      }
      const result = await driver.forget();
      drivers.delete(stamp.deviceId);
      void driver.killAll();
      return { text: JSON.stringify(phoneManageResultSchema.parse(result)) };
    },
    async killAll() {
      if (timer !== null) clearInterval(timer);
      for (const driver of drivers.values()) await driver.killAll();
      drivers.clear();
    },
  };
}
