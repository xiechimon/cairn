import { execFile } from 'node:child_process';
import { chmodSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { COMPUTER_IMAGE_MAX_BASE64_CHARS, type ComputerImage } from '@cairn/shared';
import { z } from 'zod';
import { hostCommandEnvironment } from './host.js';
import { fitPng } from './host-screen-png.js';
import { type AccessibilityNode, accessibilityRows } from './host-screen-rows.js';
import { isBrowserApp, isDaemonProcess, originHosts, showsCairn } from './host-screen-self.js';

export const AGENT_DESKTOP_VERSION = '1.1.0';
export const SCREEN_MAX_ACTIONS = 24;
export const SCREEN_MAX_WAIT_MS = 10_000;
export const SCREEN_IMAGE_EDGES: readonly number[] = [1568, 1024, 640];
export const SCREEN_COMMAND_TIMEOUT_MS = 30_000;
export const SCREEN_OUTPUT_CAP_BYTES = 24 * 1024 * 1024;
export const SCREEN_ERROR_MESSAGE_MAX_CHARS = 4096;
export const SCREEN_TEXT_MAX_CHARS = 60_000;
const FINAL_FRAME_MARGIN_MS = 5_000;
const MIN_BUDGET_MS = 1_000;
const SNAPSHOT_TIMEOUT_MS = '8000';
const FIND_LIMIT = 50;
const UNPROVEN_RECEIVER =
  'Raw coordinate clicks are unavailable until their receiver identity can be proven; use an observed element number instead';

export type ScreenOutcome =
  | { kind: 'done'; text: string; images: ComputerImage[] }
  | { kind: 'error'; message: string; delivery: 'not_delivered' | 'unknown' };

export interface ScreenCall {
  params: Record<string, unknown>;
  deadlineAt: number;
  signal: AbortSignal;
}

export interface HostScreen {
  observe(call: ScreenCall): Promise<ScreenOutcome>;
  act(call: ScreenCall): Promise<ScreenOutcome>;
  killAll(): Promise<void>;
}

interface AgentDesktopEnvelope {
  ok: boolean;
  data?: unknown;
  error?: { code?: string; message?: string; disposition?: { retry?: string } };
}

type RunResult =
  | { kind: 'envelope'; envelope: AgentDesktopEnvelope; raw: string }
  | { kind: 'failed'; reason: 'missing' | 'timeout' | 'aborted' | 'oversize' | 'unusable' };

interface ScreenWindow {
  id: string;
  title?: string;
  app_name: string;
  pid: number;
  accessible?: boolean;
  minimized?: boolean;
  visible?: boolean;
}

interface Target {
  app: string;
  windowId: string;
  title: string;
}

class Stop extends Error {
  constructor(readonly outcome: Extract<ScreenOutcome, { kind: 'error' }>) {
    super(outcome.message);
  }
}

const elementNumber = z.number().int().min(1).max(100_000);
const actionSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('click'),
      element: elementNumber.optional(),
      x: z.number().int().min(0).max(100_000).optional(),
      y: z.number().int().min(0).max(100_000).optional(),
      double: z.boolean().optional(),
      button: z.enum(['left', 'right']).optional(),
    })
    .refine((action) =>
      action.element !== undefined
        ? action.x === undefined && action.y === undefined
        : action.x !== undefined && action.y !== undefined,
    ),
  z.object({ kind: z.literal('type'), element: elementNumber, text: z.string().max(10_000) }),
  z.object({ kind: z.literal('set'), element: elementNumber, value: z.string().max(10_000) }),
  z.object({
    kind: z.literal('key'),
    key: z.string().min(1).max(32),
    modifiers: z
      .array(z.enum(['cmd', 'ctrl', 'alt', 'option', 'shift']))
      .max(4)
      .optional(),
  }),
  z.object({
    kind: z.literal('scroll'),
    direction: z.enum(['up', 'down', 'left', 'right']),
    amount: z.number().int().min(1).max(50).optional(),
    element: elementNumber.optional(),
  }),
  z.object({ kind: z.literal('menu'), path: z.array(z.string().min(1).max(200)).min(1).max(6) }),
  z.object({ kind: z.literal('wait'), ms: z.number().int().min(1).max(SCREEN_MAX_WAIT_MS) }),
]);
type ScreenAction = z.infer<typeof actionSchema>;
const ACTION_KINDS = 'click, type, set, key, scroll, menu, wait';

