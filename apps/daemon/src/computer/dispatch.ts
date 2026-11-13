import {
  COMPUTER_FRAME_TEXT_MAX_CHARS,
  COMPUTER_REPLAY_SAFE_TOOLS,
  type ComputerCall,
  type ComputerTool,
} from '@cairn/shared';
import { z } from 'zod';
import type { DaemonLogger } from '../log.js';
import type { MachineApi } from '../machine-client.js';
import { type BrowserToolName, type BrowserToolResult, runBrowserTool } from './browser.js';
import { FramePoster } from './frame-poster.js';
import {
  desktopProtectionGuardMessage,
  orbComputerProtectionRefusal,
  protectedComputerLifecycleRefusal,
} from './guard.js';
import type { HostScreen } from './host-screen.js';
import {
  type ComputerFileEntry,
  type ComputerFileOptions,
  type ComputerProcessEvent,
  type ComputerProvider,
  ComputerRefusal,
  type ScopedComputerProviders,
} from './provider.js';

export const NO_COMPUTER_PROVIDER_MESSAGE = 'This machine has no computer provider';
export const NO_COMPUTER_SCOPE_MESSAGE = 'The call names no computer';
export const FILE_TRUNCATED_MARKER = '\n[file truncated]';
export const BROWSER_TRUNCATED_MARKER = '\n[browser output truncated]';
export const COMPUTER_FRAME_ERROR_MAX_CHARS = 4096;

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

const pathParams = z.object({ path: z.string().max(4096) });
const listParams = z.object({ path: z.string().max(4096).optional() });
const writeParams = z.object({ path: z.string().max(4096), content: z.string() });

const ORB_TOOLS: ReadonlySet<ComputerTool> = new Set([
  'shell',
  'list_files',
  'read_file',
  'write_file',
  'browser_navigate',
  'browser_snapshot',
  'browser_act',
]);

const BROWSER_TOOLS: ReadonlySet<ComputerTool> = new Set([
  'browser_navigate',
  'browser_snapshot',
  'browser_act',
]);

interface Route {
  provider: ComputerProvider;
  guard: (command: string) => string | undefined;
}

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
  screen?: HostScreen;
  orb?: ScopedComputerProviders;
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

function listingText(entries: ComputerFileEntry[]): string {
  const lines: string[] = [];
  let length = 0;
  for (const entry of entries) {
    const line = `${entry.kind}\t${entry.size}\t${entry.path}${entry.executable ? '\t*' : ''}\n`;
    if (length + line.length > COMPUTER_FRAME_TEXT_MAX_CHARS - 64) {
      lines.push(`[${entries.length - lines.length} more entries not shown]\n`);
      break;
    }
    lines.push(line);
    length += line.length;
  }
  return lines.join('');
}

