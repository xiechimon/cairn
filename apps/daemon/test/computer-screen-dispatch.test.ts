import { type ComputerCall, type ComputerFrame, computerFrameSchema } from '@cairn/shared';
import { describe, expect, test, vi } from 'vitest';
import { createComputerDispatcher } from '../src/computer/dispatch.js';
import type { HostScreen, ScreenOutcome } from '../src/computer/host-screen.js';

const call = (tool: ComputerCall['tool']): ComputerCall => ({
  callId: 'a'.repeat(64),
  stepId: 'screen-step',
  tool,
  params: { app: 'nautilus' },
  deadlineAt: Date.now() + 60_000,
});

const finished: ScreenOutcome = { kind: 'done', text: 'observed', images: [] };

function setup(screen?: HostScreen, cancelled = false) {
  const frames: ComputerFrame[] = [];
  const dispatcher = createComputerDispatcher({
    client: {
      computerFrames: async (_id, body) => {
        frames.push(...body.frames);
        return { ok: true, cancelled };
      },
    },
    screen,
    heartbeatMs: 10,
  });
  return { dispatcher, frames };
}

const screen = (): HostScreen => ({
  observe: vi.fn(async () => finished),
  act: vi.fn(async () => finished),
  killAll: vi.fn(async () => {}),
});

describe('screen dispatch', () => {
  test.each(['user_computer_observe', 'user_computer_act'] as const)(
    'routes %s and posts a valid final frame',
    async (tool) => {
      const provider = screen();
      const { dispatcher, frames } = setup(provider);
      await dispatcher.dispatch(call(tool));
      expect(tool === 'user_computer_act' ? provider.act : provider.observe).toHaveBeenCalledOnce();
      expect(frames.at(-1)).toMatchObject({ kind: 'done', text: 'observed' });
      expect(frames.every((frame) => computerFrameSchema.safeParse(frame).success)).toBe(true);
      await dispatcher.close();
    },
  );

  test('refuses screen tools without a screen provider', async () => {
    const { dispatcher, frames } = setup();
    await dispatcher.dispatch(call('user_computer_observe'));
    expect(frames.at(-1)).toMatchObject({ kind: 'error', delivery: 'not_delivered' });
    await dispatcher.close();
  });

  test('does not repeat an unsafe action with the same call ID', async () => {
    const provider = screen();
    const { dispatcher } = setup(provider);
    const action = call('user_computer_act');
    await dispatcher.dispatch(action);
    await dispatcher.dispatch(action);
    expect(provider.act).toHaveBeenCalledOnce();
    await dispatcher.close();
  });

  test('server cancellation aborts a pending screen call', async () => {
    const provider = screen();
    provider.act = async (request) =>
      new Promise((resolve) => {
        request.signal.addEventListener(
          'abort',
          () => resolve({ kind: 'error', message: 'cancelled', delivery: 'unknown' }),
          { once: true },
        );
      });
    const { dispatcher, frames } = setup(provider, true);
    await dispatcher.dispatch(call('user_computer_act'));
    expect(frames.at(-1)).toMatchObject({
      kind: 'error',
      message: 'cancelled',
      delivery: 'unknown',
    });
    await dispatcher.close();
  });

  test('shutdown aborts the call and closes its provider', async () => {
    const provider = screen();
    let entered: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    provider.act = async (request) =>
      new Promise((resolve) => {
        request.signal.addEventListener(
          'abort',
          () => resolve({ kind: 'error', message: 'shutdown', delivery: 'unknown' }),
          { once: true },
        );
        entered?.();
      });
    const { dispatcher, frames } = setup(provider);
    const pending = dispatcher.dispatch(call('user_computer_act'));
    await started;
    await dispatcher.close();
    await pending;
    expect(provider.killAll).toHaveBeenCalledOnce();
    expect(frames.at(-1)).toMatchObject({
      kind: 'error',
      message: 'shutdown',
      delivery: 'unknown',
    });
  });
});