const appSchema = z.string().trim().min(1).max(100);
const observeSchema = z.object({
  app: appSchema,
  query: z.string().trim().min(1).max(200).optional(),
});
const actSchema = z.object({ app: appSchema, actions: z.array(z.unknown()) });

const MODIFIER_NAMES = { cmd: 'ctrl', ctrl: 'ctrl', alt: 'alt', option: 'alt', shift: 'shift' };

export interface AgentDesktopHostScreenOptions {
  binary?: string;
  stateDir?: string;
  env?: NodeJS.ProcessEnv;
  cairnOrigins?: readonly string[];
  isOwnProcess?: (pid: number) => Promise<boolean>;
  commandTimeoutMs?: number;
  outputCapBytes?: number;
  imageMaxBase64Chars?: number;
  now?: () => number;
}

export function defaultAgentDesktopBinary(home: string = homedir()): string {
  return path.join(
    home,
    '.cairn',
    'tools',
    'agent-desktop',
    AGENT_DESKTOP_VERSION,
    'agent-desktop',
  );
}

export function createHostScreenFromEnv(env: NodeJS.ProcessEnv): HostScreen | undefined {
  if (env.CAIRN_OWN_COMPUTER !== '1') return undefined;
  return new AgentDesktopHostScreen({
    env,
    ...(env.CAIRN_AGENT_DESKTOP ? { binary: env.CAIRN_AGENT_DESKTOP } : {}),
    cairnOrigins: (env.CAIRN_WEB_ORIGINS ?? '').split(',').filter((origin) => origin.trim() !== ''),
  });
}

function refuse(message: string): Stop {
  return new Stop({ kind: 'error', message, delivery: 'not_delivered' });
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut =
    text.charCodeAt(max - 1) >= 0xd800 && text.charCodeAt(max - 1) <= 0xdbff ? max - 1 : max;
  return text.slice(0, cut);
}

export class AgentDesktopHostScreen implements HostScreen {
  private readonly binary: string;
  private readonly stateDir: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly hosts: string[];
  private readonly isOwnProcess: (pid: number) => Promise<boolean>;
  private readonly commandTimeoutMs: number;
  private readonly outputCapBytes: number;
  private readonly imageMaxBase64Chars: number;
  private readonly now: () => number;
  private readonly closing = new AbortController();
  private readonly snapshots = new Map<string, { id: string; windowId: string }>();
  private readonly cairnWindows = new Set<string>();
  private windowCaptureUnsupported = false;

  constructor(options: AgentDesktopHostScreenOptions = {}) {
    this.env = options.env ?? process.env;
    const home = this.env.HOME ?? homedir();
    this.binary = options.binary ?? defaultAgentDesktopBinary(home);
    this.stateDir = options.stateDir ?? path.join(path.dirname(this.binary), 'state');
    this.hosts = originHosts(options.cairnOrigins ?? []);
    this.isOwnProcess = options.isOwnProcess ?? ((pid) => isDaemonProcess(pid));
    this.commandTimeoutMs = options.commandTimeoutMs ?? SCREEN_COMMAND_TIMEOUT_MS;
    this.outputCapBytes = options.outputCapBytes ?? SCREEN_OUTPUT_CAP_BYTES;
    this.imageMaxBase64Chars = options.imageMaxBase64Chars ?? COMPUTER_IMAGE_MAX_BASE64_CHARS;
    this.now = options.now ?? Date.now;
  }

  async killAll(): Promise<void> {
    this.closing.abort();
  }

  async observe(call: ScreenCall): Promise<ScreenOutcome> {
    try {
      const parsed = observeSchema.safeParse(call.params);
      if (!parsed.success) {
        throw refuse('user_computer_observe needs an app name and an optional query string');
      }
      const budget = this.budget(call);
      const target = await this.target(parsed.data.app, call, budget);
      const text = await this.observation(target, call, budget, parsed.data.query);
      return { kind: 'done', text: text.text, images: text.images };
    } catch (error) {
      if (error instanceof Stop) return error.outcome;
      throw error;
    }
  }

