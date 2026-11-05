import type { Socket } from 'node:net';
import { z } from 'zod';
import { ORB_MAX_FRAME_BYTES, ORB_RPC_PREFIX, orbReleaseKeySchema } from '../orb/protocol.js';

export const ORB_COMPUTER_SOCKET = 'computer.sock';
export const ORB_COMPUTER_AUTH_LINE_MAX_BYTES = 1024;

export const orbComputerRequestSchema = z.discriminatedUnion('method', [
  z.object({
    id: z.number().int().nonnegative(),
    method: z.literal('execute'),
    params: z.object({
      argv: z.array(z.string()).min(1).max(64),
      cwd: z.string().max(4096).optional(),
      timeoutMs: z.number().int().positive(),
    }),
  }),
  z.object({
    id: z.number().int().nonnegative(),
    method: z.literal('listFiles'),
    params: z.object({ path: z.string().max(4096) }),
  }),
  z.object({
    id: z.number().int().nonnegative(),
    method: z.literal('readFile'),
    params: z.object({ path: z.string().max(4096) }),
  }),
  z.object({
    id: z.number().int().nonnegative(),
    method: z.literal('writeFile'),
    params: z.object({ path: z.string().max(4096), content: z.string() }),
  }),
]);
export type OrbComputerRequest = z.infer<typeof orbComputerRequestSchema>;

export const orbComputerHostFrameSchema = z.union([
  orbComputerRequestSchema,
  z.object({ cancel: z.number().int().nonnegative() }).strict(),
  z.object({ type: z.literal('authenticated') }).strict(),
  z.object({ type: z.literal('refused'), reason: z.literal('stale-release') }).strict(),
]);
export type OrbComputerHostFrame = z.infer<typeof orbComputerHostFrameSchema>;

export const orbComputerAuthSchema = z
  .object({
    type: z.literal('auth'),
    token: z.string().regex(/^[a-f0-9]{64}$/),
    release: orbReleaseKeySchema,
  })
  .strict();

export const orbComputerGuestFrameSchema = z.union([
  z.object({ id: z.number().int().nonnegative(), value: z.unknown() }).strict(),
  z.object({ id: z.number().int().nonnegative(), done: z.literal(true) }).strict(),
  z
    .object({
      id: z.number().int().nonnegative(),
      error: z.string().max(4096),
      refusal: z.literal(true).optional(),
    })
    .strict(),
  z.object({ heartbeat: z.literal(true) }).strict(),
]);
export type OrbComputerGuestFrame = z.infer<typeof orbComputerGuestFrameSchema>;

export const orbComputerEventSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.enum(['stdout', 'stderr']), text: z.string() }),
  z.object({
    kind: z.literal('exit'),
    code: z.number().int(),
    reason: z.enum(['timeout', 'aborted']).optional(),
  }),
]);

export const orbComputerFileEntriesSchema = z.array(
  z.object({
    path: z.string(),
    kind: z.enum(['file', 'dir']),
    size: z.number(),
    executable: z.literal(true).optional(),
  }),
);

export function encodeOrbComputerFrame(frame: unknown): string {
  return `${ORB_RPC_PREFIX}${JSON.stringify(frame)}\n`;
}

export function decodeOrbComputerFrame(line: string): unknown {
  if (!line.startsWith(ORB_RPC_PREFIX)) return undefined;
  try {
    return JSON.parse(line.slice(ORB_RPC_PREFIX.length));
  } catch {
    return undefined;
  }
}

export function writeOrbComputerFrame(socket: Socket, frame: unknown): boolean {
  if (socket.destroyed || socket.writableEnded) return false;
  const data = encodeOrbComputerFrame(frame);
  if (socket.writableLength + Buffer.byteLength(data) > ORB_MAX_FRAME_BYTES) {
    socket.destroy();
    return false;
  }
  socket.write(data);
  return true;
}

export function frameFits(frame: unknown): boolean {
  return Buffer.byteLength(encodeOrbComputerFrame(frame)) <= ORB_MAX_FRAME_BYTES;
}

export function readOrbComputerLines(
  socket: Socket,
  onLine: (line: string) => void,
  limit: () => number = () => ORB_MAX_FRAME_BYTES,
): void {
  socket.setEncoding('utf8');
  let pending = '';
  socket.on('data', (chunk: string) => {
    pending += chunk;
    let newline = pending.indexOf('\n');
    while (newline >= 0 && !socket.destroyed) {
      const line = pending.slice(0, newline);
      pending = pending.slice(newline + 1);
      if (line.length > limit()) {
        socket.destroy();
        return;
      }
      onLine(line);
      newline = pending.indexOf('\n');
    }
    if (pending.length > limit()) socket.destroy();
  });
}
