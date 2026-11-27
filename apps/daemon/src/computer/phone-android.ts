import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  COMPUTER_IMAGE_MAX_BASE64_CHARS,
  type ComputerImage,
  isPrivateIpv4Endpoint,
  PHONE_ENDPOINT,
  PHONE_LOCKED,
  PHONE_PACKAGE,
  PHONE_SECURE_SCREEN,
} from '@cairn/shared';
import { z } from 'zod';
import type { HostScreen, ScreenCall, ScreenOutcome } from './host-screen.js';
import { fitPngUnderCap, pngSize } from './host-screen-png.js';
import {
  type AdbRun,
  dumpsysLocked,
  normalizeAndroidId,
  parseMdnsServices,
} from './phone-probe.js';

const UI_DUMP_PATH = '/data/local/tmp/cairn-ui.xml';
const YADB_REMOTE = '/data/local/tmp/yadb';
const YADB_TEXT_REMOTE = '/data/local/tmp/cairn-yadb-text';
const SECURE_PNG_BYTES = 16 * 1024;
const ADB_CALL_TIMEOUT_MS = 30_000;
const PAIR_TIMEOUT_MS = 4 * 60_000;
const SCREENCAP_TIMEOUT_MS = 20_000;
const elementNumber = z.number().int().min(1).max(100_000);

const point = {
  element: elementNumber.optional(),
  x: z.number().int().min(0).max(100_000).optional(),
  y: z.number().int().min(0).max(100_000).optional(),
};

const phoneActionSchema = z.discriminatedUnion('kind', [
  z
    .object({ kind: z.literal('tap'), ...point })
    .refine((a) =>
      a.element !== undefined
        ? a.x === undefined && a.y === undefined
        : a.x !== undefined && a.y !== undefined,
    ),
  z
    .object({
      kind: z.literal('long_press'),
      ...point,
      ms: z.number().int().min(1).max(10_000).optional(),
    })
    .refine((a) =>
      a.element !== undefined
        ? a.x === undefined && a.y === undefined
        : a.x !== undefined && a.y !== undefined,
    ),
  z
    .object({
      kind: z.literal('drag'),
      ...point,
      to_x: z.number().int().min(0).max(100_000),
      to_y: z.number().int().min(0).max(100_000),
      ms: z.number().int().min(1).max(10_000).optional(),
    })
    .refine((a) =>
      a.element !== undefined
        ? a.x === undefined && a.y === undefined
        : a.x !== undefined && a.y !== undefined,
    ),
  z.object({
    kind: z.literal('scroll'),
    direction: z.enum(['up', 'down', 'left', 'right']),
    element: elementNumber.optional(),
  }),
  z.object({
    kind: z.literal('type'),
    element: elementNumber.optional(),
    text: z.string().min(1).max(10_000),
  }),
  z.object({
    kind: z.literal('key'),
    key: z.enum(['back', 'home', 'app_switch', 'enter', 'delete']),
  }),
  z.object({ kind: z.literal('launch'), id: z.string().regex(PHONE_PACKAGE).max(256) }),
  z.object({ kind: z.literal('wait'), ms: z.number().int().min(1).max(10_000) }),
]);
type PhoneAction = z.infer<typeof phoneActionSchema>;

const actSchema = z.object({ actions: z.array(z.unknown()).min(1).max(24) });

const KEYCODES: Record<string, string> = {
  back: 'KEYCODE_BACK',
  home: 'KEYCODE_HOME',
  app_switch: 'KEYCODE_APP_SWITCH',
  enter: 'KEYCODE_ENTER',
  delete: 'KEYCODE_DEL',
};

const INPUT_TEXT_SAFE = /^[A-Za-z0-9\-_.:,/@=+!]+$/;
const CAIRN_PACKAGE = /cairn/i;
const CAIRN_FOREGROUND =
  /(?:mCurrentFocus|mFocusedApp)=(?:(?!mCurrentFocus=|mFocusedApp=)[^\n])*cairn/i;
const PHONE_CAIRN_FOREGROUND =
  'The Cairn app is in the foreground on the phone; it belongs to the owner, so nothing ran.';
const PHONE_DROPPED = 'This phone was removed from the consented list, so nothing ran.';
const PHONE_TRANSPORT_STALE =
  'This phone is not currently visible on the local network, so nothing ran.';