  async act(call: ScreenCall): Promise<ScreenOutcome> {
    try {
      const parsed = actSchema.safeParse(call.params);
      if (!parsed.success) throw refuse('user_computer_act needs an app name and an actions list');
      const { app, actions: rawActions } = parsed.data;
      if (rawActions.length === 0) throw refuse('user_computer_act needs at least one action');
      if (rawActions.length > SCREEN_MAX_ACTIONS) {
        throw refuse(
          `At most ${SCREEN_MAX_ACTIONS} actions are allowed per call and ${rawActions.length} were sent; nothing ran`,
        );
      }
      const actions = rawActions.map((raw, index) => {
        const action = actionSchema.safeParse(raw);
        if (!action.success) {
          const kind = (raw as { kind?: unknown } | null)?.kind;
          throw refuse(
            typeof kind === 'string' && ACTION_KINDS.split(', ').includes(kind)
              ? `Action ${index + 1} (${kind}) has invalid arguments; nothing ran`
              : `Action ${index + 1} has an unknown kind; use one of ${ACTION_KINDS}. Nothing ran`,
          );
        }
        if (action.data.kind === 'click' && action.data.element === undefined) {
          throw refuse(UNPROVEN_RECEIVER);
        }
        return action.data;
      });
      const budget = this.budget(call);
      const target = await this.target(app, call, budget);
      for (const action of actions) {
        if ('element' in action && action.element !== undefined) this.ref(target, action.element);
      }
      const done: string[] = [];
      for (const [index, action] of actions.entries()) {
        try {
          if (isBrowserApp(target.app)) {
            const checked = await this.read(
              [
                'snapshot',
                '--window-id',
                target.windowId,
                '--timeout-ms',
                SNAPSHOT_TIMEOUT_MS,
                '--compact',
                '--max-depth',
                '40',
              ],
              call,
              budget,
            );
            if (!checked.ok) throw refuse(clip(checked.raw, SCREEN_ERROR_MESSAGE_MAX_CHARS));
            const data = checked.data as { tree?: AccessibilityNode };
            const rows = accessibilityRows(data.tree ? [data.tree] : [], '', false);
            if (showsCairn(rows.strings, ['cairn', ...this.hosts])) {
              this.cairnWindows.add(target.windowId);
              throw refuse('This window shows the cairn web app; it is never driven');
            }
          }
          await this.perform(target, action, index, done.length, call, budget);
        } catch (error) {
          if (error instanceof Stop && done.length > 0) {
            throw new Stop({ ...error.outcome, delivery: 'unknown' });
          }
          throw error;
        }
        done.push(`${index + 1}. ${action.kind}: delivered`);
      }
      let tail: string;
      let images: ComputerImage[] = [];
      try {
        const seen = await this.observation(target, call, budget);
        tail = seen.text;
        images = seen.images;
      } catch (error) {
        if (!(error instanceof Stop)) throw error;
        tail = `The actions ran, but looking at ${target.app} afterwards failed: ${error.outcome.message}`;
      }
      return {
        kind: 'done',
        text: clip(`${done.join('\n')}\n\n${tail}`, SCREEN_TEXT_MAX_CHARS),
        images,
      };
    } catch (error) {
      if (error instanceof Stop) return error.outcome;
      throw error;
    }
  }

  private budget(call: ScreenCall): { endsAt: number } {
    const endsAt = call.deadlineAt - FINAL_FRAME_MARGIN_MS;
    if (endsAt - this.now() < MIN_BUDGET_MS) {
      throw refuse('Too little time was left before the call deadline, so nothing ran');
    }
    return { endsAt };
  }

