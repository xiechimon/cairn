import { randomBytes } from 'node:crypto';
import { chmodSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type ComputerCall,
  type ComputerFrame,
  PHONE_LOCKED,
  PHONE_SECURE_SCREEN,
} from '@cairn/shared';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import {
  createComputerDispatcher,
  NO_COMPUTER_PROVIDER_MESSAGE,
  NO_PHONE_STAMP_MESSAGE,
} from '../src/computer/dispatch.js';
import { encodePng } from '../src/computer/host-screen-png.js';
import { AndroidPhone, elementCenter, parseUiAutomator } from '../src/computer/phone-android.js';
import {
  type AdbResult,
  type AdbRun,
  dumpsysLocked,
  mergePhoneReports,
  parseAdbDevices,
  parseMdnsServices,
  probeAndroidPhones,
} from '../src/computer/phone-probe.js';
import { createPhones } from '../src/computer/phones.js';
import { MachineClient } from '../src/machine-client.js';

vi.setConfig({ testTimeout: 15_000 });
const FAST = { flushMs: 20, heartbeatMs: 5_000, retryBaseMs: 5, retryMaxMs: 20, cairnOrigins: [] };

const tempDirs: string[] = [];
function tempDir(prefix: string): string {
  const dir = makeTestTempDir(prefix);
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) releaseTestTempDir(dir);
});

const DEVICES = `List of devices attached
39041FDJG00ABC\tdevice\tusb:12345 product:akita model:Pixel_8a device:akita
192.168.1.20:42155\tunauthorized
emulator-5554\toffline
`;
const MDNS = `List of discovered mdns services
adb-Pixel_8a-39041FDJG00ABC\t_adb-tls-connect._tcp.\t192.168.1.20:42155
adb-Other-xy\t_adb-tls-connect._tcp.\t192.168.1.30:40001
`;

const XML = `<?xml version="1.0"?>
<hierarchy><node text="" class="android.widget.FrameLayout" bounds="[0,0][1080,2400]" clickable="false" focusable="false" scrollable="false" long-clickable="false" content-desc="">
<node text="设置" class="android.widget.TextView" bounds="[100,400][540,540]" clickable="true" focusable="false" scrollable="false" long-clickable="false" content-desc=""/>
<node text="" class="android.widget.EditText" bounds="[50,600][1030,720]" clickable="false" focusable="true" scrollable="false" long-clickable="false" content-desc="输入框"/>
<node text="" class="android.view.View" bounds="[0,0][0,0]" clickable="true" focusable="false" scrollable="false" long-clickable="false" content-desc=""/>
</node></hierarchy>`;

function png(width = 300, height = 300): Buffer {
  const pixels = randomBytes(width * height * 4);
  return encodePng(width, height, 6, pixels);
}

