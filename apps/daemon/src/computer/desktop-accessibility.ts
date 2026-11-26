import { setTimeout as sleep } from 'node:timers/promises';
import { z } from 'zod';
import {
  SCREEN_ERROR_MESSAGE_MAX_CHARS,
  SCREEN_MAX_ACTIONS,
  SCREEN_MAX_WAIT_MS,
  SCREEN_OUTPUT_CAP_BYTES,
  SCREEN_TEXT_MAX_CHARS,
  type ScreenCall,
  type ScreenOutcome,
} from './host-screen.js';
import { type AccessibilityNode, accessibilityRows } from './host-screen-rows.js';
import { originHosts, showsCairn } from './host-screen-self.js';
import { type ComputerProvider, ComputerRefusal } from './provider.js';
import { refuseScreen, ScreenStop } from './screen-stop.js';

export const AGENT_DESKTOP_BINARY = 'agent-desktop';
export const DESKTOP_NOT_INSTALLED =
  'agent-desktop is not installed on this computer; update Cairn on this computer';
const COMMAND_NOT_FOUND = 127;
const COMMAND_TIMEOUT_MS = 30_000;
const FINAL_FRAME_MARGIN_MS = 5_000;
const MIN_BUDGET_MS = 1_000;
const SNAPSHOT_TIMEOUT_MS = '8000';
const FIND_LIMIT = 50;
const READ_MAX_CHARS = 4_000;
const WINDOW_NOT_FOUND = 'WINDOW_NOT_FOUND';
const ACTION_NOT_SUPPORTED = 'ACTION_NOT_SUPPORTED';
const CAIRN_WINDOW_REFUSAL = 'This window shows the cairn web app; it is never driven';
const MODIFIER_NAMES = { cmd: 'ctrl', ctrl: 'ctrl', alt: 'alt', option: 'alt', shift: 'shift' };

const elementNumber = z.number().int().min(1).max(100_000);
const actionSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('click'),
    element: elementNumber,
    double: z.boolean().optional(),
    button: z.enum(['left', 'right']).optional(),
  }),
  z.strictObject({ kind: z.literal('type'), element: elementNumber, text: z.string().max(10_000) }),
  z.strictObject({ kind: z.literal('set'), element: elementNumber, value: z.string().max(10_000) }),
  z.strictObject({
    kind: z.literal('key'),
    key: z.string().min(1).max(32),
    modifiers: z
      .array(z.enum(['cmd', 'ctrl', 'alt', 'option', 'shift']))
      .max(4)
      .optional(),
  }),
  z.strictObject({
    kind: z.literal('read'),
    element: elementNumber,
    property: z.enum(['value', 'text']).optional(),
  }),
  z.strictObject({ kind: z.literal('wait'), ms: z.number().int().min(1).max(SCREEN_MAX_WAIT_MS) }),
]);
type DesktopUiAction = z.infer<typeof actionSchema>;
const ACTION_KINDS = ['click', 'type', 'set', 'key', 'read', 'wait'];

const appSchema = z.string().trim().min(1).max(100);
const snapshotSchema = z.object({
  app: appSchema.optional(),
  query: z.string().trim().min(1).max(200).optional(),
});
const actSchema = z.object({ app: appSchema, actions: z.array(z.unknown()) });

interface Envelope {
  ok: boolean;
  data?: unknown;
  error?: { code?: string; disposition?: { retry?: string } };
}

interface UiWindow {
  id: string;
  title?: string;
  app_name: string;
  accessible?: boolean;
  minimized?: boolean;
  visible?: boolean;
  is_focused?: boolean;
}

interface Target {
  app: string;
  windowId: string;
  title: string;
  windowCount: number;
}

interface Budget {
  endsAt: number;
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max);
}

export interface DesktopAccessibilityOptions {
  now?: () => number;
  cairnOrigins?: readonly string[];
}