  private run(
    args: readonly string[],
    call: ScreenCall,
    budget: { endsAt: number },
  ): Promise<RunResult> {
    const timeout = Math.min(this.commandTimeoutMs, budget.endsAt - this.now());
    if (timeout < 1) return Promise.resolve({ kind: 'failed', reason: 'timeout' });
    const signal = AbortSignal.any([call.signal, this.closing.signal]);
    if (signal.aborted) return Promise.resolve({ kind: 'failed', reason: 'aborted' });
    mkdirSync(this.stateDir, { recursive: true, mode: 0o700 });
    chmodSync(this.stateDir, 0o700);
    return new Promise((resolve) => {
      execFile(
        this.binary,
        [...args],
        {
          env: { ...hostCommandEnvironment(this.env), AGENT_DESKTOP_HOME: this.stateDir },
          signal,
          timeout,
          killSignal: 'SIGKILL',
          maxBuffer: this.outputCapBytes,
          encoding: 'utf8',
          windowsHide: true,
        },
        (error, stdout) => {
          const code = (error as NodeJS.ErrnoException | null)?.code;
          if (code === 'ENOENT' || code === 'EACCES')
            return resolve({ kind: 'failed', reason: 'missing' });
          if (code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
            return resolve({ kind: 'failed', reason: 'oversize' });
          }
          if (signal.aborted) return resolve({ kind: 'failed', reason: 'aborted' });
          if ((error as { killed?: boolean } | null)?.killed) {
            return resolve({ kind: 'failed', reason: 'timeout' });
          }
          try {
            const envelope = JSON.parse(stdout) as AgentDesktopEnvelope;
            if (typeof envelope?.ok === 'boolean') {
              return resolve({ kind: 'envelope', envelope, raw: stdout.trim() });
            }
          } catch {}
          resolve({ kind: 'failed', reason: 'unusable' });
        },
      );
    });
  }

  private failure(
    result: Extract<RunResult, { kind: 'failed' }>,
    ran: number,
    label: string,
  ): Stop {
    const messages = {
      missing: `agent-desktop could not be started at ${this.binary}; install version ${AGENT_DESKTOP_VERSION} there or set CAIRN_AGENT_DESKTOP`,
      timeout: `${label} timed out and agent-desktop was killed`,
      aborted: `${label} was cancelled and agent-desktop was killed`,
      oversize: `${label} produced more output than the ${this.outputCapBytes} byte cap and was killed`,
      unusable: `${label} returned output that is not an agent-desktop JSON envelope`,
    };
    const delivery = result.reason === 'missing' && ran === 0 ? 'not_delivered' : 'unknown';
    return new Stop({ kind: 'error', message: messages[result.reason], delivery });
  }

  private async read(
    args: readonly string[],
    call: ScreenCall,
    budget: { endsAt: number },
  ): Promise<{ ok: true; data: unknown } | { ok: false; raw: string; code: string }> {
    const result = await this.run(args, call, budget);
    if (result.kind === 'failed') throw this.failure(result, 0, `agent-desktop ${args[0]}`);
    return result.envelope.ok
      ? { ok: true, data: result.envelope.data }
      : { ok: false, raw: result.raw, code: result.envelope.error?.code ?? 'INTERNAL' };
  }

  private async target(
    appName: string,
    call: ScreenCall,
    budget: { endsAt: number },
  ): Promise<Target> {
    const listed = await this.read(['list-windows'], call, budget);
    if (!listed.ok) throw refuse(clip(listed.raw, SCREEN_ERROR_MESSAGE_MAX_CHARS));
    const windows = (Array.isArray(listed.data) ? (listed.data as ScreenWindow[]) : []).filter(
      (window) => window?.id && window.app_name,
    );
    const wanted = appName.toLowerCase();
    const matching = windows.filter((window) => window.app_name.toLowerCase() === wanted);
    if (matching.length === 0) {
      const open = [...new Set(windows.map((window) => window.app_name))].slice(0, 12);
      throw refuse(
        open.length > 0
          ? `No open app is named exactly "${appName}". Open apps with windows: ${open.join(', ')}`
          : `No open app is named exactly "${appName}", and no app has a window agent-desktop can see`,
      );
    }
    for (const window of matching) {
      if (await this.isOwnProcess(window.pid)) {
        throw refuse(`${window.app_name} is part of the cairn daemon; it is never driven`);
      }
    }
    const usable = matching.filter(
      (window) => window.accessible !== false && window.visible !== false && !window.minimized,
    );
    const window = usable.find((candidate) => !this.cairnWindows.has(candidate.id)) ?? usable[0];
    if (!window) {
      throw refuse(`${matching[0]?.app_name ?? appName} has no visible, restored window to drive`);
    }
    const title = window.title ?? '';
    if (
      this.cairnWindows.has(window.id) ||
      (isBrowserApp(window.app_name) && showsCairn([title], ['cairn', ...this.hosts]))
    ) {
      throw refuse('This window shows the cairn web app; it is never driven');
    }
    return { app: window.app_name, windowId: window.id, title };
  }

