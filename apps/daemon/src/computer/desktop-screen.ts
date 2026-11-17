import { setTimeout as sleep } from 'node:timers/promises';
import { COMPUTER_IMAGE_MAX_BASE64_CHARS, type ComputerImage } from '@cairn/shared';
import { z } from 'zod';
import {
  SCREEN_COMMAND_TIMEOUT_MS,
  SCREEN_ERROR_MESSAGE_MAX_CHARS,
  SCREEN_IMAGE_EDGES,
  SCREEN_MAX_ACTIONS,
  SCREEN_MAX_WAIT_MS,
  SCREEN_OUTPUT_CAP_BYTES,
  type ScreenCall,
  type ScreenOutcome,
} from './host-screen.js';
import { fitPngUnderCap, pngSize } from './host-screen-png.js';
import { type ComputerProvider, ComputerRefusal } from './provider.js';

export const DESKTOP_SCREENSHOT_SCRIPT =
  'set -o pipefail; xwd -root -silent | xwdtopnm 2>/dev/null | pamdepth 255 2>/dev/null | pnmtopng -force 2>/dev/null | base64 -w0';
export const DESKTOP_SCREENSHOT_PROGRAMS =
  'computer_observe needs xwd (x11-apps) and xwdtopnm and pnmtopng (netpbm) on this computer';
export const DESKTOP_ACT_SETTLE_MS = 300;
const FINAL_FRAME_MARGIN_MS = 5_000;
const MIN_BUDGET_MS = 1_000;
const COMMAND_NOT_FOUND = 127;
const DOUBLE_CLICK_DELAY_MS = '80';
const TYPE_DELAY_MS = '12';

const coordinate = z.number().int().min(0).max(100_000);
const point = { x: coordinate, y: coordinate };
const actionSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('click'),
    ...point,
    button: z.enum(['left', 'right', 'middle']).optional(),
  }),
  z.strictObject({ kind: z.literal('double_click'), ...point }),
  z.strictObject({ kind: z.literal('move'), ...point }),
  z.strictObject({ kind: z.literal('drag'), ...point, to_x: coordinate, to_y: coordinate }),
  z
    .strictObject({
      kind: z.literal('scroll'),
      direction: z.enum(['up', 'down', 'left', 'right']),
      amount: z.number().int().min(1).max(50).optional(),
      x: coordinate.optional(),
      y: coordinate.optional(),
    })
    .refine((action) => (action.x === undefined) === (action.y === undefined)),
  z.strictObject({ kind: z.literal('type'), text: z.string().min(1).max(10_000) }),
  z.strictObject({
    kind: z.literal('key'),
    key: z
      .string()
      .max(64)
      .regex(/^[A-Za-z0-9_]+(\+[A-Za-z0-9_]+)*$/),
  }),
  z.strictObject({ kind: z.literal('wait'), ms: z.number().int().min(1).max(SCREEN_MAX_WAIT_MS) }),
]);
type DesktopAction = z.infer<typeof actionSchema>;
const ACTION_KINDS = ['click', 'double_click', 'move', 'drag', 'scroll', 'type', 'key', 'wait'];
const BUTTONS = { left: '1', middle: '2', right: '3' };
const SCROLL_BUTTONS = { up: '4', down: '5', left: '6', right: '7' };
const actSchema = z.object({ actions: z.array(z.unknown()) });

interface Geometry {
  screenWidth: number;
  screenHeight: number;
  imageWidth: number;
  imageHeight: number;
}

interface Budget {
  endsAt: number;
}

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

class Stop extends Error {
  constructor(readonly outcome: Extract<ScreenOutcome, { kind: 'error' }>) {
    super(outcome.message);
  }
}

function refuse(message: string): Stop {
  return new Stop({ kind: 'error', message, delivery: 'not_delivered' });
}

function clip(text: string): string {
  return text.length <= SCREEN_ERROR_MESSAGE_MAX_CHARS
    ? text
    : text.slice(0, SCREEN_ERROR_MESSAGE_MAX_CHARS);
}

function hasPoint(action: DesktopAction): action is DesktopAction & { x: number; y: number } {
  return 'x' in action && action.x !== undefined;
}

export interface DesktopScreenOptions {
  now?: () => number;
  imageMaxBase64Chars?: number;
  settleMs?: number;
}

export class DesktopScreen {
  private readonly now: () => number;
  private readonly imageMaxBase64Chars: number;
  private readonly settleMs: number;
  private readonly geometry = new Map<string, Geometry>();

  constructor(options: DesktopScreenOptions = {}) {
    this.now = options.now ?? Date.now;
    this.imageMaxBase64Chars = options.imageMaxBase64Chars ?? COMPUTER_IMAGE_MAX_BASE64_CHARS;
    this.settleMs = options.settleMs ?? DESKTOP_ACT_SETTLE_MS;
  }