export class DesktopAccessibility {
  private readonly now: () => number;
  private readonly hosts: string[];
  private readonly snapshots = new Map<string, { id: string; title: string }>();
  private readonly cairnWindows = new Set<string>();

  constructor(options: DesktopAccessibilityOptions = {}) {
    this.now = options.now ?? Date.now;
    this.hosts = originHosts(options.cairnOrigins ?? []);
  }

  async snapshot(
    provider: ComputerProvider,
    scopeKey: string,
    call: ScreenCall,
  ): Promise<ScreenOutcome> {
    try {
      const parsed = snapshotSchema.safeParse(call.params);
      if (!parsed.success) {
        throw refuseScreen(
          'desktop_snapshot takes an optional app name and an optional query string',
        );
      }
      const budget = this.budget(call);
      const run = new Runner(provider, call, budget, this.now);
      if (parsed.data.app === undefined) {
        return { kind: 'done', text: this.appList(await this.windows(run)), images: [] };
      }
      const target = await this.target(run, parsed.data.app);
      return {
        kind: 'done',
        text: await this.observation(run, scopeKey, target, parsed.data.query),
        images: [],
      };
    } catch (error) {
      if (error instanceof ScreenStop) return error.outcome;
      throw error;
    }
  }

  async act(
    provider: ComputerProvider,
    scopeKey: string,
    call: ScreenCall,
  ): Promise<ScreenOutcome> {
    try {
      const parsed = actSchema.safeParse(call.params);
      if (!parsed.success) throw refuseScreen('desktop_act needs an app name and an actions list');
      const { app, actions: rawActions } = parsed.data;
      if (rawActions.length === 0) throw refuseScreen('desktop_act needs at least one action');
      if (rawActions.length > SCREEN_MAX_ACTIONS) {
        throw refuseScreen(
          `At most ${SCREEN_MAX_ACTIONS} actions are allowed per call and ${rawActions.length} were sent; nothing ran`,
        );
      }
      const actions = rawActions.map((raw, index) => {
        const action = actionSchema.safeParse(raw);
        if (action.success) return action.data;
        const kind = (raw as { kind?: unknown } | null)?.kind;
        throw refuseScreen(
          typeof kind === 'string' && ACTION_KINDS.includes(kind)
            ? `Action ${index + 1} (${kind}) has invalid arguments; nothing ran`
            : `Action ${index + 1} has an unknown kind; use one of ${ACTION_KINDS.join(', ')}. Nothing ran`,
        );
      });
      const budget = this.budget(call);
      const run = new Runner(provider, call, budget, this.now);
      const target = await this.target(
        run,
        app,
        this.snapshots.get(`${scopeKey}\0${app.toLowerCase()}`)?.title,
      );
      for (const action of actions) if ('element' in action) this.ref(scopeKey, target, action);
      const done: string[] = [];
      for (const [index, action] of actions.entries()) {
        try {
          await this.assertNotCairn(run, target);
          done.push(await this.perform(run, scopeKey, target, action, index, done.length));
        } catch (error) {
          if (error instanceof ScreenStop && done.length > 0) {
            throw new ScreenStop({ ...error.outcome, delivery: 'unknown' });
          }
          throw error;
        }
      }
      let tail: string;
      try {
        tail = await this.observation(run, scopeKey, target);
      } catch (error) {
        if (!(error instanceof ScreenStop)) throw error;
        tail = `The actions ran, but looking at ${target.app} afterwards failed: ${error.outcome.message}`;
      }
      return {
        kind: 'done',
        text: clip(`${done.join('\n')}\n\n${tail}`, SCREEN_TEXT_MAX_CHARS),
        images: [],
      };
    } catch (error) {
      if (error instanceof ScreenStop) return error.outcome;
      throw error;
    }
  }