  private async observation(
    target: Target,
    call: ScreenCall,
    budget: { endsAt: number },
    query?: string,
  ): Promise<{ text: string; images: ComputerImage[] }> {
    const scope = ['--window-id', target.windowId, '--timeout-ms', SNAPSHOT_TIMEOUT_MS];
    const read = await this.read(
      query
        ? ['find', ...scope, '--text', query, '--limit', String(FIND_LIMIT)]
        : ['snapshot', ...scope, '--compact', '--max-depth', '40'],
      call,
      budget,
    );
    if (!read.ok) throw refuse(clip(read.raw, SCREEN_ERROR_MESSAGE_MAX_CHARS));
    const data = (read.data ?? {}) as {
      snapshot_id?: string;
      complete?: boolean;
      tree?: AccessibilityNode;
      matches?: AccessibilityNode[];
      truncated?: boolean;
    };
    const snapshotId = typeof data.snapshot_id === 'string' ? data.snapshot_id : '';
    if (snapshotId)
      this.snapshots.set(target.app.toLowerCase(), { id: snapshotId, windowId: target.windowId });
    const roots = data.tree ? [data.tree] : (data.matches ?? []);
    const rows = accessibilityRows(
      roots,
      snapshotId,
      data.complete === false || data.truncated === true,
    );
    if (isBrowserApp(target.app) && showsCairn(rows.strings, ['cairn', ...this.hosts])) {
      this.cairnWindows.add(target.windowId);
      throw refuse('This window shows the cairn web app; it is never driven');
    }
    const shot = await this.screenshot(target, call, budget);
    const header = [
      `app: ${target.app}`,
      ...(target.title ? [`window: ${target.title}`] : []),
      ...(snapshotId ? [`snapshot: ${snapshotId} (element numbers in [] belong to it)`] : []),
      shot.note,
    ];
    const footer = rows.truncated ? '\n[accessibility rows truncated]' : '';
    return {
      text: clip(`${header.join('\n')}\n\n${rows.text}${footer}`, SCREEN_TEXT_MAX_CHARS),
      images: shot.images,
    };
  }

  private async screenshot(
    target: Target,
    call: ScreenCall,
    budget: { endsAt: number },
  ): Promise<{ note: string; images: ComputerImage[] }> {
    const attempts = this.windowCaptureUnsupported
      ? [['screenshot']]
      : [['screenshot', '--window-id', target.windowId], ['screenshot']];
    let last = 'screenshot: unavailable';
    for (const args of attempts) {
      const wholeScreen = args.length === 1;
      let read: Awaited<ReturnType<AgentDesktopHostScreen['read']>>;
      try {
        read = await this.read(args, call, budget);
      } catch (error) {
        if (error instanceof Stop)
          return { note: `screenshot: unavailable (${error.outcome.message})`, images: [] };
        throw error;
      }
      if (!read.ok) {
        last = `screenshot: unavailable (${read.code})`;
        if (read.code === 'PLATFORM_NOT_SUPPORTED' && !wholeScreen) {
          this.windowCaptureUnsupported = true;
          continue;
        }
        break;
      }
      const data = read.data as { data?: string; format?: string } | null;
      if (!data?.data || data.format !== 'png') break;
      const fitted = this.fit(Buffer.from(data.data, 'base64'));
      if (!fitted) {
        return {
          note: 'screenshot: omitted because it could not be reduced under the size cap',
          images: [],
        };
      }
      return {
        note: `screenshot: ${wholeScreen ? 'the whole screen, other windows included' : 'this window'}, ${fitted.width}x${fitted.height}`,
        images: [{ data: fitted.png.toString('base64'), mimeType: 'image/png' }],
      };
    }
    return { note: last, images: [] };
  }

  private fit(png: Buffer): { png: Buffer; width: number; height: number } | undefined {
    for (const edge of SCREEN_IMAGE_EDGES) {
      const fitted = fitPng(png, edge);
      if (!fitted) return undefined;
      if (Math.ceil(fitted.png.length / 3) * 4 <= this.imageMaxBase64Chars) return fitted;
    }
    return undefined;
  }

  private ref(target: Target, element: number): string {
    const snapshot = this.snapshots.get(target.app.toLowerCase());
    if (!snapshot || snapshot.windowId !== target.windowId) {
      throw refuse(`Observe ${target.app} before using element numbers; nothing ran`);
    }
    return `@${snapshot.id}:e${element}`;
  }