export function createComputerDispatcher(options: ComputerDispatcherOptions): ComputerDispatcher {
  const now = options.now ?? Date.now;
  const inFlight = new Map<string, { controller: AbortController; settled: Promise<void> }>();
  const finishedUnsafe = new Set<string>();
  let closing = false;
  const postingLifetime = new AbortController();

  function remember(callId: string): void {
    finishedUnsafe.add(callId);
    if (finishedUnsafe.size > REMEMBERED_CALLS) {
      const oldest = finishedUnsafe.values().next().value;
      if (oldest !== undefined) finishedUnsafe.delete(oldest);
    }
  }

  async function handleScreen(
    call: ComputerCall,
    screen: HostScreen,
    controller: AbortController,
  ): Promise<void> {
    if (call.deadlineAt - now() <= FINAL_FRAME_MARGIN_MS) {
      await refuse(call, 'Too little time was left before the call deadline, so nothing ran');
      return;
    }
    const poster = posterFor(call, controller);
    const request = { params: call.params, deadlineAt: call.deadlineAt, signal: controller.signal };
    let outcome: Awaited<ReturnType<HostScreen['act']>>;
    try {
      outcome = await (call.tool === 'user_computer_act'
        ? screen.act(request)
        : screen.observe(request));
    } catch {
      await poster.finish({
        kind: 'error',
        message: 'Screen control failed unexpectedly',
        delivery: 'unknown',
      });
      return;
    }
    if (poster.abandoned) return;
    await poster.finish(
      outcome.kind === 'done'
        ? {
            kind: 'done',
            text: outcome.text,
            ...(outcome.images.length > 0 ? { images: outcome.images } : {}),
          }
        : outcome,
    );
  }

  function routeFor(call: ComputerCall): Route | string {
    if (call.tool === 'user_computer_shell') {
      return options.host
        ? { provider: options.host, guard: protectedComputerLifecycleRefusal }
        : NO_COMPUTER_PROVIDER_MESSAGE;
    }
    if (!ORB_TOOLS.has(call.tool) || !options.orb) return NO_COMPUTER_PROVIDER_MESSAGE;
    if (!call.scopeKey) return NO_COMPUTER_SCOPE_MESSAGE;
    return {
      provider: options.orb.forScope(call.scopeKey),
      guard: orbComputerProtectionRefusal,
    };
  }

  function posterFor(call: ComputerCall, controller: AbortController): FramePoster {
    return new FramePoster({
      client: options.client,
      callId: call.callId,
      signal: postingLifetime.signal,
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
    executionDeadline: number,
    controller: AbortController,
  ): Promise<void> {
    const poster = posterFor(call, controller);
    let events: AsyncIterable<ComputerProcessEvent>;
    const setupTimer = setTimeout(
      () => controller.abort('timeout'),
      Math.max(0, executionDeadline - now()),
    );
    setupTimer.unref();
    try {
      try {
        events = await host.execute({
          argv: ['bash', '-lc', params.command],
          ...(params.cwd !== undefined ? { cwd: params.cwd } : {}),
          timeoutMs,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(setupTimer);
      }
    } catch (error) {
      const message = controller.signal.aborted
        ? controller.signal.reason === 'timeout'
          ? 'The command timed out before it could be started'
          : 'The command was cancelled before it could be started'
        : error instanceof ComputerRefusal
          ? error.message
          : 'The command could not be started';
      await poster.finish({ kind: 'error', message, delivery: 'not_delivered' });
      return;
    }
    let exit: Extract<ComputerProcessEvent, { kind: 'exit' }> | undefined;
    try {
      for await (const event of events) {
        if (event.kind === 'exit') exit = event;
        else poster.output(event.kind, event.text);
      }
    } catch (error) {
      if (error instanceof ComputerRefusal) {
        await poster.finish({ kind: 'error', message: error.message, delivery: 'not_delivered' });
        return;
      }
      await poster.finish({
        kind: 'error',
        message: 'The command failed after it started',
        delivery: 'unknown',
      });
      return;
    }
    if (poster.abandoned) return;
    const reason = controller.signal.reason;
    if (exit?.delivery === 'not_delivered') {
      await poster.finish({
        kind: 'error',
        message:
          exit.reason === 'timeout'
            ? 'The command timed out before it could be started'
            : 'The command was cancelled before it could be started',
        delivery: 'not_delivered',
      });
    } else if (reason === 'timeout' || exit?.reason === 'timeout') {
      await poster.finish({
        kind: 'error',
        message: `Command timed out after ${timeoutMs} ms and its process tree was killed`,
        delivery: 'unknown',
      });
    } else if (controller.signal.aborted) {
      const message =
        reason === 'shutdown'
          ? 'The daemon shut down while the command ran; its process tree was killed'
          : 'The call was cancelled and its process tree was killed';
      await poster.finish({ kind: 'error', message, delivery: 'unknown' });
    } else {
      const code = exit?.code ?? null;
      await poster.finish({
        kind: 'done',
        text: `exit code: ${code ?? 'unknown'}`,
        exitCode: code,
      });
    }
  }

  async function handleShell(
    call: ComputerCall,
    route: Route,
    controller: AbortController,
  ): Promise<void> {
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
    const refusal = route.guard(params.data.command);
    if (refusal !== undefined) {
      await refuse(call, desktopProtectionGuardMessage(refusal));
      return;
    }
    const startedAt = now();
    const executionDeadline = Math.min(
      startedAt + (options.commandTimeoutMs ?? COMPUTER_COMMAND_TIMEOUT_MS),
      call.deadlineAt - FINAL_FRAME_MARGIN_MS,
    );
    const timeoutMs = Math.max(0, executionDeadline - startedAt);
    if (call.deadlineAt - FINAL_FRAME_MARGIN_MS - startedAt < MIN_COMMAND_TIMEOUT_MS) {
      await refuse(call, 'Too little time was left before the call deadline, so nothing ran');
      return;
    }
    await runShell(call, route.provider, params.data, timeoutMs, executionDeadline, controller);
  }

  async function fileText(
    call: ComputerCall,
    provider: ComputerProvider,
    file: ComputerFileOptions,
  ): Promise<string> {
    if (call.tool === 'list_files') {
      const params = listParams.parse(call.params);
      return listingText(await provider.listFiles(params.path ?? '', file));
    }
    if (call.tool === 'read_file') {
      const content = await provider.readFile(pathParams.parse(call.params).path, file);
      if (content.length <= COMPUTER_FRAME_TEXT_MAX_CHARS) return content;
      return (
        content.slice(0, COMPUTER_FRAME_TEXT_MAX_CHARS - FILE_TRUNCATED_MARKER.length) +
        FILE_TRUNCATED_MARKER
      );
    }
    const params = writeParams.parse(call.params);
    await provider.writeFile(params.path, params.content, file);
    return `wrote ${Buffer.byteLength(params.content)} bytes`;
  }

  async function handleFile(
    call: ComputerCall,
    route: Route,
    controller: AbortController,
  ): Promise<void> {
    const parsed = {
      list_files: listParams,
      read_file: pathParams,
      write_file: writeParams,
    }[call.tool as 'list_files' | 'read_file' | 'write_file'].safeParse(call.params);
    if (!parsed.success) {
      await refuse(call, `The ${call.tool} call has invalid arguments, so nothing ran`);
      return;
    }
    if (call.deadlineAt - now() <= FINAL_FRAME_MARGIN_MS) {
      await refuse(call, 'Too little time was left before the call deadline, so nothing ran');
      return;
    }
    const poster = posterFor(call, controller);
    let text: string;
    try {
      text = await fileText(call, route.provider, {
        timeoutMs: call.deadlineAt - now() - FINAL_FRAME_MARGIN_MS,
        signal: controller.signal,
      });
    } catch (error) {
      await poster.finish(
        error instanceof ComputerRefusal
          ? { kind: 'error', message: error.message, delivery: 'not_delivered' }
          : {
              kind: 'error',
              message: 'The file operation failed',
              delivery: 'unknown',
            },
      );
      return;
    }
    await poster.finish({ kind: 'done', text });
  }

  function boundBrowserText(text: string): string {
    if (text.length <= COMPUTER_FRAME_TEXT_MAX_CHARS) return text;
    return (
      text.slice(0, COMPUTER_FRAME_TEXT_MAX_CHARS - BROWSER_TRUNCATED_MARKER.length) +
      BROWSER_TRUNCATED_MARKER
    );
  }

  function boundBrowserError(message: string): string {
    if (message.length <= COMPUTER_FRAME_ERROR_MAX_CHARS) return message;
    return (
      message.slice(0, COMPUTER_FRAME_ERROR_MAX_CHARS - BROWSER_TRUNCATED_MARKER.length) +
      BROWSER_TRUNCATED_MARKER
    );
  }

  async function handleBrowser(
    call: ComputerCall,
    route: Route,
    controller: AbortController,
  ): Promise<void> {
    if (call.deadlineAt - now() <= FINAL_FRAME_MARGIN_MS) {
      await refuse(call, 'Too little time was left before the call deadline, so nothing ran');
      return;
    }
    const poster = posterFor(call, controller);
    let result: BrowserToolResult;
    try {
      result = await runBrowserTool(route.provider, call.tool as BrowserToolName, call.params, {
        deadlineAt: call.deadlineAt - FINAL_FRAME_MARGIN_MS,
        now,
        signal: controller.signal,
        session: call.scopeKey,
      });
    } catch (error) {
      await poster.finish(
        error instanceof ComputerRefusal
          ? {
              kind: 'error',
              message: boundBrowserError(error.message),
              delivery: error.delivery,
            }
          : {
              kind: 'error',
              message: 'The browser operation failed',
              delivery: 'unknown',
            },
      );
      return;
    }
    if (poster.abandoned) return;
    await poster.finish({
      kind: 'done',
      text: boundBrowserText(result.text),
      ...(result.loginForm ? { loginForm: result.loginForm } : {}),
    });
  }

  async function handle(call: ComputerCall, controller: AbortController): Promise<void> {
    if (call.tool === 'user_computer_observe' || call.tool === 'user_computer_act') {
      if (options.screen) await handleScreen(call, options.screen, controller);
      else await refuse(call, NO_COMPUTER_PROVIDER_MESSAGE);
      return;
    }
    const route = routeFor(call);
    if (typeof route === 'string') {
      await refuse(call, route);
      return;
    }
    if (call.tool === 'shell' || call.tool === 'user_computer_shell') {
      await handleShell(call, route, controller);
    } else if (BROWSER_TOOLS.has(call.tool)) {
      await handleBrowser(call, route, controller);
    } else {
      await handleFile(call, route, controller);
    }
  }

  return {
    async dispatch(call) {
      if (closing || inFlight.has(call.callId) || finishedUnsafe.has(call.callId)) return;
      if (!COMPUTER_REPLAY_SAFE_TOOLS.has(call.tool)) remember(call.callId);
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
      let deadlineTimer: NodeJS.Timeout | undefined;
      try {
        for (const { controller } of running) controller.abort('shutdown');
        await Promise.all([
          options.host?.killAll(),
          options.screen?.killAll(),
          options.orb?.killAll(),
        ]);
        await Promise.race([
          Promise.allSettled(running.map(({ settled }) => settled)),
          new Promise<void>((resolve) => {
            deadlineTimer = setTimeout(resolve, CLOSE_WAIT_MS);
          }),
        ]);
      } finally {
        clearTimeout(deadlineTimer);
        postingLifetime.abort();
      }
    },
  };
}