  private budget(call: ScreenCall): Budget {
    const endsAt = call.deadlineAt - FINAL_FRAME_MARGIN_MS;
    if (endsAt - this.now() < MIN_BUDGET_MS) {
      throw refuseScreen('Too little time was left before the call deadline, so nothing ran');
    }
    return { endsAt };
  }

  private async windows(run: Runner): Promise<UiWindow[]> {
    const listed = await run.read(['list-windows']);
    return (Array.isArray(listed) ? (listed as UiWindow[]) : []).filter(
      (window) => window?.id && window.app_name,
    );
  }

  private appList(windows: readonly UiWindow[]): string {
    if (windows.length === 0) {
      return 'No app has a window the accessibility tree can see. Start one from the shell tool (for example `nohup chromium https://example.com >/dev/null 2>&1 &`, which runs with the desktop session environment) or click a dock launcher with computer_act, then call desktop_snapshot again. Use computer_observe for a screenshot.';
    }
    const lines = windows.map(
      (window) => `- ${window.app_name}${window.title ? `: ${JSON.stringify(window.title)}` : ''}`,
    );
    return `Open apps with windows; call desktop_snapshot with one of these app names:\n${lines.join('\n')}`;
  }

  private async target(run: Runner, appName: string, preferTitle?: string): Promise<Target> {
    const windows = await this.windows(run);
    const wanted = appName.toLowerCase();
    const matching = windows.filter((window) => window.app_name.toLowerCase() === wanted);
    if (matching.length === 0) {
      const open = [...new Set(windows.map((window) => window.app_name))].slice(0, 12);
      throw refuseScreen(
        open.length > 0
          ? `No open app is named exactly "${appName}". Open apps with windows: ${open.join(', ')}`
          : `No open app is named exactly "${appName}", and no app has a window the accessibility tree can see; start the app from the shell tool or a dock launcher first`,
      );
    }
    const usable = matching.filter(
      (window) => window.accessible !== false && window.visible !== false && !window.minimized,
    );
    const window =
      usable.find(
        (candidate) => candidate.title === preferTitle && !this.cairnWindows.has(candidate.id),
      ) ??
      usable.find((candidate) => !this.cairnWindows.has(candidate.id)) ??
      usable[0];
    if (!window)
      throw refuseScreen(`${matching[0]?.app_name ?? appName} has no visible window to drive`);
    const title = window.title ?? '';
    if (
      this.cairnWindows.has(window.id) ||
      window.app_name.toLowerCase().includes('cairn') ||
      showsCairn([title], ['cairn', ...this.hosts])
    ) {
      this.cairnWindows.add(window.id);
      throw refuseScreen(CAIRN_WINDOW_REFUSAL);
    }
    return { app: window.app_name, windowId: window.id, title, windowCount: usable.length };
  }

  private async relocate(run: Runner, target: Target): Promise<UiWindow> {
    const wanted = target.app.toLowerCase();
    const usable = (await this.windows(run)).filter(
      (window) =>
        window.app_name.toLowerCase() === wanted &&
        window.accessible !== false &&
        window.visible !== false &&
        !window.minimized,
    );
    const window =
      usable.find((candidate) => candidate.id === target.windowId) ??
      usable.find((candidate) => (candidate.title ?? '') === target.title) ??
      (usable.length === 1 ? usable[0] : undefined);
    if (!window) {
      throw refuseScreen(
        `The ${target.app} window${target.title ? ` "${target.title}"` : ''} is gone or changed; call desktop_snapshot for ${target.app} again. Nothing ran`,
      );
    }
    if (this.cairnWindows.has(window.id)) throw refuseScreen(CAIRN_WINDOW_REFUSAL);
    target.windowId = window.id;
    return window;
  }

  private async onWindow<T>(
    run: Runner,
    target: Target,
    command: (windowId: string) => string[],
    send: (args: string[]) => Promise<T>,
  ): Promise<T> {
    try {
      return await send(command(target.windowId));
    } catch (error) {
      if (!(error instanceof ScreenStop) || error.code !== WINDOW_NOT_FOUND) throw error;
      await this.relocate(run, target);
      return send(command(target.windowId));
    }
  }