  private async step(
    args: readonly string[],
    index: number,
    ran: number,
    action: ScreenAction,
    call: ScreenCall,
    budget: { endsAt: number },
  ): Promise<unknown> {
    const result = await this.run(args, call, budget);
    const label = `Action ${index + 1} (${action.kind})`;
    if (result.kind === 'failed') throw this.failure(result, ran, label);
    if (result.envelope.ok) return result.envelope.data;
    const retry = result.envelope.error?.disposition?.retry;
    const delivery = retry === 'safe' && ran === 0 ? 'not_delivered' : 'unknown';
    const completed = ran > 0 ? ` ${ran} earlier action(s) already ran.` : '';
    throw new Stop({
      kind: 'error',
      message: clip(
        `${label} was refused by agent-desktop.${completed} agent-desktop said: ${result.raw}`,
        SCREEN_ERROR_MESSAGE_MAX_CHARS,
      ),
      delivery,
    });
  }

  private async firstMatch(
    args: readonly string[],
    index: number,
    ran: number,
    action: ScreenAction,
    call: ScreenCall,
    budget: { endsAt: number },
  ): Promise<string | undefined> {
    const data = (await this.step([...args, '--first'], index, ran, action, call, budget)) as {
      match?: { ref_id?: string } | null;
    } | null;
    return data?.match?.ref_id;
  }

  private async perform(
    target: Target,
    action: ScreenAction,
    index: number,
    ran: number,
    call: ScreenCall,
    budget: { endsAt: number },
  ): Promise<void> {
    let extra = 0;
    const go = (...args: string[]) => this.step(args, index, ran + extra, action, call, budget);
    const find = (...args: string[]) =>
      this.firstMatch(args, index, ran + extra, action, call, budget);
    const scope = ['--window-id', target.windowId];
    switch (action.kind) {
      case 'click': {
        if (action.element === undefined) throw refuse(UNPROVEN_RECEIVER);
        const ref = this.ref(target, action.element);
        if (action.double) await go('double-click', '--headed', '--', ref);
        else if (action.button === 'right') await go('right-click', '--', ref);
        else await go('click', '--', ref);
        return;
      }
      case 'type':
        await go('type', '--', this.ref(target, action.element), action.text);
        return;
      case 'set':
        await go('set-value', '--', this.ref(target, action.element), action.value);
        return;
      case 'key': {
        const modifiers = [
          ...new Set((action.modifiers ?? []).map((name) => MODIFIER_NAMES[name])),
        ];
        const key = action.key.length === 1 ? action.key.toLowerCase() : action.key;
        await go('press', '--headed', ...scope, '--', [...modifiers, key].join('+'));
        return;
      }
      case 'scroll': {
        const area =
          action.element !== undefined
            ? this.ref(target, action.element)
            : await find('find', ...scope, '--role', 'scrollarea');
        if (!area) throw refuse(`Nothing in ${target.app} scrolls`);
        await go(
          'scroll',
          '--direction',
          action.direction,
          '--amount',
          String(action.amount ?? 3),
          '--',
          area,
        );
        return;
      }
      case 'menu': {
        const [top, ...items] = action.path;
        let item = await find('find', ...scope, '--role', 'menuitem', `--name=${top}`, '--exact');
        for (const name of items) {
          if (!item) break;
          await go('click', '--', item);
          extra += 1;
          item = await find('find', ...scope, '--surface', 'menu', `--name=${name}`, '--exact');
        }
        if (!item) {
          throw new Stop({
            kind: 'error',
            message: `${target.app} has no menu item ${action.path.join(' > ')}`,
            delivery: ran + extra === 0 ? 'not_delivered' : 'unknown',
          });
        }
        await go('click', '--', item);
        return;
      }
      case 'wait': {
        const remaining = budget.endsAt - this.now();
        if (remaining < action.ms)
          throw refuse('The wait would outlive the call deadline; it did not run');
        await sleep(action.ms, undefined, {
          signal: AbortSignal.any([
            call.signal,
            this.closing.signal,
            AbortSignal.timeout(Math.max(1, Math.ceil(remaining))),
          ]),
        }).catch(() => {
          throw new Stop({
            kind: 'error',
            message: 'The call was cancelled during a wait',
            delivery: 'unknown',
          });
        });
        return;
      }
    }
  }
}