export interface PhoneElement {
  bounds: { left: number; top: number; right: number; bottom: number };
  text: string;
  description: string;
  className: string;
}

function parseBounds(
  raw: string,
): { left: number; top: number; right: number; bottom: number } | null {
  const match = /^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/.exec(raw);
  if (match === null) return null;
  return {
    left: Number(match[1]),
    top: Number(match[2]),
    right: Number(match[3]),
    bottom: Number(match[4]),
  };
}

const INTERACTIVE_CLASSES =
  /EditText|Button|CheckBox|RadioButton|Switch|Spinner|SeekBar|SearchView|TabLayout|ViewPager|AdapterView|ListView|GridView|RecycleView|ImageButton|TextView|ImageView$/;

export function parseUiAutomator(xml: string): PhoneElement[] {
  const elements: PhoneElement[] = [];
  const tag = /<node\b([^<>]*?)\/?>/g;
  for (;;) {
    const match = tag.exec(xml);
    if (match === null) break;
    const attrs = match[1]!;
    const attr = (name: string): string => new RegExp(`${name}="([^"]*)"`).exec(attrs)?.[1] ?? '';
    const bounds = parseBounds(attr('bounds'));
    if (bounds === null) continue;
    if (bounds.right <= bounds.left || bounds.bottom <= bounds.top) continue;
    const className = attr('class');
    const text = attr('text');
    const description = attr('content-desc');
    const interactive =
      attr('clickable') === 'true' ||
      attr('focusable') === 'true' ||
      attr('scrollable') === 'true' ||
      attr('long-clickable') === 'true' ||
      INTERACTIVE_CLASSES.test(className);
    if (!interactive && text === '' && description === '') continue;
    elements.push({ bounds, text, description, className });
  }
  return elements;
}

export function elementCenter(element: PhoneElement): { x: number; y: number } {
  return {
    x: Math.round((element.bounds.left + element.bounds.right) / 2),
    y: Math.round((element.bounds.top + element.bounds.bottom) / 2),
  };
}

function elementRow(index: number, element: PhoneElement): string {
  const kind = element.className.split('.').pop() ?? 'element';
  const label = element.description !== '' ? element.description : element.text;
  const named = label !== '' ? ` ${JSON.stringify(label)}` : '';
  const { x, y } = elementCenter(element);
  return `[${index + 1}] ${kind}${named} (${x}, ${y})`;
}

function rowsOf(elements: readonly PhoneElement[]): string {
  const lines = elements.map((element, index) => elementRow(index, element));
  const text = lines.join('\n');
  return text.length > 48_000 ? `${text.slice(0, 48_000)}\n[truncated]` : text;
}