  private async focusWindow(
    run: Runner,
    target: Target,
    label: string,
    ran: number,
  ): Promise<void> {
    if ((await this.relocate(run, target)).is_focused === true) return;
    await this.onWindow(
      run,
      target,
      (windowId) => ['focus-window', '--headed', '--window-id', windowId],
      (args) => run.step(args, label, ran),
    );
    if ((await this.relocate(run, target)).is_focused !== true) {
      throw new ScreenStop({
        kind: 'error',
        message: `${label} was not sent: ${target.app} did not come to the front, so input would have gone to another window. Nothing was typed`,
        delivery: ran > 0 ? 'unknown' : 'not_delivered',
      });
    }
  }

  private async assertNotCairn(run: Runner, target: Target): Promise<void> {
    const data = (await this.onWindow(
      run,
      target,
      (windowId) => [
        'snapshot',
        '--window-id',
        windowId,
        '--timeout-ms',
        SNAPSHOT_TIMEOUT_MS,
        '--compact',
        '--max-depth',
        '40',
      ],
      (args) => run.read(args),
    )) as { tree?: AccessibilityNode } | null;
    const rows = accessibilityRows(data?.tree ? [data.tree] : [], '', false);
    if (showsCairn(rows.strings, ['cairn', ...this.hosts])) {
      this.cairnWindows.add(target.windowId);
      throw refuseScreen(CAIRN_WINDOW_REFUSAL);
    }
  }

  private async observation(
    run: Runner,
    scopeKey: string,
    target: Target,
    query?: string,
  ): Promise<string> {
    const data = ((await this.onWindow(
      run,
      target,
      (windowId) => {
        const scope = ['--window-id', windowId, '--timeout-ms', SNAPSHOT_TIMEOUT_MS];
        return query
          ? ['find', ...scope, '--text', query, '--limit', String(FIND_LIMIT)]
          : ['snapshot', ...scope, '--compact', '--max-depth', '40'];
      },
      (args) => run.read(args),
    )) ?? {}) as {
      snapshot_id?: string;
      complete?: boolean;
      tree?: AccessibilityNode;
      matches?: AccessibilityNode[];
      truncated?: boolean;
    };
    const snapshotId = typeof data.snapshot_id === 'string' ? data.snapshot_id : '';
    if (snapshotId) {
      this.snapshots.set(`${scopeKey}\0${target.app.toLowerCase()}`, {
        id: snapshotId,
        title: target.title,
      });
    }
    const rows = accessibilityRows(
      data.tree ? [data.tree] : (data.matches ?? []),
      snapshotId,
      data.complete === false || data.truncated === true,
    );
    if (showsCairn(rows.strings, ['cairn', ...this.hosts])) {
      this.cairnWindows.add(target.windowId);
      throw refuseScreen(CAIRN_WINDOW_REFUSAL);
    }
    const header = [
      `app: ${target.app}`,
      ...(target.title ? [`window: ${target.title}`] : []),
      ...(snapshotId ? [`snapshot: ${snapshotId} (element numbers in [] belong to it)`] : []),
    ];
    const footer = rows.truncated ? '\n[accessibility rows truncated]' : '';
    return clip(`${header.join('\n')}\n\n${rows.text}${footer}`, SCREEN_TEXT_MAX_CHARS);
  }

  private ref(
    scopeKey: string,
    target: Target,
    action: Extract<DesktopUiAction, { element: number }>,
  ): string {
    const snapshot = this.snapshots.get(`${scopeKey}\0${target.app.toLowerCase()}`);
    if (!snapshot) {
      throw refuseScreen(
        `Call desktop_snapshot for ${target.app} before using element numbers; nothing ran`,
      );
    }
    if (snapshot.title !== target.title && target.windowCount > 1) {
      throw refuseScreen(
        `${target.app} has several windows and the one snapshotted ("${snapshot.title}") is no longer there; call desktop_snapshot for ${target.app} again; nothing ran`,
      );
    }
    return `@${snapshot.id}:e${action.element}`;
  }