function fakeAdb(
  routes: Array<{
    match: (args: readonly string[]) => boolean;
    out: AdbResult | ((args: readonly string[]) => AdbResult);
  }>,
) {
  const calls: string[][] = [];
  const run: AdbRun = async (args) => {
    calls.push([...args]);
    for (const route of routes) {
      if (route.match(args)) {
        return typeof route.out === 'function' ? route.out(args) : route.out;
      }
    }
    return { code: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
  };
  return { run, calls };
}

function ok(text: string): AdbResult {
  return { code: 0, stdout: Buffer.from(text), stderr: Buffer.alloc(0) };
}
function fail(text: string): AdbResult {
  return { code: 1, stdout: Buffer.alloc(0), stderr: Buffer.from(text) };
}

describe('phone probe', () => {
  test('parses adb devices -l with model names and states', () => {
    const entries = parseAdbDevices(DEVICES);
    expect(entries).toEqual([
      { serial: '39041FDJG00ABC', state: 'device', model: 'Pixel 8a', usb: '12345' },
      { serial: '192.168.1.20:42155', state: 'unauthorized', model: null, usb: null },
      { serial: 'emulator-5554', state: 'offline', model: null, usb: null },
    ]);
  });

  test('parses adb mdns services into name, service type and ip:port', () => {
    expect(parseMdnsServices(MDNS)).toEqual([
      {
        name: 'adb-Pixel_8a-39041FDJG00ABC',
        serviceType: '_adb-tls-connect._tcp.',
        address: '192.168.1.20:42155',
      },
      {
        name: 'adb-Other-xy',
        serviceType: '_adb-tls-connect._tcp.',
        address: '192.168.1.30:40001',
      },
    ]);
  });

  test('merges attached devices with unseen mdns services; an attached ip is not duplicated', () => {
    const devices = parseAdbDevices(DEVICES);
    const reports = mergePhoneReports(devices, parseMdnsServices(MDNS), new Map());
    const byId = new Map(reports.map((report) => [report.deviceId, report]));
    expect(byId.get('39041FDJG00ABC')?.link).toBe('ready');
    expect(byId.get('192.168.1.20:42155')?.link).toBe('unauthorized');
    expect(byId.get('emulator-5554')?.link).toBe('offline');
    const mdnsOnly = byId.get('192.168.1.30:40001');
    expect(mdnsOnly?.link).toBe('seen');
    expect(mdnsOnly?.name).toBe('Other xy');
    expect(reports.filter((r) => r.deviceId.startsWith('192.168.1.20'))).toHaveLength(1);
  });

  test('reports locked when dumpsys shows the keyguard up', async () => {
    const { run } = fakeAdb([
      {
        match: (a) => a.join(' ') === 'devices -l',
        out: ok('List of devices attached\nSERIAL1\tdevice\tusb:1\n'),
      },
      { match: (a) => a.join(' ') === 'mdns services', out: ok('') },
      {
        match: (a) => a.join(' ') === '-s SERIAL1 shell settings get secure android_id',
        out: ok('1111222233334444'),
      },
      {
        match: (a) => a.slice(-2).join(' ') === 'dumpsys window',
        out: ok('mDreamingLockscreen=true'),
      },
    ]);
    const probe = await probeAndroidPhones(run);
    expect(probe.reports).toEqual([
      {
        deviceId: 'android:1111222233334444',
        platform: 'android',
        name: 'android:1111222233334444',
        link: 'locked',
      },
    ]);
    expect(dumpsysLocked('mShowingLockscreen=true')).toBe(true);
    expect(dumpsysLocked('mDreamingLockscreen=false\nmShowingLockscreen=false')).toBe(false);
  });

  test('the same android id over Wi-Fi and USB is one report and prefers USB transport', async () => {
    const { run } = fakeAdb([
      {
        match: (a) => a.join(' ') === 'devices -l',
        out: ok(
          'List of devices attached\n192.168.1.52:45391\tdevice\nUSB1\tdevice\tusb:1 product:akita model:Pixel_8a device:akita\n',
        ),
      },
      {
        match: (a) => a.join(' ') === 'mdns services',
        out: ok('adb-e33fb32c\t_adb-tls-connect._tcp\t192.168.1.52:45391\n'),
      },
      {
        match: (a) => a.join(' ') === '-s 192.168.1.52:45391 shell settings get secure android_id',
        out: ok('abcdef1234567890'),
      },
      {
        match: (a) => a.join(' ') === '-s USB1 shell settings get secure android_id',
        out: ok('abcdef1234567890'),
      },
      { match: (a) => a.includes('dumpsys'), out: ok('mShowingLockscreen=false') },
    ]);
    const probe = await probeAndroidPhones(run);
    expect(probe.reports).toEqual([
      {
        deviceId: 'android:abcdef1234567890',
        platform: 'android',
        name: 'Pixel 8a',
        link: 'ready',
      },
    ]);
    expect(probe.serialByDeviceId.get('android:abcdef1234567890')).toBe('USB1');
  });

  test('an mDNS-named wireless adb serial without exact corroboration is not treated as USB', async () => {
    const serviceSerial = 'adb-e33fb32c._adb-tls-connect._tcp';
    const { run } = fakeAdb([
      {
        match: (a) => a.join(' ') === 'devices -l',
        out: ok(`List of devices attached\n${serviceSerial}\tdevice\n`),
      },
      { match: (a) => a.join(' ') === 'mdns services', out: ok('') },
      { match: () => true, out: ok('') },
    ]);
    const probe = await probeAndroidPhones(run);
    expect(probe.reports).toEqual([]);
    expect(probe.serialByDeviceId.size).toBe(0);
  });

  test('an mDNS-named wireless adb serial with exact mDNS corroboration is reported ready without duplicating seen', async () => {
    const serviceSerial = 'adb-e33fb32c._adb-tls-connect._tcp';
    const { run } = fakeAdb([
      {
        match: (a) => a.join(' ') === 'devices -l',
        out: ok(`List of devices attached\n${serviceSerial}\tdevice\tmodel:Pixel_8a\n`),
      },
      {
        match: (a) => a.join(' ') === 'mdns services',
        out: ok('adb-e33fb32c\t_adb-tls-connect._tcp\t192.168.1.52:45391\n'),
      },
      {
        match: (a) => a.join(' ') === `-s ${serviceSerial} shell settings get secure android_id`,
        out: ok('abcdef1234567890'),
      },
      { match: (a) => a.includes('dumpsys'), out: ok('mShowingLockscreen=false') },
    ]);
    const probe = await probeAndroidPhones(run);
    expect(probe.reports).toEqual([
      {
        deviceId: 'android:abcdef1234567890',
        platform: 'android',
        name: 'Pixel 8a',
        link: 'ready',
      },
    ]);
    expect(probe.serialByDeviceId.get('android:abcdef1234567890')).toBe(serviceSerial);
  });

  test('a wireless adb serial without exact mDNS corroboration is not reported or mapped', async () => {
    const { run } = fakeAdb([
      {
        match: (a) => a.join(' ') === 'devices -l',
        out: ok('List of devices attached\n192.168.1.52:45391\tdevice\n'),
      },
      { match: (a) => a.join(' ') === 'mdns services', out: ok('') },
      { match: () => true, out: ok('') },
    ]);
    const probe = await probeAndroidPhones(run);
    expect(probe.reports).toEqual([]);
    expect(probe.serialByDeviceId.size).toBe(0);
  });

  test('reports connected phones by stable android id and keeps transport serials internal', async () => {
    const { run } = fakeAdb([
      {
        match: (a) => a.join(' ') === 'devices -l',
        out: ok('List of devices attached\n192.168.1.52:45391\tdevice\n'),
      },
      {
        match: (a) => a.join(' ') === 'mdns services',
        out: ok('adb-e33fb32c\t_adb-tls-connect._tcp\t192.168.1.52:45391\n'),
      },
      {
        match: (a) => a.join(' ') === '-s 192.168.1.52:45391 shell settings get secure android_id',
        out: ok('ABCDEF1234567890\n'),
      },
      {
        match: (a) => a.slice(-2).join(' ') === 'dumpsys window',
        out: ok('mDreamingLockscreen=false\nmShowingLockscreen=false'),
      },
    ]);
    const probe = await probeAndroidPhones(run);
    expect(probe.reports).toEqual([
      {
        deviceId: 'android:abcdef1234567890',
        platform: 'android',
        name: 'android:abcdef1234567890',
        link: 'ready',
      },
    ]);
    expect(probe.serialByDeviceId.get('android:abcdef1234567890')).toBe('192.168.1.52:45391');
  });
});

describe('ui element parsing', () => {
  test('numbers interactive and labelled elements with bounds centers', () => {
    const elements = parseUiAutomator(XML);
    expect(elements).toHaveLength(2);
    expect(elements[0]).toMatchObject({ text: '设置' });
    expect(elementCenter(elements[0]!)).toEqual({ x: 320, y: 470 });
    expect(elementCenter(elements[1]!)).toEqual({ x: 540, y: 660 });
  });
});

function screenCall(params: Record<string, unknown>) {
  return { params, deadlineAt: Date.now() + 60_000, signal: new AbortController().signal };
}

describe('phone observe/act on fake adb', () => {
  test('observe maps the tree to numbered rows and returns a screenshot', async () => {
    const fake = fakeAdb([
      { match: (a) => a.includes('uiautomator'), out: ok('') },
      { match: (a) => a.slice(-2).join(' ') === 'cat /data/local/tmp/cairn-ui.xml', out: ok(XML) },
      {
        match: (a) => a.includes('screencap'),
        out: () => ({ code: 0, stdout: png(), stderr: Buffer.alloc(0) }),
      },
      { match: () => true, out: ok('') },
    ]);
    const driver = new AndroidPhone({
      serial: 'S',
      adb: fake.run,
      tmpDir: tempDir('phone-observe-'),
    });
    const out = await driver.observe(screenCall({}));
    expect(out.kind).toBe('done');
    if (out.kind !== 'done') return;
    expect(out.text).toContain('[1] TextView "设置"');
    expect(out.text).toContain('[2] EditText');
    expect(out.images).toHaveLength(1);
    expect(out.images[0]?.mimeType).toBe('image/png');
  });

  test('observe on a locked phone returns the marker without the tree or image', async () => {
    const fake = fakeAdb([
      {
        match: (a) => a.slice(-2).join(' ') === 'dumpsys window',
        out: ok('mDreamingLockscreen=true'),
      },
      { match: () => true, out: ok('') },
    ]);
    const driver = new AndroidPhone({ serial: 'S', adb: fake.run });
    const out = await driver.observe(screenCall({}));
    expect(out.kind).toBe('done');
    if (out.kind !== 'done') return;
    expect(out.text).toBe(PHONE_LOCKED);
    expect(out.images).toHaveLength(0);
    expect(fake.calls.some((a) => a.includes('uiautomator'))).toBe(false);
  });

  test('observe fails closed to locked when dumpsys errors', async () => {
    const fake = fakeAdb([
      {
        match: (a) => a.slice(-2).join(' ') === 'dumpsys window',
        out: fail('dumpsys: permission denied'),
      },
      { match: () => true, out: ok('') },
    ]);
    const driver = new AndroidPhone({ serial: 'S', adb: fake.run });
    const out = await driver.observe(screenCall({}));
    expect(out.kind).toBe('done');
    if (out.kind !== 'done') return;
    expect(out.text).toBe(PHONE_LOCKED);
    expect(out.images).toHaveLength(0);
    expect(fake.calls.some((a) => a.includes('uiautomator'))).toBe(false);
  });

  test('observe {apps:true} on a locked phone does not leak the app list', async () => {
    const fake = fakeAdb([
      {
        match: (a) => a.slice(-2).join(' ') === 'dumpsys window',
        out: ok('mDreamingLockscreen=true'),
      },
      {
        match: (a) => a.includes('query-activities'),
        out: ok('com.dating.app/com.dating.app.Main\ncom.bank.app/com.bank.app.Main'),
      },
      { match: () => true, out: ok('') },
    ]);
    const driver = new AndroidPhone({ serial: 'S', adb: fake.run });
    const out = await driver.observe(screenCall({ apps: true }));
    expect(out.kind).toBe('done');
    if (out.kind !== 'done') return;
    expect(out.text).toBe(PHONE_LOCKED);
    expect(out.text).not.toContain('com.dating.app');
  });

  test('a batch that navigates into the Cairn app stops before the next input', async () => {
    let dumpsysCalls = 0;
    const fake = fakeAdb([
      {
        match: (a) => a.slice(-2).join(' ') === 'dumpsys window',
        out: () => {
          dumpsysCalls += 1;
          return ok(
            dumpsysCalls === 1
              ? 'mCurrentFocus=Window{0 u0 com.launcher/.Main}'
              : 'mCurrentFocus=Window{9c1 u0 com.cairn.app/com.cairn.MainActivity}',
          );
        },
      },
      {
        match: (a) => a.includes('uiautomator'),
        out: ok('UI hierchary dumped to: /data/local/tmp/cairn-ui.xml'),
      },
      {
        match: (a) => a.slice(-2).join(' ') === 'cat /data/local/tmp/cairn-ui.xml',
        out: ok(XML),
      },
      {
        match: (a) => a.includes('screencap'),
        out: () => ({ code: 0, stdout: png(), stderr: Buffer.alloc(0) }),
      },
      { match: () => true, out: ok('') },
    ]);
    const driver = new AndroidPhone({ serial: 'S', adb: fake.run });
    const out = await driver.act(
      screenCall({
        actions: [
          { kind: 'key', key: 'home' },
          { kind: 'tap', x: 1, y: 2 },
        ],
      }),
    );
    expect(out.kind).toBe('done');
    if (out.kind !== 'done') return;
    expect(out.text).toContain('Cairn');
    expect(out.text).toContain('pressed home');
    const taps = fake.calls.filter((a) => a.includes('tap'));
    expect(taps).toHaveLength(0);
  });

  test('a withdrawn driver refuses queued calls without adb traffic', async () => {
    const fake = fakeAdb([{ match: () => true, out: ok('') }]);
    const driver = new AndroidPhone({ serial: 'S', adb: fake.run });
    await driver.killAll();
    const out = await driver.observe(screenCall({}));
    expect(out.kind).toBe('done');
    if (out.kind !== 'done') return;
    expect(out.text).toContain('removed');
    expect(fake.calls).toHaveLength(0);
    const acted = await driver.act(screenCall({ actions: [{ kind: 'key', key: 'home' }] }));
    expect(acted.kind).toBe('done');
    expect(fake.calls).toHaveLength(0);
  });

  test('consent withdrawal mid-batch stops before the next action', async () => {
    let driver!: AndroidPhone;
    let screencaps = 0;
    const fake = fakeAdb([
      {
        match: (a) => a.slice(-2).join(' ') === 'dumpsys window',
        out: ok('mCurrentFocus=Window{0 u0 com.launcher/.Main}'),
      },
      {
        match: (a) => a.includes('screencap'),
        out: () => {
          if (screencaps++ === 1) void driver.killAll();
          return { code: 0, stdout: png(), stderr: Buffer.alloc(0) };
        },
      },
      { match: () => true, out: ok('') },
    ]);
    driver = new AndroidPhone({ serial: 'S', adb: fake.run });
    const out = await driver.act(
      screenCall({
        actions: [
          { kind: 'tap', x: 1, y: 2 },
          { kind: 'tap', x: 3, y: 4 },
          { kind: 'tap', x: 5, y: 6 },
        ],
      }),
    );
    expect(out.kind).toBe('done');
    if (out.kind !== 'done') return;
    expect(out.text).toContain('removed');
    const taps = fake.calls.filter((a) => a.includes('tap'));
    expect(taps).toHaveLength(1);
  });

  test('a false server consent answer mid-batch stops before the next adb command', async () => {
    let consented = true;
    let consentChecks = 0;
    const fake = fakeAdb([
      {
        match: (a) => a.includes('tap') && a.includes('1'),
        out: () => {
          consented = false;
          return ok('');
        },
      },
      {
        match: (a) => a.includes('screencap'),
        out: () => ({ code: 0, stdout: png(), stderr: Buffer.alloc(0) }),
      },
      { match: () => true, out: ok('') },
    ]);
    const driver = new AndroidPhone({
      serial: 'S',
      adb: fake.run,
      consent: async () => {
        consentChecks += 1;
        return consented;
      },
    });
    const out = await driver.act(
      screenCall({
        actions: [
          { kind: 'tap', x: 1, y: 2 },
          { kind: 'tap', x: 3, y: 4 },
        ],
      }),
    );
    expect(out.kind).toBe('done');
    if (out.kind !== 'done') return;
    expect(out.text).toContain('tapped (1, 2)');
    expect(out.text).toContain('removed');
    expect(fake.calls.filter((a) => a.includes('tap'))).toHaveLength(1);
    expect(consentChecks).toBeGreaterThan(1);
  });

  test('each consent check carries the screen call id', async () => {
    const checked: Array<string | undefined> = [];
    const fake = fakeAdb([
      { match: (a) => a.includes('uiautomator'), out: ok('') },
      { match: (a) => a.slice(-2).join(' ') === 'cat /data/local/tmp/cairn-ui.xml', out: ok(XML) },
      {
        match: (a) => a.includes('screencap'),
        out: () => ({ code: 0, stdout: png(), stderr: Buffer.alloc(0) }),
      },
      { match: () => true, out: ok('') },
    ]);
    const driver = new AndroidPhone({
      serial: 'S',
      adb: fake.run,
      consent: async (callId) => {
        checked.push(callId);
        return true;
      },
    });
    await driver.observe({ ...screenCall({}), callId: 'cc-phone-observe' });
    expect(checked.length).toBeGreaterThan(0);
    expect(new Set(checked)).toEqual(new Set(['cc-phone-observe']));
  });

  test('a secure screen appearing mid-batch stops before the next input', async () => {
    const tiny = encodePng(2, 2, 6, Buffer.alloc(16));
    let screencaps = 0;
    const fake = fakeAdb([
      { match: (a) => a.slice(-2).join(' ') === 'dumpsys window', out: ok('') },
      {
        match: (a) => a.includes('screencap'),
        out: () => ({
          code: 0,
          stdout: screencaps++ === 0 ? png() : tiny,
          stderr: Buffer.alloc(0),
        }),
      },
      { match: () => true, out: ok('') },
    ]);
    const driver = new AndroidPhone({ serial: 'S', adb: fake.run });
    const out = await driver.act(
      screenCall({
        actions: [
          { kind: 'launch', id: 'com.android.settings' },
          { kind: 'tap', x: 1, y: 2 },
        ],
      }),
    );
    expect(out.kind).toBe('done');
    if (out.kind !== 'done') return;
    expect(out.text).toContain('[secure screen]');
    expect(fake.calls.filter((a) => a.includes('tap'))).toHaveLength(0);
  });

  test('a secure (blank) screen returns the marker and no image', async () => {
    const tiny = encodePng(2, 2, 6, Buffer.alloc(16));
    const fake = fakeAdb([
      { match: (a) => a.includes('uiautomator'), out: ok('') },
      { match: (a) => a.slice(-2).join(' ') === 'cat /data/local/tmp/cairn-ui.xml', out: ok(XML) },
      {
        match: (a) => a.includes('screencap'),
        out: { code: 0, stdout: tiny, stderr: Buffer.alloc(0) },
      },
      { match: () => true, out: ok('') },
    ]);
    const driver = new AndroidPhone({ serial: 'S', adb: fake.run });
    const out = await driver.observe(screenCall({}));
    expect(out.kind).toBe('done');
    if (out.kind !== 'done') return;
    expect(out.text).toBe('[secure screen]');
    expect(out.images).toHaveLength(0);
  });

  test('tap by element resolves the bounds center into input tap argv', async () => {
    const fake = fakeAdb([
      { match: (a) => a.includes('uiautomator'), out: ok('') },
      { match: (a) => a.slice(-2).join(' ') === 'cat /data/local/tmp/cairn-ui.xml', out: ok(XML) },
      {
        match: (a) => a.includes('screencap'),
        out: () => ({ code: 0, stdout: png(), stderr: Buffer.alloc(0) }),
      },
      { match: () => true, out: ok('') },
    ]);
    const driver = new AndroidPhone({ serial: 'S', adb: fake.run });
    await driver.observe(screenCall({}));
    const out = await driver.act(screenCall({ actions: [{ kind: 'tap', element: 1 }] }));
    expect(out.kind).toBe('done');
    const taps = fake.calls.filter((args) => args.slice(-4).join(' ') === 'shell input tap');
    const tap = fake.calls.find(
      (args) => args.slice(0, 4).join(' ') === '-s S shell input' && args.includes('tap'),
    );
    expect(tap).toBeDefined();
    const idx = tap!.indexOf('tap');
    expect(tap!.slice(idx + 1)).toEqual(['320', '470']);
    void taps;
  });

  test('tap by coordinates passes fixed x y argv', async () => {
    const fake = fakeAdb([
      { match: (a) => a.includes('uiautomator'), out: ok('') },
      { match: (a) => a.slice(-2).join(' ') === 'cat /data/local/tmp/cairn-ui.xml', out: ok(XML) },
      {
        match: (a) => a.includes('screencap'),
        out: () => ({ code: 0, stdout: png(), stderr: Buffer.alloc(0) }),
      },
      { match: () => true, out: ok('') },
    ]);
    const driver = new AndroidPhone({ serial: 'S', adb: fake.run });
    const out = await driver.act(screenCall({ actions: [{ kind: 'tap', x: 10, y: 20 }] }));
    expect(out.kind).toBe('done');
    const tap = fake.calls.find((args) => args.includes('tap'));
    expect(tap!.slice(-2)).toEqual(['10', '20']);
  });

  test('an element not in the latest observation is refused without running anything', async () => {
    const fake = fakeAdb([
      { match: (a) => a.includes('uiautomator'), out: ok('') },
      { match: (a) => a.slice(-2).join(' ') === 'cat /data/local/tmp/cairn-ui.xml', out: ok(XML) },
      {
        match: (a) => a.includes('screencap'),
        out: () => ({ code: 0, stdout: png(), stderr: Buffer.alloc(0) }),
      },
      { match: () => true, out: ok('') },
    ]);
    const driver = new AndroidPhone({ serial: 'S', adb: fake.run });
    await driver.observe(screenCall({}));
    const out = await driver.act(screenCall({ actions: [{ kind: 'tap', element: 9 }] }));
    expect(out.kind).toBe('error');
    if (out.kind !== 'error') return;
    expect(out.delivery).toBe('not_delivered');
    expect(out.message).toContain('element 9');
    expect(fake.calls.filter((args) => args.includes('tap'))).toHaveLength(0);
  });

  test('swipe, key and launch pass fixed argv; text over the helper never reaches argv', async () => {
    const pushed: string[] = [];
    const fake = fakeAdb([
      { match: (a) => a.includes('uiautomator'), out: ok('') },
      { match: (a) => a.slice(-2).join(' ') === 'cat /data/local/tmp/cairn-ui.xml', out: ok(XML) },
      {
        match: (a) => a.includes('screencap'),
        out: () => ({ code: 0, stdout: png(), stderr: Buffer.alloc(0) }),
      },
      {
        match: (a) => a.includes('push'),
        out: (a) => {
          pushed.push(a[a.length - 1]!);
          return ok('pushed');
        },
      },
      { match: () => true, out: ok('') },
    ]);
    const driver = new AndroidPhone({
      serial: 'S',
      adb: fake.run,
      yadb: () => Promise.resolve('/tmp/yadb'),
    });
    const out = await driver.act(
      screenCall({
        actions: [
          { kind: 'drag', x: 1, y: 2, to_x: 3, to_y: 4 },
          { kind: 'key', key: 'back' },
          { kind: 'launch', id: 'com.android.settings' },
          { kind: 'type', text: '你好，世界' },
        ],
      }),
    );
    expect(out.kind === 'error' ? out.message : 'done').toBe('done');
    const swipe = fake.calls.find((args) => args.includes('swipe'));
    expect(swipe!.slice(-5)).toEqual(['1', '2', '3', '4', '500']);
    const key = fake.calls.find((args) => args.includes('keyevent'));
    expect(key!.slice(-1)).toEqual(['KEYCODE_BACK']);
    const monkey = fake.calls.find((args) => args.includes('monkey'));
    expect(monkey!.slice(-4)).toEqual([
      'com.android.settings',
      '-c',
      'android.intent.category.LAUNCHER',
      '1',
    ]);
    const yadb = fake.calls.find((args) => args.some((a) => a.includes('yadb.Main')));
    expect(yadb).toBeDefined();
    expect(yadb!.join(' ')).toContain('-keyboard');
    expect(yadb!.join(' ')).not.toContain('你好');
    expect(pushed).toContain('/data/local/tmp/yadb');
    expect(pushed).toContain('/data/local/tmp/cairn-yadb-text');
  });

  test('ascii text goes through input text as one argv element', async () => {
    const fake = fakeAdb([
      { match: (a) => a.includes('uiautomator'), out: ok('') },
      { match: (a) => a.slice(-2).join(' ') === 'cat /data/local/tmp/cairn-ui.xml', out: ok(XML) },
      {
        match: (a) => a.includes('screencap'),
        out: () => ({ code: 0, stdout: png(), stderr: Buffer.alloc(0) }),
      },
      { match: () => true, out: ok('') },
    ]);
    const driver = new AndroidPhone({ serial: 'S', adb: fake.run });
    await driver.act(screenCall({ actions: [{ kind: 'type', text: 'hello123' }] }));
    const input = fake.calls.find(
      (args) => args.slice(0, 4).join(' ') === '-s S shell input' && args.includes('text'),
    );
    expect(input!.slice(-1)).toEqual(['hello123']);
  });

  test('act refuses on a locked phone without injecting input', async () => {
    const fake = fakeAdb([
      {
        match: (a) => a.slice(-2).join(' ') === 'dumpsys window',
        out: ok('mDreamingLockscreen=true'),
      },
      { match: () => true, out: ok('') },
    ]);
    const driver = new AndroidPhone({ serial: 'S', adb: fake.run });
    const out = await driver.act(screenCall({ actions: [{ kind: 'tap', x: 1, y: 2 }] }));
    expect(out.kind).toBe('done');
    if (out.kind !== 'done') return;
    expect(out.text).toBe(PHONE_LOCKED);
    expect(out.images).toHaveLength(0);
    expect(fake.calls.some((a) => a.includes('input'))).toBe(false);
    expect(fake.calls.some((a) => a.includes('uiautomator'))).toBe(false);
  });

  test('act refuses on a secure (blank) screen without injecting input', async () => {
    const tiny = encodePng(2, 2, 6, Buffer.alloc(16));
    const fake = fakeAdb([
      {
        match: (a) => a.includes('screencap'),
        out: { code: 0, stdout: tiny, stderr: Buffer.alloc(0) },
      },
      { match: () => true, out: ok('') },
    ]);
    const driver = new AndroidPhone({ serial: 'S', adb: fake.run });
    const out = await driver.act(screenCall({ actions: [{ kind: 'key', key: 'enter' }] }));
    expect(out.kind).toBe('done');
    if (out.kind !== 'done') return;
    expect(out.text).toBe(PHONE_SECURE_SCREEN);
    expect(out.images).toHaveLength(0);
    expect(fake.calls.some((a) => a.includes('input'))).toBe(false);
  });

  test('element numbers follow the filtered observation, not the raw tree', async () => {
    const fake = fakeAdb([
      { match: (a) => a.includes('uiautomator'), out: ok('') },
      { match: (a) => a.slice(-2).join(' ') === 'cat /data/local/tmp/cairn-ui.xml', out: ok(XML) },
      {
        match: (a) => a.includes('screencap'),
        out: () => ({ code: 0, stdout: png(), stderr: Buffer.alloc(0) }),
      },
      { match: () => true, out: ok('') },
    ]);
    const driver = new AndroidPhone({ serial: 'S', adb: fake.run });
    await driver.observe(screenCall({ query: '输入框' }));
    const out = await driver.act(screenCall({ actions: [{ kind: 'tap', element: 1 }] }));
    expect(out.kind).toBe('done');
    const tap = fake.calls.find((args) => args.includes('tap'));
    const idx = tap!.indexOf('tap');
    expect(tap!.slice(idx + 1)).toEqual(['540', '660']);
  });

  test('a transport serial change invalidates cached element numbers before acting', async () => {
    const fake = fakeAdb([
      { match: (a) => a.includes('uiautomator'), out: ok('') },
      { match: (a) => a.slice(-2).join(' ') === 'cat /data/local/tmp/cairn-ui.xml', out: ok(XML) },
      {
        match: (a) => a.includes('screencap'),
        out: () => ({ code: 0, stdout: png(), stderr: Buffer.alloc(0) }),
      },
      { match: () => true, out: ok('') },
    ]);
    const driver = new AndroidPhone({ serial: 'S', adb: fake.run });
    await driver.observe(screenCall({}));
    driver.updateSerial('192.168.1.52:45391');
    const out = await driver.act(screenCall({ actions: [{ kind: 'tap', element: 1 }] }));
    expect(out.kind).toBe('error');
    if (out.kind !== 'error') return;
    expect(out.message).toContain('phone_observe');
    expect(fake.calls.some((a) => a.includes('tap'))).toBe(false);
  });

  test('a secure observation clears the element list so stale numbers are refused', async () => {
    const tiny = encodePng(2, 2, 6, Buffer.alloc(16));
    let secure = false;
    const fake = fakeAdb([
      { match: (a) => a.includes('uiautomator'), out: ok('') },
      {
        match: (a) => a.slice(-2).join(' ') === 'cat /data/local/tmp/cairn-ui.xml',
        out: ok(XML),
      },
      {
        match: (a) => a.includes('screencap'),
        out: () => ({
          code: 0,
          stdout: secure ? tiny : png(),
          stderr: Buffer.alloc(0),
        }),
      },
      { match: () => true, out: ok('') },
    ]);
    const driver = new AndroidPhone({ serial: 'S', adb: fake.run });
    await driver.observe(screenCall({}));
    secure = true;
    await driver.observe(screenCall({}));
    secure = false;
    const out = await driver.act(screenCall({ actions: [{ kind: 'tap', element: 1 }] }));
    expect(out.kind).toBe('error');
    if (out.kind !== 'error') return;
    expect(out.delivery).toBe('not_delivered');
    expect(out.message).toContain('element 1');
    expect(fake.calls.some((a) => a.includes('input'))).toBe(false);
  });

  test('act refuses while the Cairn app is in the foreground', async () => {
    const fake = fakeAdb([
      {
        match: (a) => a.slice(-2).join(' ') === 'dumpsys window',
        out: ok('mCurrentFocus=Window{9c1 u0 com.cairn.app/com.cairn.MainActivity}'),
      },
      { match: () => true, out: ok('') },
    ]);
    const driver = new AndroidPhone({ serial: 'S', adb: fake.run });
    const out = await driver.act(screenCall({ actions: [{ kind: 'tap', x: 1, y: 2 }] }));
    expect(out.kind).toBe('done');
    if (out.kind !== 'done') return;
    expect(out.text).toContain('Cairn');
    expect(fake.calls.some((a) => a.includes('input'))).toBe(false);
  });

  test('screen calls on one driver are serialized', async () => {
    let inflight = 0;
    let maxInflight = 0;
    const inner = fakeAdb([
      { match: (a) => a.includes('uiautomator'), out: ok('') },
      { match: (a) => a.slice(-2).join(' ') === 'cat /data/local/tmp/cairn-ui.xml', out: ok(XML) },
      {
        match: (a) => a.includes('screencap'),
        out: () => ({ code: 0, stdout: png(), stderr: Buffer.alloc(0) }),
      },
      { match: () => true, out: ok('') },
    ]);
    const run: AdbRun = async (args, opts) => {
      if (args.includes('dumpsys')) {
        inflight += 1;
        maxInflight = Math.max(maxInflight, inflight);
        await new Promise((resolve) => setTimeout(resolve, 10));
        inflight -= 1;
      }
      return inner.run(args, opts);
    };
    const driver = new AndroidPhone({ serial: 'S', adb: run });
    await Promise.all([
      driver.observe(screenCall({})),
      driver.act(screenCall({ actions: [{ kind: 'key', key: 'home' }] })),
      driver.observe(screenCall({})),
    ]);
    expect(maxInflight).toBe(1);
  });

  test('launching the Cairn app itself is refused', async () => {
    const fake = fakeAdb([
      { match: (a) => a.includes('uiautomator'), out: ok('') },
      { match: (a) => a.slice(-2).join(' ') === 'cat /data/local/tmp/cairn-ui.xml', out: ok(XML) },
      {
        match: (a) => a.includes('screencap'),
        out: () => ({ code: 0, stdout: png(), stderr: Buffer.alloc(0) }),
      },
      { match: () => true, out: ok('') },
    ]);
    const driver = new AndroidPhone({ serial: 'S', adb: fake.run });
    const out = await driver.act(
      screenCall({ actions: [{ kind: 'launch', id: 'com.cairn.app' }] }),
    );
    expect(out.kind).toBe('error');
    if (out.kind !== 'error') return;
    expect(out.delivery).toBe('not_delivered');
  });

  test('a launch id that is not a package name never reaches adb', async () => {
    const fake = fakeAdb([
      { match: (a) => a.includes('uiautomator'), out: ok('') },
      { match: (a) => a.slice(-2).join(' ') === 'cat /data/local/tmp/cairn-ui.xml', out: ok(XML) },
      {
        match: (a) => a.includes('screencap'),
        out: () => ({ code: 0, stdout: png(), stderr: Buffer.alloc(0) }),
      },
      { match: () => true, out: ok('') },
    ]);
    const driver = new AndroidPhone({ serial: 'S', adb: fake.run });
    for (const id of [
      'x; id',
      'com.a && reboot',
      'com.a$(reboot)',
      'com.a`id`',
      'com.a\nreboot',
      '-p com.a',
      'a',
      'nodots',
    ]) {
      const out = await driver.act(screenCall({ actions: [{ kind: 'launch', id }] }));
      expect(out.kind).toBe('error');
      if (out.kind === 'error') expect(out.delivery).toBe('not_delivered');
    }
    expect(fake.calls.filter((a) => a.includes('monkey'))).toHaveLength(0);
  });
});

describe('phone pair and forget', () => {
  test('wireless pair runs pair then connect with exact argv', async () => {
    const fake = fakeAdb([
      { match: (a) => a[0] === 'pair', out: ok('Successfully paired') },
      { match: (a) => a.join(' ') === 'mdns services', out: ok(MDNS) },
      { match: (a) => a[0] === 'connect', out: ok('connected to 192.168.1.20:42155') },
      { match: (a) => a.includes('android_id'), out: ok('abcdef1234567890') },
      { match: (a) => a.includes('getprop'), out: ok('Pixel 8a') },
      { match: () => true, out: ok('') },
    ]);
    const driver = new AndroidPhone({ serial: 'S', adb: fake.run });
    const result = await driver.pair({ endpoint: '192.168.1.20:37001', code: '123456' });
    expect(result).toEqual({
      outcome: 'paired',
      deviceId: 'android:abcdef1234567890',
      name: 'Pixel 8a',
    });
    expect(fake.calls[0]).toEqual(['pair', '192.168.1.20:37001', '123456']);
    expect(fake.calls[2]).toEqual(['connect', '192.168.1.20:42155']);
  });

  test('wireless re-pair is not blocked by a stale cached transport', async () => {
    const fake = fakeAdb([
      { match: (a) => a[0] === 'pair', out: ok('Successfully paired') },
      { match: (a) => a.join(' ') === 'mdns services', out: ok(MDNS) },
      { match: (a) => a[0] === 'connect', out: ok('connected to 192.168.1.20:42155') },
      { match: (a) => a.includes('android_id'), out: ok('abcdef1234567890') },
      { match: (a) => a.includes('getprop'), out: ok('Pixel 8a') },
      { match: () => true, out: ok('') },
    ]);
    const driver = new AndroidPhone({ serial: '192.168.1.20:30000', adb: fake.run });
    driver.markUnreachable();
    const result = await driver.pair({ endpoint: '192.168.1.20:37001', code: '123456' });
    expect(result.deviceId).toBe('android:abcdef1234567890');
    expect(fake.calls.filter((a) => a[0] === 'pair')).toHaveLength(1);
  });

  test('a wrong pairing code fails and keeps the row', async () => {
    const fake = fakeAdb([
      { match: (a) => a[0] === 'pair', out: fail('Failed: Unable to pair') },
      { match: () => true, out: ok('') },
    ]);
    const driver = new AndroidPhone({ serial: 'S', adb: fake.run });
    await expect(driver.pair({ endpoint: '192.168.1.20:37001', code: '000000' })).rejects.toThrow(
      'adb pair failed',
    );
    expect(fake.calls.filter((a) => a[0] === 'connect')).toHaveLength(0);
  });

  test('usb pair waits for the device and reads the model', async () => {
    const fake = fakeAdb([
      { match: (a) => a.join(' ') === '-s USB1 wait-for-device', out: ok('') },
      { match: (a) => a.join(' ') === '-s USB1 get-state', out: ok('device') },
      { match: (a) => a.includes('android_id'), out: ok('9999aaaabbbbcccc') },
      { match: (a) => a.includes('getprop'), out: ok('Pixel Fold') },
      { match: () => true, out: ok('') },
    ]);
    const driver = new AndroidPhone({ serial: 'USB1', adb: fake.run });
    const result = await driver.pair({});
    expect(result.deviceId).toBe('android:9999aaaabbbbcccc');
    expect(fake.calls[0]).toEqual(['-s', 'USB1', 'wait-for-device']);
  });

  test('forget disconnects a network serial', async () => {
    const fake = fakeAdb([{ match: () => true, out: ok('') }]);
    const driver = new AndroidPhone({ serial: '192.168.1.20:42155', adb: fake.run });
    await driver.forget();
    expect(fake.calls).toEqual([['disconnect', '192.168.1.20:42155']]);
  });
});

function call(overrides: Partial<ComputerCall> = {}): ComputerCall {
  return {
    callId: 'a'.repeat(64),
    stepId: 'step-1',
    tool: 'phone_observe',
    params: {},
    deadlineAt: Date.now() + 60_000,
    ...overrides,
  };
}

describe('dispatcher phone routing', () => {
  const apiOf = () => {
    const frames: ComputerFrame[] = [];
    return {
      frames,
      client: {
        async computerFrames(_callId: string, body: { frames: ComputerFrame[] }) {
          frames.push(...body.frames);
          return { ok: true as const, cancelled: false };
        },
      },
    };
  };
  const consentedPhones = async (run: AdbRun) => {
    const phones = createPhones({
      home: tempDir('phone-home-'),
      adbPath: '/bin/adb',
      run,
    });
    phones.setConsented([{ deviceId: 'S', phoneId: 'ph1' }]);
    await phones.refresh();
    return phones;
  };

  test('a call without a phone stamp is not delivered and spawns nothing', async () => {
    const api = apiOf();
    const fake = fakeAdb([]);
    const phones = await consentedPhones(fake.run);
    const baseline = fake.calls.length;
    await createComputerDispatcher({ client: api.client, phones, ...FAST }).dispatch(call());
    expect(fake.calls).toHaveLength(baseline);
    expect(api.frames.at(-1)).toMatchObject({
      kind: 'error',
      delivery: 'not_delivered',
      message: NO_PHONE_STAMP_MESSAGE,
    });
  });

  test('a stamp naming a different device or phone is not delivered', async () => {
    const api = apiOf();
    const fake = fakeAdb([]);
    const phones = await consentedPhones(fake.run);
    const baseline = fake.calls.length;
    const dispatcher = createComputerDispatcher({ client: api.client, phones, ...FAST });
    await dispatcher.dispatch(call({ phone: { phoneId: 'ph1', deviceId: 'OTHER' } }));
    await dispatcher.dispatch(
      call({ callId: 'b'.repeat(64), phone: { phoneId: 'ph2', deviceId: 'S' } }),
    );
    const driven = fake.calls
      .slice(baseline)
      .filter((a) => a.includes('shell') || a.includes('exec-out') || a.includes('push'));
    expect(driven).toEqual([]);
    expect(api.frames.filter((f) => f.kind === 'error')).toHaveLength(2);
  });

  test('a stamped observe reaches the driver and posts the image', async () => {
    const api = apiOf();
    const fake = fakeAdb([
      { match: (a) => a.includes('uiautomator'), out: ok('') },
      { match: (a) => a.slice(-2).join(' ') === 'cat /data/local/tmp/cairn-ui.xml', out: ok(XML) },
      {
        match: (a) => a.includes('screencap'),
        out: () => ({ code: 0, stdout: png(), stderr: Buffer.alloc(0) }),
      },
      { match: () => true, out: ok('') },
    ]);
    await createComputerDispatcher({
      client: api.client,
      phones: await consentedPhones(fake.run),
      ...FAST,
    }).dispatch(call({ phone: { phoneId: 'ph1', deviceId: 'S' } }));
    const last = api.frames.at(-1);
    expect(last?.kind).toBe('done');
    if (last?.kind !== 'done') return;
    expect(last.images).toHaveLength(1);
    expect(fake.calls.some((a) => a.includes('uiautomator'))).toBe(true);
  });

  test('a consented phone remains addressable when adb is prepared lazily after a runner restart', async () => {
    let preparations = 0;
    const phones = createPhones({
      home: tempDir('phone-home-'),
      adbPath: null,
      prepareAdb: async () => {
        preparations += 1;
        return '/managed/adb';
      },
    });
    phones.setConsented([{ deviceId: 'android:abcdef1234567890', phoneId: 'ph1' }]);
    const screen = phones.screen(
      call({ phone: { phoneId: 'ph1', deviceId: 'android:abcdef1234567890' } }),
    );
    expect(screen).not.toBeNull();
    await screen
      ?.observe({
        params: {},
        deadlineAt: Date.now() + 1_000,
        signal: new AbortController().signal,
      })
      .catch(() => undefined);
    expect(preparations).toBe(1);
    await phones.killAll();
  });

  test('a driver whose wireless transport loses mDNS corroboration cannot keep using the old serial', async () => {
    let devicesOut = 'List of devices attached\n192.168.1.52:45391\tdevice\n';
    let mdnsOut = 'adb-e33fb32c\t_adb-tls-connect._tcp\t192.168.1.52:45391\n';
    const fake = fakeAdb([
      { match: (a) => a.join(' ') === 'devices -l', out: () => ok(devicesOut) },
      { match: (a) => a.join(' ') === 'mdns services', out: () => ok(mdnsOut) },
      { match: (a) => a.includes('android_id'), out: ok('abcdef1234567890') },
      { match: () => true, out: ok('') },
    ]);
    const phones = createPhones({
      home: tempDir('phone-home-'),
      adbPath: '/bin/adb',
      run: fake.run,
    });
    phones.setConsented([{ deviceId: 'android:abcdef1234567890', phoneId: 'ph1' }]);
    await phones.refresh();
    const screen = phones.screen(
      call({ phone: { phoneId: 'ph1', deviceId: 'android:abcdef1234567890' } }),
    );
    expect(screen).not.toBeNull();
    devicesOut = 'List of devices attached\n';
    mdnsOut = '';
    await phones.refresh();
    const before = fake.calls.length;
    const out = await screen?.observe({
      params: {},
      deadlineAt: Date.now() + 1_000,
      signal: new AbortController().signal,
    });
    expect(out?.kind).toBe('done');
    expect(fake.calls.length).toBe(before);
    await phones.killAll();
  });

  test('phone_manage pair prepares adb inside the pairing action and passes cancellation through', async () => {
    const api = apiOf();
    const fake = fakeAdb([
      { match: (a) => a[0] === 'pair', out: ok('ok') },
      { match: (a) => a.join(' ') === 'mdns services', out: ok(MDNS) },
      { match: (a) => a[0] === 'connect', out: ok('connected') },
      { match: (a) => a.includes('android_id'), out: ok('abcdef1234567890') },
      { match: () => true, out: ok('') },
    ]);
    let preparations = 0;
    let preparationSignal: AbortSignal | undefined;
    const phones = createPhones({
      home: tempDir('phone-home-'),
      adbPath: null,
      run: fake.run,
      prepareAdb: async (signal) => {
        preparations += 1;
        preparationSignal = signal;
        return '/managed/adb';
      },
    });
    phones.setConsented([{ deviceId: 'S', phoneId: 'ph1' }]);
    expect(preparations).toBe(0);
    await createComputerDispatcher({ client: api.client, phones, ...FAST }).dispatch(
      call({
        tool: 'phone_manage',
        params: { action: 'pair', endpoint: '192.168.1.20:37001', code: '123456' },
        phone: { phoneId: 'ph1', deviceId: 'S' },
      }),
    );
    expect(preparations).toBe(1);
    expect(preparationSignal).toBeDefined();
    expect(api.frames.at(-1)?.kind).toBe('done');
  });

  test('phone_manage pair runs through the registry and posts the result', async () => {
    const api = apiOf();
    const fake = fakeAdb([
      { match: (a) => a[0] === 'pair', out: ok('ok') },
      { match: (a) => a.join(' ') === 'mdns services', out: ok(MDNS) },
      { match: (a) => a[0] === 'connect', out: ok('connected') },
      { match: (a) => a.includes('android_id'), out: ok('abcdef1234567890') },
      { match: () => true, out: ok('') },
    ]);
    await createComputerDispatcher({
      client: api.client,
      phones: await consentedPhones(fake.run),
      ...FAST,
    }).dispatch(
      call({
        tool: 'phone_manage',
        params: { action: 'pair', endpoint: '192.168.1.20:37001', code: '123456' },
        phone: { phoneId: 'ph1', deviceId: 'S' },
      }),
    );
    const pair = fake.calls.find((args) => args[0] === 'pair');
    expect(pair).toEqual(['pair', '192.168.1.20:37001', '123456']);
    expect(api.frames.at(-1)?.kind).toBe('done');
  });

  test('a machine with no phones registry refuses cleanly', async () => {
    const api = apiOf();
    await createComputerDispatcher({ client: api.client, ...FAST }).dispatch(call());
    expect(api.frames.at(-1)).toMatchObject({
      kind: 'error',
      delivery: 'not_delivered',
      message: NO_COMPUTER_PROVIDER_MESSAGE,
    });
  });

  test('setAdbPath announces readiness and triggers an immediate probe', async () => {
    const tmp = tempDir('phone-set-adb-');
    const fakeAdbPath = join(tmp, 'adb');
    writeFileSync(
      fakeAdbPath,
      '#!/bin/sh\ncase "$*" in\n  *"devices -l"*) echo "List of devices attached"; echo "emulator-5554\tdevice" ;;\n  *"android_id"*) echo "0123456789abcdef" ;;\n  *) echo "" ;;\nesac\n',
    );
    chmodSync(fakeAdbPath, 0o755);
    let readyCalls = 0;
    const phones = createPhones({
      home: tmp,
      adbPath: null,
      expectAdb: true,
      onAdbReady: () => {
        readyCalls += 1;
      },
    });
    expect(phones.usable()).toBe(false);
    phones.setAdbPath(fakeAdbPath);
    expect(phones.usable()).toBe(true);
    expect(readyCalls).toBe(1);
    await phones.refresh();
    expect(phones.reports()).toMatchObject([
      { deviceId: 'android:0123456789abcdef', link: 'ready' },
    ]);
    await phones.killAll();
  });

  test('a stale pre-migration presence list right after pairing does not kill the migrated driver', async () => {
    const fake = fakeAdb([
      { match: (a) => a[0] === 'pair', out: ok('ok') },
      { match: (a) => a.join(' ') === 'mdns services', out: ok(MDNS) },
      { match: (a) => a[0] === 'connect', out: ok('connected') },
      { match: (a) => a.includes('android_id'), out: ok('abcdef1234567890') },
      { match: (a) => a.includes('getprop'), out: ok('Pixel 8a') },
      {
        match: (a) => a.join(' ') === 'devices -l',
        out: ok('List of devices attached\n192.168.1.20:42155\tdevice\n'),
      },
      { match: () => true, out: ok('') },
    ]);
    const phones = createPhones({
      home: tempDir('phone-race-'),
      adbPath: '/bin/adb',
      run: fake.run,
    });
    phones.setConsented([{ deviceId: '192.168.1.20:37001', phoneId: 'ph1' }]);
    const out = await phones.manage(
      call({
        tool: 'phone_manage',
        params: { action: 'pair', endpoint: '192.168.1.20:37001', code: '123456' },
        phone: { phoneId: 'ph1', deviceId: '192.168.1.20:37001' },
      }),
    );
    expect(JSON.parse(out.text)).toMatchObject({
      outcome: 'paired',
      deviceId: 'android:abcdef1234567890',
    });
    phones.setConsented([{ deviceId: '192.168.1.20:37001', phoneId: 'ph1' }]);
    phones.setConsented([{ deviceId: 'android:abcdef1234567890', phoneId: 'ph1' }]);
    expect(fake.calls.some((a) => a[0] === 'disconnect')).toBe(false);
    const screen = phones.screen(
      call({ phone: { phoneId: 'ph1', deviceId: 'android:abcdef1234567890' } }),
    );
    expect(screen).not.toBeNull();
    expect((screen as AndroidPhone).dropped).toBe(false);
    await phones.killAll();
  });

  test('forget aborts an in-flight adb call on the driver and disconnects the network serial', async () => {
    let seenSignal: AbortSignal | undefined;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const disconnects: string[][] = [];
    const adb: AdbRun = async (args, opts) => {
      if (args[0] === 'disconnect') {
        disconnects.push([...args]);
        return ok('');
      }
      if (args.includes('uiautomator')) {
        seenSignal = opts?.signal;
        await gate;
        return ok('');
      }
      return ok('');
    };
    const driver = new AndroidPhone({ serial: '192.168.1.20:42155', adb });
    const pending = driver.observe(screenCall({}));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(seenSignal?.aborted).toBe(false);
    const forgotten = await driver.forget();
    expect(forgotten).toEqual({ outcome: 'forgotten' });
    expect(seenSignal?.aborted).toBe(true);
    expect(driver.dropped).toBe(true);
    expect(disconnects).toEqual([['disconnect', '192.168.1.20:42155']]);
    release();
    const observed = await pending;
    expect(observed).toMatchObject({
      kind: 'done',
      text: 'This phone was removed from the consented list, so nothing ran.',
    });
  });

  test('a failing phone probe clears stale cached reports and marks drivers unreachable', async () => {
    let failProbe = false;
    const fake = fakeAdb([
      {
        match: (a) => a.join(' ') === 'devices -l',
        out: () => {
          if (failProbe) throw new Error('adb daemon crashed');
          return ok('List of devices attached\n192.168.1.52:45391\tdevice\n');
        },
      },
      {
        match: (a) => a.join(' ') === 'mdns services',
        out: ok('adb-e33fb32c\t_adb-tls-connect._tcp\t192.168.1.52:45391\n'),
      },
      { match: (a) => a.includes('android_id'), out: ok('abcdef1234567890') },
      { match: () => true, out: ok('') },
    ]);
    const phones = createPhones({
      home: tempDir('phone-probe-fail-'),
      adbPath: '/bin/adb',
      run: fake.run,
    });
    phones.setConsented([{ deviceId: 'android:abcdef1234567890', phoneId: 'ph1' }]);
    await phones.refresh();
    expect(phones.reports()).toHaveLength(1);
    const screen = phones.screen(
      call({ phone: { phoneId: 'ph1', deviceId: 'android:abcdef1234567890' } }),
    );
    expect(screen).not.toBeNull();
    failProbe = true;
    await phones.refresh();
    expect(phones.reports()).toEqual([]);
    const before = fake.calls.length;
    const out = await screen?.observe({
      params: {},
      deadlineAt: Date.now() + 1_000,
      signal: new AbortController().signal,
    });
    expect(out).toMatchObject({
      kind: 'done',
      text: 'This phone is not currently visible on the local network, so nothing ran.',
    });
    expect(fake.calls.length).toBe(before);
    await phones.killAll();
  });

  test('MachineClient.phoneConsent preserves receiver binding through checkConsent and authorizes observe', async () => {
    const seenUrls: string[] = [];
    const client = new MachineClient({
      serverUrl: 'http://127.0.0.1:8787',
      getToken: () => 'tok',
      fetchImpl: async (input) => {
        seenUrls.push(String(input));
        return new Response(JSON.stringify({ ok: true, consented: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    });
    const fake = fakeAdb([
      { match: (a) => a.includes('uiautomator'), out: ok('') },
      { match: (a) => a.slice(-2).join(' ') === 'cat /data/local/tmp/cairn-ui.xml', out: ok(XML) },
      {
        match: (a) => a.includes('screencap'),
        out: () => ({ code: 0, stdout: png(), stderr: Buffer.alloc(0) }),
      },
      { match: () => true, out: ok('') },
    ]);
    const phones = createPhones({
      home: tempDir('phone-client-consent-'),
      adbPath: '/bin/adb',
      run: fake.run,
      checkConsent: async (phoneId, deviceId, callId) => {
        if (client.phoneConsent === undefined) return false;
        return (
          await client.phoneConsent({
            phoneId,
            deviceId,
            ...(callId !== undefined ? { callId } : {}),
          })
        ).consented;
      },
    });
    phones.setConsented([{ deviceId: 'S', phoneId: 'ph1' }]);
    await phones.refresh();
    const api = apiOf();
    await createComputerDispatcher({ client: api.client, phones, ...FAST }).dispatch(
      call({ phone: { phoneId: 'ph1', deviceId: 'S' } }),
    );
    expect(seenUrls.length).toBeGreaterThan(0);
    expect(seenUrls[0]).toContain('/api/machine/phone-consent');
    expect(api.frames.at(-1)?.kind).toBe('done');
    await phones.killAll();
  });

  test('phone_manage aborts when call deadline expires mid-execution', async () => {
    const api = apiOf();
    let seenSignal: AbortSignal | undefined;
    const phones = createPhones({
      home: tempDir('phone-deadline-'),
      adbPath: null,
      prepareAdb: (signal) =>
        new Promise((_resolve, reject) => {
          seenSignal = signal;
          signal?.addEventListener('abort', () => reject(new Error('aborted by deadline')), {
            once: true,
          });
        }),
    });
    phones.setConsented([{ deviceId: 'S', phoneId: 'ph1' }]);
    await createComputerDispatcher({ client: api.client, phones, ...FAST }).dispatch(
      call({
        tool: 'phone_manage',
        deadlineAt: Date.now() + 30,
        params: { action: 'pair', endpoint: '192.168.1.20:37001', code: '123456' },
        phone: { phoneId: 'ph1', deviceId: 'S' },
      }),
    );
    expect(seenSignal?.aborted).toBe(true);
    expect(api.frames.at(-1)?.kind).toBe('error');
    await phones.killAll();
  });
});