  async observe(
    provider: ComputerProvider,
    scopeKey: string,
    call: ScreenCall,
  ): Promise<ScreenOutcome> {
    try {
      const shot = await this.screenshot(provider, scopeKey, call, this.budget(call));
      return { kind: 'done', text: shot.text, images: shot.images };
    } catch (error) {
      if (error instanceof Stop) return error.outcome;
      throw error;
    }
  }

  async act(
    provider: ComputerProvider,
    scopeKey: string,
    call: ScreenCall,
  ): Promise<ScreenOutcome> {
    try {
      const actions = this.parse(scopeKey, call.params);
      const budget = this.budget(call);
      const geometry = this.geometry.get(scopeKey);
      const done: string[] = [];
      for (const [index, action] of actions.entries()) {
        await this.perform(provider, action, index, done.length, geometry, call, budget);
        done.push(`${index + 1}. ${action.kind}: delivered`);
      }
      let tail: string;
      let images: ComputerImage[] = [];
      try {
        await sleep(this.settleMs, undefined, { signal: call.signal });
        const shot = await this.screenshot(provider, scopeKey, call, budget);
        tail = shot.text;
        images = shot.images;
      } catch (error) {
        if (!(error instanceof Stop) && !call.signal.aborted) throw error;
        tail = `The actions ran, but the screenshot afterwards failed: ${error instanceof Stop ? error.outcome.message : 'the call was cancelled'}`;
      }
      return { kind: 'done', text: `${done.join('\n')}\n\n${tail}`, images };
    } catch (error) {
      if (error instanceof Stop) return error.outcome;
      throw error;
    }
  }

  private parse(scopeKey: string, params: Record<string, unknown>): DesktopAction[] {
    const parsed = actSchema.safeParse(params);
    if (!parsed.success) throw refuse('computer_act needs an actions list');
    const raw = parsed.data.actions;
    if (raw.length === 0) throw refuse('computer_act needs at least one action');
    if (raw.length > SCREEN_MAX_ACTIONS) {
      throw refuse(
        `At most ${SCREEN_MAX_ACTIONS} actions are allowed per call and ${raw.length} were sent; nothing ran`,
      );
    }
    const geometry = this.geometry.get(scopeKey);
    return raw.map((entry, index) => {
      const action = actionSchema.safeParse(entry);
      if (!action.success) {
        const kind = (entry as { kind?: unknown } | null)?.kind;
        throw refuse(
          typeof kind === 'string' && ACTION_KINDS.includes(kind)
            ? `Action ${index + 1} (${kind}) has invalid arguments; nothing ran`
            : `Action ${index + 1} has an unknown kind; use one of ${ACTION_KINDS.join(', ')}. Nothing ran`,
        );
      }
      if (hasPoint(action.data)) {
        if (!geometry) {
          throw refuse(
            'Call computer_observe first: x and y are pixels in its latest screenshot. Nothing ran',
          );
        }
        const points =
          action.data.kind === 'drag'
            ? [
                [action.data.x, action.data.y],
                [action.data.to_x, action.data.to_y],
              ]
            : [[action.data.x, action.data.y]];
        for (const [x = 0, y = 0] of points) {
          if (x >= geometry.imageWidth || y >= geometry.imageHeight) {
            throw refuse(
              `Action ${index + 1} (${action.data.kind}) is outside the last screenshot (${geometry.imageWidth}x${geometry.imageHeight}); nothing ran`,
            );
          }
        }
      }
      return action.data;
    });
  }

  private budget(call: ScreenCall): Budget {
    const endsAt = call.deadlineAt - FINAL_FRAME_MARGIN_MS;
    if (endsAt - this.now() < MIN_BUDGET_MS) {
      throw refuse('Too little time was left before the call deadline, so nothing ran');
    }
    return { endsAt };
  }

  private async run(
    provider: ComputerProvider,
    argv: readonly string[],
    call: ScreenCall,
    budget: Budget,
    delivered: boolean,
  ): Promise<RunResult> {
    const timeoutMs = Math.min(SCREEN_COMMAND_TIMEOUT_MS, budget.endsAt - this.now());
    if (timeoutMs < 1) {
      throw new Stop({
        kind: 'error',
        message: 'The call deadline passed before the next step could run',
        delivery: delivered ? 'unknown' : 'not_delivered',
      });
    }
    let events: Awaited<ReturnType<ComputerProvider['execute']>>;
    try {
      events = await provider.execute({ argv, timeoutMs, signal: call.signal });
    } catch (error) {
      if (error instanceof ComputerRefusal) {
        throw new Stop({
          kind: 'error',
          message: clip(error.message),
          delivery: delivered ? 'unknown' : error.delivery,
        });
      }
      throw error;
    }
    const stdout: string[] = [];
    const stderr: string[] = [];
    let size = 0;
    let code = 1;
    for await (const event of events) {
      if (event.kind === 'exit') {
        code = event.reason === undefined ? event.code : -1;
        continue;
      }
      size += event.text.length;
      if (size > SCREEN_OUTPUT_CAP_BYTES) {
        throw new Stop({
          kind: 'error',
          message: `The computer produced more than ${SCREEN_OUTPUT_CAP_BYTES} bytes of output`,
          delivery: delivered ? 'unknown' : 'not_delivered',
        });
      }
      (event.kind === 'stdout' ? stdout : stderr).push(event.text);
    }
    return { code, stdout: stdout.join(''), stderr: stderr.join('') };
  }