  private async perform(
    run: Runner,
    scopeKey: string,
    target: Target,
    action: DesktopUiAction,
    index: number,
    ran: number,
  ): Promise<string> {
    const label = `Action ${index + 1} (${action.kind})`;
    const go = (...args: string[]) =>
      run.step(args, label, ran).catch((error: unknown) => {
        if (error instanceof ScreenStop && error.code === WINDOW_NOT_FOUND) {
          throw new ScreenStop(
            {
              kind: 'error',
              message: `${label}: agent-desktop no longer finds the window these element numbers belong to; call desktop_snapshot for ${target.app} again and use its new numbers`,
              delivery: ran > 0 ? 'unknown' : 'not_delivered',
            },
            WINDOW_NOT_FOUND,
          );
        }
        throw error;
      });
    const delivered = `${index + 1}. ${action.kind}: delivered`;
    switch (action.kind) {
      case 'click': {
        const ref = this.ref(scopeKey, target, action);
        if (action.double) await go('double-click', '--headed', '--', ref);
        else if (action.button === 'right') await go('right-click', '--', ref);
        else await go('click', '--', ref);
        return delivered;
      }
      case 'type':
        await this.focusWindow(run, target, label, ran);
        await go('type', '--headed', '--', this.ref(scopeKey, target, action), action.text);
        return delivered;
      case 'set': {
        const ref = this.ref(scopeKey, target, action);
        try {
          await go('set-value', '--', ref, action.value);
          return delivered;
        } catch (error) {
          if (!(error instanceof ScreenStop) || error.code !== ACTION_NOT_SUPPORTED) throw error;
        }
        await this.focusWindow(run, target, label, ran);
        await go('focus', '--headed', '--', ref);
        await this.onWindow(
          run,
          target,
          (windowId) => ['press', '--headed', '--window-id', windowId, '--', 'ctrl+a'],
          (args) => run.step(args, label, ran),
        );
        await go('type', '--headed', '--', ref, action.value);
        return `${index + 1}. set: delivered by typing (this field has no set-value)`;
      }
      case 'key': {
        const modifiers = [
          ...new Set((action.modifiers ?? []).map((name) => MODIFIER_NAMES[name])),
        ];
        const key = action.key.length === 1 ? action.key.toLowerCase() : action.key;
        await this.focusWindow(run, target, label, ran);
        await this.onWindow(
          run,
          target,
          (windowId) => [
            'press',
            '--headed',
            '--window-id',
            windowId,
            '--',
            [...modifiers, key].join('+'),
          ],
          (args) => run.step(args, label, ran),
        );
        return delivered;
      }
      case 'read': {
        const data = (await go(
          'get',
          '--property',
          action.property ?? 'value',
          '--',
          this.ref(scopeKey, target, action),
        )) as { value?: unknown } | null;
        const value =
          typeof data?.value === 'string' ? data.value : JSON.stringify(data?.value ?? null);
        return `${index + 1}. read: ${JSON.stringify(clip(value, READ_MAX_CHARS))}`;
      }
      case 'wait': {
        const remaining = run.endsAt - this.now();
        if (remaining < action.ms) {
          throw new ScreenStop({
            kind: 'error',
            message: `${label} would outlive the call deadline; it did not run`,
            delivery: ran > 0 ? 'unknown' : 'not_delivered',
          });
        }
        await sleep(action.ms, undefined, { signal: run.signal }).catch(() => {
          throw new ScreenStop({
            kind: 'error',
            message: 'The call was cancelled during a wait',
            delivery: 'unknown',
          });
        });
        return delivered;
      }
    }
  }
}

