import { existsSync } from 'node:fs';
import { createConnection } from 'node:net';
import { basename, dirname } from 'node:path';
import { ORB_MAX_FRAME_BYTES } from '../orb/protocol.js';
import { readOrbFile } from '../orb/runtime-fs.js';
import {
  decodeOrbComputerFrame,
  frameFits,
  type OrbComputerGuestFrame,
  type OrbComputerRequest,
  orbComputerHostFrameSchema,
  readOrbComputerLines,
  writeOrbComputerFrame,
} from './orb-protocol.js';
import { type ComputerProvider, ComputerRefusal } from './provider.js';

export const ORB_COMPUTER_HEARTBEAT_MS = 10_000;
const AUTH_TIMEOUT_MS = 10_000;
const POLL_MS = 100;
const ERROR_MESSAGE_MAX_CHARS = 500;
export const ORB_COMPUTER_OUTPUT_CAP_CHARS = 4 * 1024 * 1024;
const OUTPUT_TRUNCATED_NOTE = '[output truncated by the computer agent]\n';

export type OrbComputerAgentExit = 'closed' | 'stale-release';

export interface OrbComputerAgentOptions {
  socketPath: string;
  release: string;
  provider: ComputerProvider;
  heartbeatMs?: number;
  authTimeoutMs?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : 'the computer agent failed';
  return text.slice(0, ERROR_MESSAGE_MAX_CHARS);
}

export async function runOrbComputerAgent(
  options: OrbComputerAgentOptions,
): Promise<OrbComputerAgentExit> {
  const tokenName = `${basename(options.socketPath)}.token`;
  while (!existsSync(options.socketPath) || !existsSync(`${options.socketPath}.token`)) {
    await sleep(POLL_MS);
  }
  const token = readOrbFile(dirname(options.socketPath), tokenName, 64).toString('utf8');
  const socket = createConnection(options.socketPath);
  socket.on('error', () => {});
  const controllers = new Map<number, AbortController>();
  let authenticated = false;

  const send = (frame: OrbComputerGuestFrame): void => {
    writeOrbComputerFrame(socket, frame);
  };
  const reply = (frame: OrbComputerGuestFrame & { id: number }): void => {
    if (frameFits(frame)) send(frame);
    else
      send({
        id: frame.id,
        error: 'The result is too large for the computer transport',
        refusal: true,
      });
  };

  async function serve(request: OrbComputerRequest, signal: AbortSignal): Promise<void> {
    const { provider } = options;
    if (request.method === 'execute') {
      const events = await provider.execute({
        argv: request.params.argv,
        ...(request.params.cwd !== undefined ? { cwd: request.params.cwd } : {}),
        timeoutMs: request.params.timeoutMs,
        signal,
      });
      let forwarded = 0;
      for await (const event of events) {
        if (event.kind !== 'exit') {
          if (forwarded > ORB_COMPUTER_OUTPUT_CAP_CHARS) continue;
          forwarded += event.text.length;
          if (forwarded > ORB_COMPUTER_OUTPUT_CAP_CHARS) {
            reply({ id: request.id, value: { kind: 'stderr', text: OUTPUT_TRUNCATED_NOTE } });
            continue;
          }
        }
        reply({ id: request.id, value: event });
      }
    } else if (request.method === 'listFiles') {
      reply({ id: request.id, value: await provider.listFiles(request.params.path) });
    } else if (request.method === 'readFile') {
      reply({ id: request.id, value: await provider.readFile(request.params.path) });
    } else {
      await provider.writeFile(request.params.path, request.params.content);
      reply({ id: request.id, value: null });
    }
  }

  function start(request: OrbComputerRequest): void {
    const controller = new AbortController();
    controllers.set(request.id, controller);
    serve(request, controller.signal)
      .then(() => send({ id: request.id, done: true }))
      .catch((error: unknown) =>
        send({
          id: request.id,
          error: errorMessage(error),
          ...(error instanceof ComputerRefusal ? { refusal: true as const } : {}),
        }),
      )
      .finally(() => controllers.delete(request.id));
  }

  return new Promise<OrbComputerAgentExit>((resolve, reject) => {
    let exit: OrbComputerAgentExit = 'closed';
    const heartbeat = setInterval(
      () => send({ heartbeat: true }),
      options.heartbeatMs ?? ORB_COMPUTER_HEARTBEAT_MS,
    );
    const authTimer = setTimeout(
      () => socket.destroy(new Error('computer agent authentication timed out')),
      options.authTimeoutMs ?? AUTH_TIMEOUT_MS,
    );
    socket.once('connect', () =>
      writeOrbComputerFrame(socket, { type: 'auth', token, release: options.release }),
    );
    readOrbComputerLines(
      socket,
      (line) => {
        const parsed = orbComputerHostFrameSchema.safeParse(decodeOrbComputerFrame(line));
        if (!parsed.success) {
          socket.destroy();
          return;
        }
        const frame = parsed.data;
        if ('type' in frame) {
          if (frame.type === 'authenticated') {
            authenticated = true;
            clearTimeout(authTimer);
          } else exit = 'stale-release';
        } else if (!authenticated) socket.destroy();
        else if ('cancel' in frame) controllers.get(frame.cancel)?.abort();
        else if (!controllers.has(frame.id)) start(frame);
      },
      () => ORB_MAX_FRAME_BYTES,
    );
    socket.once('close', () => {
      clearInterval(heartbeat);
      clearTimeout(authTimer);
      for (const controller of controllers.values()) controller.abort();
      options.provider
        .killAll()
        .then(
          () =>
            authenticated || exit === 'stale-release'
              ? resolve(exit)
              : reject(new Error('computer agent was not authenticated')),
          reject,
        );
    });
  });
}