  private async screenshot(
    provider: ComputerProvider,
    scopeKey: string,
    call: ScreenCall,
    budget: Budget,
  ): Promise<{ text: string; images: ComputerImage[] }> {
    const result = await this.run(
      provider,
      ['bash', '-c', DESKTOP_SCREENSHOT_SCRIPT],
      call,
      budget,
      false,
    );
    if (result.code === COMMAND_NOT_FOUND) throw refuse(DESKTOP_SCREENSHOT_PROGRAMS);
    const png = Buffer.from(result.stdout.trim(), 'base64');
    const size = pngSize(png);
    if (result.code !== 0 || !size) {
      throw refuse(
        clip(`The screenshot failed${result.stderr.trim() ? `: ${result.stderr.trim()}` : ''}`),
      );
    }
    const fitted = fitPngUnderCap(png, SCREEN_IMAGE_EDGES, this.imageMaxBase64Chars);
    if (!fitted) throw refuse('The screenshot could not be reduced under the size cap');
    this.geometry.set(scopeKey, {
      screenWidth: size.width,
      screenHeight: size.height,
      imageWidth: fitted.width,
      imageHeight: fitted.height,
    });
    return {
      text: `screen ${size.width}x${size.height}, image ${fitted.width}x${fitted.height}; computer_act x and y are pixels in this image`,
      images: [{ data: fitted.png.toString('base64'), mimeType: 'image/png' }],
    };
  }

  private screenPoint(geometry: Geometry | undefined, x: number, y: number): [string, string] {
    if (!geometry) return [String(x), String(y)];
    const scale = (value: number, image: number, screen: number) =>
      String(Math.min(screen - 1, Math.round((value * screen) / image)));
    return [
      scale(x, geometry.imageWidth, geometry.screenWidth),
      scale(y, geometry.imageHeight, geometry.screenHeight),
    ];
  }

  private xdotool(
    action: Exclude<DesktopAction, { kind: 'wait' }>,
    geometry: Geometry | undefined,
  ): string[] {
    const at = (x: number, y: number) => ['mousemove', ...this.screenPoint(geometry, x, y)];
    switch (action.kind) {
      case 'click':
        return [...at(action.x, action.y), 'click', BUTTONS[action.button ?? 'left']];
      case 'double_click':
        return [
          ...at(action.x, action.y),
          'click',
          '--repeat',
          '2',
          '--delay',
          DOUBLE_CLICK_DELAY_MS,
          BUTTONS.left,
        ];
      case 'move':
        return at(action.x, action.y);
      case 'drag':
        return [
          ...at(action.x, action.y),
          'mousedown',
          BUTTONS.left,
          ...at(action.to_x, action.to_y),
          'mouseup',
          BUTTONS.left,
        ];
      case 'scroll':
        return [
          ...(action.x !== undefined && action.y !== undefined ? at(action.x, action.y) : []),
          'click',
          '--repeat',
          String(action.amount ?? 3),
          SCROLL_BUTTONS[action.direction],
        ];
      case 'type':
        return ['type', '--delay', TYPE_DELAY_MS, '--', action.text];
      case 'key':
        return ['key', '--clearmodifiers', '--', action.key];
    }
  }

  private async perform(
    provider: ComputerProvider,
    action: DesktopAction,
    index: number,
    ran: number,
    geometry: Geometry | undefined,
    call: ScreenCall,
    budget: Budget,
  ): Promise<void> {
    const label = `Action ${index + 1} (${action.kind})`;
    const earlier = ran > 0 ? ` ${ran} earlier action(s) already ran.` : '';
    if (action.kind === 'wait') {
      if (budget.endsAt - this.now() < action.ms) {
        throw new Stop({
          kind: 'error',
          message: `${label} would outlive the call deadline; it did not run.${earlier}`,
          delivery: ran > 0 ? 'unknown' : 'not_delivered',
        });
      }
      await sleep(action.ms, undefined, { signal: call.signal }).catch(() => {
        throw new Stop({
          kind: 'error',
          message: 'The call was cancelled during a wait',
          delivery: 'unknown',
        });
      });
      return;
    }
    const args = this.xdotool(action, geometry);
    const result = await this.run(provider, ['xdotool', ...args], call, budget, ran > 0);
    if (result.code === 0) return;
    if (result.code === COMMAND_NOT_FOUND) {
      throw new Stop({
        kind: 'error',
        message: `${label} needs xdotool on this computer.${earlier}`,
        delivery: ran > 0 ? 'unknown' : 'not_delivered',
      });
    }
    throw new Stop({
      kind: 'error',
      message: clip(
        `${label} failed and may have partly run.${earlier}${result.stderr.trim() ? ` xdotool said: ${result.stderr.trim()}` : ''}`,
      ),
      delivery: 'unknown',
    });
  }
}