class Runner {
  constructor(
    private readonly provider: ComputerProvider,
    private readonly call: ScreenCall,
    private readonly budget: Budget,
    private readonly now: () => number,
  ) {}

  get endsAt(): number {
    return this.budget.endsAt;
  }

  get signal(): AbortSignal {
    return this.call.signal;
  }

  async read(args: readonly string[]): Promise<unknown> {
    const envelope = await this.execute(args, `agent-desktop ${args[0]}`, 0);
    if (!envelope.ok) {
      throw new ScreenStop(
        {
          kind: 'error',
          message: clip(JSON.stringify(envelope.error), SCREEN_ERROR_MESSAGE_MAX_CHARS),
          delivery: 'not_delivered',
        },
        envelope.error?.code,
      );
    }
    return envelope.data;
  }

  async step(args: readonly string[], label: string, ran: number): Promise<unknown> {
    const envelope = await this.execute(args, label, ran);
    if (envelope.ok) return envelope.data;
    const retry = envelope.error?.disposition?.retry;
    const completed = ran > 0 ? ` ${ran} earlier action(s) already ran.` : '';
    throw new ScreenStop(
      {
        kind: 'error',
        message: clip(
          `${label} was refused by agent-desktop.${completed} agent-desktop said: ${JSON.stringify(envelope.error)}`,
          SCREEN_ERROR_MESSAGE_MAX_CHARS,
        ),
        delivery: retry === 'safe' && ran === 0 ? 'not_delivered' : 'unknown',
      },
      envelope.error?.code,
    );
  }

  private async execute(args: readonly string[], label: string, ran: number): Promise<Envelope> {
    const timeoutMs = Math.min(COMMAND_TIMEOUT_MS, this.budget.endsAt - this.now());
    const delivery = ran > 0 ? 'unknown' : 'not_delivered';
    if (timeoutMs < 1) {
      throw new ScreenStop({
        kind: 'error',
        message: 'The call deadline passed before the next step could run',
        delivery,
      });
    }
    let events: Awaited<ReturnType<ComputerProvider['execute']>>;
    try {
      events = await this.provider.execute({
        argv: [AGENT_DESKTOP_BINARY, ...args],
        timeoutMs,
        signal: this.call.signal,
      });
    } catch (error) {
      if (error instanceof ComputerRefusal) {
        throw new ScreenStop({
          kind: 'error',
          message: clip(error.message, SCREEN_ERROR_MESSAGE_MAX_CHARS),
          delivery: ran > 0 ? 'unknown' : error.delivery,
        });
      }
      throw error;
    }
    let stdout = '';
    let size = 0;
    let code = 1;
    let stopped = false;
    for await (const event of events) {
      if (event.kind === 'exit') {
        code = event.code;
        stopped = event.reason !== undefined;
        continue;
      }
      size += event.text.length;
      if (size > SCREEN_OUTPUT_CAP_BYTES) {
        throw new ScreenStop({
          kind: 'error',
          message: `${label} produced more output than the ${SCREEN_OUTPUT_CAP_BYTES} byte cap`,
          delivery,
        });
      }
      if (event.kind === 'stdout') stdout += event.text;
    }
    if (code === COMMAND_NOT_FOUND)
      throw new ScreenStop({ kind: 'error', message: DESKTOP_NOT_INSTALLED, delivery });
    if (stopped) {
      throw new ScreenStop({
        kind: 'error',
        message: `${label} timed out or was cancelled and agent-desktop was killed`,
        delivery: 'unknown',
      });
    }
    try {
      const envelope = JSON.parse(stdout) as Envelope;
      if (typeof envelope?.ok === 'boolean') return envelope;
    } catch {}
    throw new ScreenStop({
      kind: 'error',
      message: `${label} returned output that is not an agent-desktop JSON envelope`,
      delivery: ran > 0 ? 'unknown' : delivery,
    });
  }
}