async function sleep(ms: number, signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

export interface AndroidPhoneOptions {
  serial: string;
  adb: AdbRun;
  yadb?: (() => Promise<string | null>) | undefined;
  consent?: ((callId?: string) => Promise<boolean>) | undefined;
  tmpDir?: string;
  now?: () => number;
}

export class AndroidPhone implements HostScreen {
  private serial: string;
  private readonly adb: AdbRun;
  private readonly yadb: (() => Promise<string | null>) | undefined;
  private consent: ((callId?: string) => Promise<boolean>) | undefined;
  private readonly tmpDir: string;
  private readonly now: () => number;
  private elements: PhoneElement[] = [];
  private shown: PhoneElement[] = [];
  private pushedYadb = false;
  private queue: Promise<unknown> = Promise.resolve();
  private active = 0;
  private pendingSerial: string | null = null;
  private transportMissing = false;
  private activeConsentCallId: string | undefined;
  private dead = false;
  private readonly abortCtl = new AbortController();

  get dropped(): boolean {
    return this.dead;
  }

  get transportSerial(): string {
    return this.serial;
  }

  constructor(options: AndroidPhoneOptions) {
    this.serial = options.serial;
    this.adb = options.adb;
    this.yadb = options.yadb;
    this.consent = options.consent;
    this.tmpDir = options.tmpDir ?? mkdtempSync(join(tmpdir(), 'cairn-phone-'));
    this.now = options.now ?? Date.now;
  }

  setConsent(consent: ((callId?: string) => Promise<boolean>) | undefined): void {
    this.consent = consent;
  }

  updateSerial(serial: string): void {
    if (this.active > 0) {
      this.pendingSerial = serial;
      return;
    }
    this.transportMissing = false;
    this.applySerial(serial);
  }

  markUnreachable(): void {
    this.transportMissing = true;
    this.pendingSerial = null;
    this.elements = [];
    this.shown = [];
    this.pushedYadb = false;
  }

  private applySerial(serial: string): void {
    if (serial === this.serial) return;
    this.serial = serial;
    this.elements = [];
    this.shown = [];
    this.pushedYadb = false;
  }

  private settleSerial(): void {
    if (this.active !== 0 || this.pendingSerial === null) return;
    const serial = this.pendingSerial;
    this.pendingSerial = null;
    this.transportMissing = false;
    this.applySerial(serial);
  }

  private async assertConsent(requireTransport = true): Promise<void> {
    if (this.dead) throw new Error(PHONE_DROPPED);
    if (requireTransport && this.transportMissing) throw new Error(PHONE_TRANSPORT_STALE);
    if (this.consent === undefined) return;
    const consented = await this.consent(this.activeConsentCallId).catch(() => false);
    if (!consented) throw new Error(PHONE_DROPPED);
  }

  private async run(
    args: readonly string[],
    opts: { timeoutMs?: number; signal?: AbortSignal; input?: Buffer } = {},
  ) {
    await this.assertConsent();
    const sig =
      opts.signal !== undefined
        ? AbortSignal.any([opts.signal, this.abortCtl.signal])
        : this.abortCtl.signal;
    return this.adb(['-s', this.serial, ...args], {
      timeoutMs: opts.timeoutMs ?? ADB_CALL_TIMEOUT_MS,
      signal: sig,
      ...(opts.input !== undefined ? { input: opts.input } : {}),
    });
  }

  private raw(args: readonly string[], opts: { timeoutMs?: number; signal?: AbortSignal } = {}) {
    const signal =
      opts.signal !== undefined
        ? AbortSignal.any([opts.signal, this.abortCtl.signal])
        : this.abortCtl.signal;
    return this.adb(args, {
      timeoutMs: opts.timeoutMs ?? ADB_CALL_TIMEOUT_MS,
      signal,
    });
  }

  private async pairingRaw(
    args: readonly string[],
    opts: { timeoutMs?: number; signal?: AbortSignal } = {},
  ) {
    await this.assertConsent(false);
    return this.raw(args, opts);
  }

  private async uiXml(call: ScreenCall): Promise<string> {
    const budget = Math.max(5_000, call.deadlineAt - this.now() - 8_000);
    await this.run(['shell', 'uiautomator', 'dump', UI_DUMP_PATH], {
      timeoutMs: Math.min(ADB_CALL_TIMEOUT_MS, budget),
      signal: call.signal,
    });
    const out = await this.run(['exec-out', 'cat', UI_DUMP_PATH], {
      timeoutMs: Math.min(ADB_CALL_TIMEOUT_MS, budget),
      signal: call.signal,
    });
    void this.run(['shell', 'rm', '-f', UI_DUMP_PATH], { timeoutMs: 5_000 }).catch(() => {});
    return out.stdout.toString('utf8');
  }

  private async screenshot(call: ScreenCall): Promise<Buffer | null> {
    const out = await this.run(['exec-out', 'screencap', '-p'], {
      timeoutMs: SCREENCAP_TIMEOUT_MS,
      signal: call.signal,
    });
    const png = out.stdout;
    if (pngSize(png) === undefined) return null;
    return png;
  }

  private imageOf(png: Buffer | null): { images: ComputerImage[]; secure: boolean } {
    if (png === null || png.length < SECURE_PNG_BYTES) return { images: [], secure: true };
    const fitted = fitPngUnderCap(png, [1568, 1024, 640], COMPUTER_IMAGE_MAX_BASE64_CHARS);
    if (fitted === undefined) return { images: [], secure: false };
    return {
      images: [{ data: fitted.png.toString('base64'), mimeType: 'image/png' }],
      secure: false,
    };
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const runWork = async () => {
      this.active += 1;
      try {
        return await work();
      } finally {
        this.active -= 1;
        this.settleSerial();
      }
    };
    const next = this.queue.then(runWork, runWork);
    this.queue = next;
    return next;
  }

  private async foregroundGuard(call: ScreenCall): Promise<string | null> {
    if (this.dead) return PHONE_DROPPED;
    const window = await this.run(['shell', 'dumpsys', 'window'], { signal: call.signal });
    if (window.code !== 0) return PHONE_LOCKED;
    const text = window.stdout.toString('utf8');
    if (dumpsysLocked(text)) return PHONE_LOCKED;
    if (CAIRN_FOREGROUND.test(text)) return PHONE_CAIRN_FOREGROUND;
    return null;
  }

  observe(call: ScreenCall): Promise<ScreenOutcome> {
    return this.enqueue(async () => {
      this.activeConsentCallId = call.callId;
      try {
        return await this.observeBody(call);
      } finally {
        this.activeConsentCallId = undefined;
      }
    });
  }

  private async observeBody(call: ScreenCall): Promise<ScreenOutcome> {
    if (this.dead) return { kind: 'done', text: PHONE_DROPPED, images: [] };
    try {
      const window = await this.run(['shell', 'dumpsys', 'window'], { signal: call.signal });
      if (window.code !== 0 || dumpsysLocked(window.stdout.toString('utf8')))
        return { kind: 'done', text: PHONE_LOCKED, images: [] };
      if (call.params.apps === true) {
        const out = await this.run(
          [
            'shell',
            'cmd',
            'package',
            'query-activities',
            '-a',
            'android.intent.action.MAIN',
            '-c',
            'android.intent.category.LAUNCHER',
            '--brief',
          ],
          { signal: call.signal },
        );
        const apps = out.stdout
          .toString('utf8')
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.includes('/') && !line.startsWith('priority'))
          .map((line) => line.split(' ')[0]!)
          .map((component) => {
            const [pkg] = component.split('/');
            return `${pkg}\t${component}`;
          });
        return { kind: 'done', text: apps.join('\n') || 'no launchable apps', images: [] };
      }
      const xml = await this.uiXml(call);
      this.elements = parseUiAutomator(xml);
      const query =
        typeof call.params.query === 'string' && call.params.query.trim() !== ''
          ? call.params.query.trim().toLowerCase()
          : null;
      const shown =
        query === null
          ? this.elements
          : this.elements.filter(
              (element) =>
                element.text.toLowerCase().includes(query) ||
                element.description.toLowerCase().includes(query),
            );
      const png = await this.screenshot(call);
      const { images, secure } = this.imageOf(png);
      if (secure) {
        this.elements = [];
        this.shown = [];
        return { kind: 'done', text: PHONE_SECURE_SCREEN, images: [] };
      }
      this.shown = shown;
      return {
        kind: 'done',
        text: rowsOf(shown) === '' ? 'no interactive elements' : rowsOf(shown),
        images,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'the phone observation failed';
      if (message === PHONE_DROPPED) return { kind: 'done', text: PHONE_DROPPED, images: [] };
      if (message === PHONE_TRANSPORT_STALE)
        return { kind: 'done', text: PHONE_TRANSPORT_STALE, images: [] };
      return {
        kind: 'error',
        message,
        delivery: 'unknown',
      };
    }
  }

  private pointOf(action: {
    element?: number;
    x?: number;
    y?: number;
  }): { x: number; y: number } | string {
    if (action.element !== undefined) {
      const element = this.shown[action.element - 1];
      if (element === undefined)
        return `element ${action.element} is not in the latest observation; call phone_observe again`;
      return elementCenter(element);
    }
    return { x: action.x ?? 0, y: action.y ?? 0 };
  }

  private async ensureYadb(call: ScreenCall): Promise<string | null> {
    if (this.pushedYadb) return YADB_REMOTE;
    const local = this.yadb === undefined ? null : await this.yadb();
    if (local === null) return null;
    const pushed = await this.run(['push', local, YADB_REMOTE], {
      timeoutMs: ADB_CALL_TIMEOUT_MS,
      signal: call.signal,
    });
    if (pushed.code !== 0) return null;
    this.pushedYadb = true;
    return YADB_REMOTE;
  }

  private async typeText(call: ScreenCall, text: string): Promise<string> {
    if (INPUT_TEXT_SAFE.test(text)) {
      await this.run(['shell', 'input', 'text', text], { signal: call.signal });
      return `typed ${text.length} chars`;
    }
    const remote = await this.ensureYadb(call);
    if (remote === null)
      throw new Error('typing this text needs the input helper, which is not installed');
    const dir = this.tmpDir;
    const local = join(dir, `text-${randomBytes(6).toString('hex')}.txt`);
    writeFileSync(local, text, 'utf8');
    try {
      const pushed = await this.run(['push', local, YADB_TEXT_REMOTE], {
        timeoutMs: ADB_CALL_TIMEOUT_MS,
        signal: call.signal,
      });
      if (pushed.code !== 0)
        throw new Error(`pushing the typed text failed: ${pushed.stderr.toString('utf8').trim()}`);
      await this.run(
        [
          'shell',
          `app_process -Djava.class.path=${YADB_REMOTE} /data/local/tmp com.ysbing.yadb.Main -keyboard "$(cat ${YADB_TEXT_REMOTE})"`,
        ],
        { timeoutMs: ADB_CALL_TIMEOUT_MS, signal: call.signal },
      );
      return `typed ${text.length} chars`;
    } finally {
      rmSync(local, { force: true });
      void this.run(['shell', 'rm', '-f', YADB_TEXT_REMOTE], { timeoutMs: 5_000 }).catch(() => {});
    }
  }

  act(call: ScreenCall): Promise<ScreenOutcome> {
    return this.enqueue(async () => {
      this.activeConsentCallId = call.callId;
      try {
        return await this.actBody(call);
      } finally {
        this.activeConsentCallId = undefined;
      }
    });
  }

  private async actBody(call: ScreenCall): Promise<ScreenOutcome> {
    const parsed = actSchema.safeParse(call.params);
    if (!parsed.success)
      return {
        kind: 'error',
        message: `phone_act needs an actions array of at most 24 entries`,
        delivery: 'not_delivered',
      };
    const actions: PhoneAction[] = [];
    for (const raw of parsed.data.actions) {
      const action = phoneActionSchema.safeParse(raw);
      if (!action.success)
        return {
          kind: 'error',
          message: `an action is not a known phone action (tap, long_press, drag, scroll, type, key, launch, wait)`,
          delivery: 'not_delivered',
        };
      actions.push(action.data);
    }
    const done: string[] = [];
    const guardRefusal = (reason: string): ScreenOutcome => ({
      kind: 'done',
      text: done.length === 0 ? reason : `${done.join('; ')}; then ${reason}`,
      images: [],
    });
    if (this.dead) return { kind: 'done', text: PHONE_DROPPED, images: [] };
    try {
      const guard = await this.foregroundGuard(call);
      if (guard !== null) return { kind: 'done', text: guard, images: [] };
      const png = await this.screenshot(call);
      if (png === null || png.length < SECURE_PNG_BYTES)
        return { kind: 'done', text: PHONE_SECURE_SCREEN, images: [] };
      let first = true;
      for (const action of actions) {
        if (action.kind !== 'wait' && !first) {
          const guard = await this.foregroundGuard(call);
          if (guard !== null) return guardRefusal(guard);
          const png = await this.screenshot(call);
          if (png === null || png.length < SECURE_PNG_BYTES)
            return guardRefusal(PHONE_SECURE_SCREEN);
        }
        first = false;
        switch (action.kind) {
          case 'tap': {
            const point = this.pointOf(action);
            if (typeof point === 'string')
              return { kind: 'error', message: point, delivery: 'not_delivered' };
            await this.run(['shell', 'input', 'tap', String(point.x), String(point.y)], {
              signal: call.signal,
            });
            done.push(`tapped (${point.x}, ${point.y})`);
            break;
          }
          case 'long_press': {
            const point = this.pointOf(action);
            if (typeof point === 'string')
              return { kind: 'error', message: point, delivery: 'not_delivered' };
            const ms = action.ms ?? 700;
            await this.run(
              [
                'shell',
                'input',
                'swipe',
                String(point.x),
                String(point.y),
                String(point.x),
                String(point.y),
                String(ms),
              ],
              { signal: call.signal },
            );
            done.push(`long pressed (${point.x}, ${point.y})`);
            break;
          }
          case 'drag': {
            const point = this.pointOf(action);
            if (typeof point === 'string')
              return { kind: 'error', message: point, delivery: 'not_delivered' };
            await this.run(
              [
                'shell',
                'input',
                'swipe',
                String(point.x),
                String(point.y),
                String(action.to_x),
                String(action.to_y),
                String(action.ms ?? 500),
              ],
              { signal: call.signal },
            );
            done.push(`dragged (${point.x}, ${point.y}) to (${action.to_x}, ${action.to_y})`);
            break;
          }
          case 'scroll': {
            const anchor =
              action.element !== undefined ? this.pointOf(action) : { x: 540, y: 1200 };
            if (typeof anchor === 'string')
              return { kind: 'error', message: anchor, delivery: 'not_delivered' };
            const distance = 800;
            const [dx, dy] =
              action.direction === 'up'
                ? [0, -distance]
                : action.direction === 'down'
                  ? [0, distance]
                  : action.direction === 'left'
                    ? [-distance, 0]
                    : [distance, 0];
            await this.run(
              [
                'shell',
                'input',
                'swipe',
                String(anchor.x),
                String(anchor.y),
                String(anchor.x + dx),
                String(anchor.y + dy),
                '300',
              ],
              { signal: call.signal },
            );
            done.push(`scrolled ${action.direction}`);
            break;
          }
          case 'type': {
            if (action.element !== undefined) {
              const point = this.pointOf(action);
              if (typeof point === 'string')
                return { kind: 'error', message: point, delivery: 'not_delivered' };
              await this.run(['shell', 'input', 'tap', String(point.x), String(point.y)], {
                signal: call.signal,
              });
            }
            done.push(await this.typeText(call, action.text));
            break;
          }
          case 'key': {
            await this.run(['shell', 'input', 'keyevent', KEYCODES[action.key]!], {
              signal: call.signal,
            });
            done.push(`pressed ${action.key}`);
            break;
          }
          case 'launch': {
            if (CAIRN_PACKAGE.test(action.id))
              return {
                kind: 'error',
                message: 'phone_act on the Cairn app itself is refused',
                delivery: 'not_delivered',
              };
            await this.run(
              ['shell', 'monkey', '-p', action.id, '-c', 'android.intent.category.LAUNCHER', '1'],
              { signal: call.signal },
            );
            done.push(`launched ${action.id}`);
            break;
          }
          case 'wait': {
            await sleep(action.ms, AbortSignal.any([call.signal, this.abortCtl.signal]));
            done.push(`waited ${action.ms} ms`);
            break;
          }
        }
      }
      const observed = await this.observeBody(call);
      const tail = observed.kind === 'done' ? observed.text : observed.message;
      const images = observed.kind === 'done' ? observed.images : [];
      return {
        kind: 'done',
        text: `${done.join('\n')}\n\n${tail}`,
        images,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'the phone action failed';
      if (message === PHONE_DROPPED) return guardRefusal(PHONE_DROPPED);
      if (message === PHONE_TRANSPORT_STALE) return guardRefusal(PHONE_TRANSPORT_STALE);
      return {
        kind: 'error',
        message,
        delivery: 'unknown',
      };
    }
  }

  pair(params: {
    code?: string;
    endpoint?: string;
    signal?: AbortSignal;
    callId?: string;
  }): Promise<{ outcome: 'paired'; deviceId: string; name: string }> {
    return this.enqueue(async () => {
      this.activeConsentCallId = params.callId;
      try {
        return await this.pairBody(params);
      } finally {
        this.activeConsentCallId = undefined;
      }
    });
  }

  private async pairBody(params: {
    code?: string;
    endpoint?: string;
    signal?: AbortSignal;
    callId?: string;
  }): Promise<{ outcome: 'paired'; deviceId: string; name: string }> {
    if (params.endpoint !== undefined && params.code !== undefined) {
      if (!PHONE_ENDPOINT.test(params.endpoint) || !isPrivateIpv4Endpoint(params.endpoint))
        throw new Error('the pair endpoint is not a private-network ip:port');
      if (!/^\d{6}$/.test(params.code)) throw new Error('the pairing code is not 6 digits');
      const pair = await this.pairingRaw(['pair', params.endpoint, params.code], {
        timeoutMs: PAIR_TIMEOUT_MS,
        ...(params.signal !== undefined ? { signal: params.signal } : {}),
      });
      if (pair.code !== 0)
        throw new Error(
          `adb pair failed: ${pair.stderr.toString('utf8').trim() || pair.stdout.toString('utf8').trim()}`,
        );
      const ip = params.endpoint.slice(0, params.endpoint.lastIndexOf(':'));
      const connect = await this.connectAddress(ip, params.signal);
      if (connect === null)
        throw new Error('the paired phone did not advertise wireless adb on the local network');
      const connected = await this.pairingRaw(['connect', connect], {
        ...(params.signal !== undefined ? { signal: params.signal } : {}),
      });
      const out = `${connected.stdout.toString('utf8')}${connected.stderr.toString('utf8')}`;
      if (connected.code !== 0 || /failed|cannot|refused/i.test(out))
        throw new Error(`adb connect ${connect} failed: ${out.trim()}`);
      this.applySerial(connect);
      const deviceId = await this.stableDeviceId(params.signal);
      const name = await this.deviceName(params.signal);
      return { outcome: 'paired', deviceId, name };
    }
    const waited = await this.pairingRaw(['-s', this.serial, 'wait-for-device'], {
      timeoutMs: PAIR_TIMEOUT_MS,
      ...(params.signal !== undefined ? { signal: params.signal } : {}),
    });
    if (waited.code !== 0)
      throw new Error(
        `waiting for USB authorization failed: ${waited.stderr.toString('utf8').trim()}`,
      );
    const state = await this.pairingRaw(['-s', this.serial, 'get-state'], {
      ...(params.signal !== undefined ? { signal: params.signal } : {}),
    });
    if (state.stdout.toString('utf8').trim() !== 'device')
      throw new Error('the phone did not authorize; tap Allow on the USB debugging prompt');
    return {
      outcome: 'paired',
      deviceId: await this.stableDeviceId(params.signal),
      name: await this.deviceName(params.signal),
    };
  }

  private async connectAddress(ip: string, signal?: AbortSignal): Promise<string | null> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const mdns = await this.pairingRaw(['mdns', 'services'], {
        ...(signal !== undefined ? { signal } : {}),
      }).catch(() => null);
      if (mdns !== null) {
        const services = parseMdnsServices(mdns.stdout.toString('utf8'));
        const match = services.find(
          (service) =>
            service.address.startsWith(`${ip}:`) &&
            service.serviceType.startsWith('_adb-tls-connect'),
        );
        if (match !== undefined) return match.address;
      }
      await sleep(
        500,
        signal !== undefined
          ? AbortSignal.any([signal, this.abortCtl.signal])
          : this.abortCtl.signal,
      );
    }
    return null;
  }

  private async stableDeviceId(signal?: AbortSignal): Promise<string> {
    const out = await this.pairingRaw(
      ['-s', this.serial, 'shell', 'settings', 'get', 'secure', 'android_id'],
      { ...(signal !== undefined ? { signal } : {}) },
    );
    const stable = normalizeAndroidId(out.stdout.toString('utf8'));
    if (stable === null) throw new Error('the phone did not expose a stable Android id');
    return stable;
  }

  private async deviceName(signal?: AbortSignal): Promise<string> {
    const out = await this.pairingRaw(['-s', this.serial, 'shell', 'getprop', 'ro.product.model'], {
      ...(signal !== undefined ? { signal } : {}),
    });
    const name = out.stdout.toString('utf8').trim();
    return name === '' ? this.serial : name;
  }

  async forget(): Promise<{ outcome: 'forgotten' }> {
    this.dead = true;
    this.abortCtl.abort();
    if (this.serial.includes(':') || this.serial.includes('._adb-tls-connect'))
      await this.adb(['disconnect', this.serial], { timeoutMs: 5_000 }).catch(() => null);
    return { outcome: 'forgotten' };
  }

  async killAll(): Promise<void> {
    this.dead = true;
    this.abortCtl.abort();
    if (this.serial.includes(':') || this.serial.includes('._adb-tls-connect'))
      void this.adb(['disconnect', this.serial], { timeoutMs: 5_000 }).catch(() => {});
    rmSync(this.tmpDir, { recursive: true, force: true });
  }
}
