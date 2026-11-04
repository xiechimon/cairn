import type { ComputerCall } from '@cairn/shared';
import { z } from 'zod';
import type { DaemonLogger } from '../log.js';
import type { MachineApi } from '../machine-client.js';
import { FramePoster } from './frame-poster.js';
import { desktopProtectionGuardMessage, protectedComputerLifecycleRefusal } from './guard.js';
import { type ComputerProcessEvent, type ComputerProvider, ComputerRefusal } from './provider.js';

export const NO_COMPUTER_PROVIDER_MESSAGE = 'This machine has no computer provider';

export const COMPUTER_COMMAND_TIMEOUT_MS = 5 * 60_000;
export const COMPUTER_OUTPUT_CAP_CHARS = 2 * 1024 * 1024;
export const COMPUTER_FLUSH_MS = 250;
export const COMPUTER_HEARTBEAT_MS = 10_000;
const FINAL_FRAME_MARGIN_MS = 5_000;
const MIN_COMMAND_TIMEOUT_MS = 1_000;
const REMEMBERED_CALLS = 4096;
const CLOSE_WAIT_MS = 3_000;

const shellParams = z.object({
  command: z.string().min(1).max(100_000),
  cwd: z.string().max(4096).optional(),
});

type ComputerClient = Pick<MachineApi, 'computerFrames'>;

export async function rejectComputerCall(
  client: ComputerClient,
  call: ComputerCall,
  message: string = NO_COMPUTER_PROVIDER_MESSAGE,
): Promise<void> {
  await client.computerFrames?.(call.callId, {
    frames: [{ kind: 'error', seq: 1, message, delivery: 'not_delivered' }],
  });
}

export interface ComputerDispatcherOptions {
  client: ComputerClient;
  host?: ComputerProvider;
  logger?: Pick<DaemonLogger, 'machine'>;
  now?: () => number;
  flushMs?: number;
  heartbeatMs?: number;
  commandTimeoutMs?: number;
  outputCapChars?: number;
  retryBaseMs?: number;
  retryMaxMs?: number;
}

export interface ComputerDispatcher {
  dispatch(call: ComputerCall): Promise<void>;
  close(): Promise<void>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createComputerDispatcher(options: ComputerDispatcherOptions): ComputerDispatcher {
  const now = options.now ?? Date.now;
  const inFlight = new Map<string, { controller: AbortController; settled: Promise<void> }>();
  const seen = new Set<string>();
  let closing = false;

  function remember(callId: string): void {
    seen.add(callId);
    if (seen.size > REMEMBERED_CALLS) {
      const oldest = seen.values().next().value;
      if (oldest !== undefined) seen.delete(oldest);
    }
  }

  function posterFor(call: ComputerCall, controller: AbortController): FramePoster {
    return new FramePoster({
      client: options.client,
      callId: call.callId,
      deadlineAt: call.deadlineAt,
      flushMs: options.flushMs ?? COMPUTER_FLUSH_MS,
      heartbeatMs: options.heartbeatMs ?? COMPUTER_HEARTBEAT_MS,
      outputCapChars: options.outputCapChars ?? COMPUTER_OUTPUT_CAP_CHARS,
      retryBaseMs: options.retryBaseMs ?? 500,
      retryMaxMs: options.retryMaxMs ?? 5_000,
      now,
      onStop: (reason) => controller.abort(reason),
    });
  }

  async function refuse(call: ComputerCall, message: string): Promise<void> {
    const poster = posterFor(call, new AbortController());
    await poster.finish({ kind: 'error', message, delivery: 'not_delivered' });
  }

  async function runShell(
    call: ComputerCall,
    host: ComputerProvider,
    params: z.infer<typeof shellParams>,
    timeoutMs: number,
    controller: AbortController,
  ): Promise<void> {
    const poster = posterFor(call, controller);
    let events: AsyncIterable<ComputerProcessEvent>;
    try {
      events = await host.execute({
        argv: ['bash', '-lc', params.command],
        ...(params.cwd !== undefined ? { cwd: params.cwd } : {}),
        timeoutMs,
        signal: controller.signal,
      });
    } catch (error) {
      const message =
        error instanceof ComputerRefusal ? error.message : 'The command could not be started';
      await poster.finish({ kind: 'error', message, delivery: 'not_delivered' });
      return;
    }
    let exit: Extract<ComputerProcessEvent, { kind: 'exit' }> | undefined;
    try {
      for await (const event of events) {
        if (event.kind === 'exit') exit = event;
        else poster.output(event.kind, event.text);
      }
    } catch {
      await poster.finish({
        kind: 'error',
        message: 'The command failed after it started',
        delivery: 'unknown',
      });
      return;
    }
    if (poster.abandoned) return;
    const reason = controller.signal.reason;
    if (controller.signal.aborted) {
      const message =
        reason === 'shutdown'
          ? 'The daemon shut down while the command ran; its process tree was killed'
          : 'The call was cancelled and its process tree was killed';
      await poster.finish({ kind: 'error', message, delivery: 'unknown' });
    } else if (exit?.reason === 'timeout') {
      await poster.finish({
        kind: 'error',
        message: `Command timed out after ${timeoutMs} ms and its process tree was killed`,
        delivery: 'unknown',
      });
    } else {
      const code = exit?.code ?? null;
      await poster.finish({
        kind: 'done',
        text: `exit code: ${code ?? 'unknown'}`,
        exitCode: code,
      });
    }
  }

  async function handle(call: ComputerCall, controller: AbortController): Promise<void> {
    const host = options.host;
    if (call.tool !== 'user_computer_shell' || !host) {
      await refuse(call, NO_COMPUTER_PROVIDER_MESSAGE);
      return;
    }
    const params = shellParams.safeParse(call.params);
    if (!params.success) {
      await refuse(call, 'The shell call needs a non-empty command and an optional cwd string');
      return;
    }
    const remaining = call.deadlineAt - now();
    if (remaining <= 0) {
      await refuse(call, 'The call deadline had already passed, so nothing ran');
      return;
    }
    const refusal = protectedComputerLifecycleRefusal(params.data.command);
    if (refusal !== undefined) {
      await refuse(call, desktopProtectionGuardMessage(refusal));
      return;
    }
    const timeoutMs = Math.min(
      options.commandTimeoutMs ?? COMPUTER_COMMAND_TIMEOUT_MS,
      Math.max(MIN_COMMAND_TIMEOUT_MS, remaining - FINAL_FRAME_MARGIN_MS),
    );
    await runShell(call, host, params.data, timeoutMs, controller);
  }

  return {
    async dispatch(call) {
      if (closing || inFlight.has(call.callId) || seen.has(call.callId)) return;
      remember(call.callId);
      const controller = new AbortController();
      const settled = handle(call, controller)
        .catch((error: unknown) => {
          options.logger?.machine(
            `computer call ${call.callId.slice(0, 8)} failed: ${error instanceof Error ? error.name : 'error'}`,
          );
        })
        .finally(() => inFlight.delete(call.callId));
      inFlight.set(call.callId, { controller, settled });
      await settled;
    },
    async close() {
      closing = true;
      const running = [...inFlight.values()];
      for (const { controller } of running) controller.abort('shutdown');
      await options.host?.killAll();
      await Promise.race([
        Promise.allSettled(running.map(({ settled }) => settled)),
        sleep(CLOSE_WAIT_MS),
      ]);
    },
  };
}
