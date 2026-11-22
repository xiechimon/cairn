import type { Readable, Writable } from 'node:stream';
import {
  agentTokenUsageSchema,
  mcpEndpointSchema,
  providerConfigSchema,
  remoteToolDefSchema,
  stepEventSchema,
} from '@cairn/shared';
import { z } from 'zod';

export const PI_HOST_PROTOCOL_VERSION = 1;
export const PI_HOST_MAX_FRAME_BYTES = 32 * 1024 * 1024;
export const PI_HOST_MAX_QUEUED_FRAMES = 1024;

const LOG_CHANNELS = ['mcp', 'skills', 'gate', 'trust', 'otel', 'compaction'] as const;
export type PiHostLogChannel = (typeof LOG_CHANNELS)[number];

const deliveredImageSchema = z.object({ data: z.string(), mimeType: z.string() });

const localToolDefSchema = z.object({
  name: z.string(),
  label: z.string().optional(),
  description: z.string(),
  parameters: z.unknown().optional(),
});

const sessionSchema = z.object({
  cwd: z.string(),
  provider: providerConfigSchema,
  modelId: z.string(),
  compactAt: z.number().int().positive().optional(),
  thinkingLevel: z.string().optional(),
  systemPrompt: z.string().optional(),
  remoteTools: z.array(remoteToolDefSchema).optional(),
  localTools: z.array(localToolDefSchema).optional(),
  mcpServers: z.array(mcpEndpointSchema).optional(),
  skillsAllowlist: z.array(z.string()).optional(),
  injectedSkills: z.array(z.string()).optional(),
  teamSkillsDir: z.string().optional(),
  readOnly: z.boolean().optional(),
  remoteToolsOnly: z.boolean().optional(),
  env: z.record(z.string(), z.string()).optional(),
  secrets: z.array(z.string()).optional(),
  telemetry: z
    .object({
      traceId: z.string(),
      stepSpanId: z.string(),
      tracesUrl: z.string(),
      headers: z.record(z.string(), z.string()),
      environment: z.string().optional(),
    })
    .optional(),
  prompt: z.string().optional(),
  promptImages: z.array(deliveredImageSchema).optional(),
});
export type PiHostSession = z.infer<typeof sessionSchema>;

const toolKind = z.enum(['remote', 'local']);

export const parentFrameSchema = z.discriminatedUnion('t', [
  z.object({
    t: z.literal('initialize'),
    v: z.literal(PI_HOST_PROTOCOL_VERSION),
    agentDir: z.string(),
    sessionDir: z.string(),
    skills: z.object({ skillsDir: z.string(), cwd: z.string() }).optional(),
    machineName: z.string().optional(),
    resumeFile: z.string().nullable(),
    session: sessionSchema,
  }),
  z.object({
    t: z.literal('steer'),
    id: z.string(),
    text: z.string(),
    images: z.array(deliveredImageSchema).optional(),
  }),
  z.object({
    t: z.literal('tool_reply'),
    id: z.string(),
    ok: z.boolean(),
    text: z.string().optional(),
    error: z.string().optional(),
  }),
  z.object({ t: z.literal('stop') }),
]);
export type ParentFrame = z.infer<typeof parentFrameSchema>;

export const childFrameSchema = z.discriminatedUnion('t', [
  z.object({
    t: z.literal('ready'),
    v: z.literal(PI_HOST_PROTOCOL_VERSION),
    sessionId: z.string(),
    sessionFile: z.string().optional(),
  }),
  z.object({ t: z.literal('event'), event: stepEventSchema }),
  z.object({ t: z.literal('usage'), usage: agentTokenUsageSchema }),
  z.object({ t: z.literal('log'), channel: z.enum(LOG_CHANNELS), message: z.string() }),
  z.object({
    t: z.literal('tool_request'),
    id: z.string(),
    kind: toolKind,
    name: z.string(),
    params: z.record(z.string(), z.unknown()),
  }),
  z.object({
    t: z.literal('steer_reply'),
    id: z.string(),
    ok: z.boolean(),
    error: z.string().optional(),
  }),
  z.object({ t: z.literal('ended') }),
  z.object({ t: z.literal('fatal'), message: z.string() }),
]);
export type ChildFrame = z.infer<typeof childFrameSchema>;

export class PiHostProtocolError extends Error {}

export function encodeFrame(frame: ParentFrame | ChildFrame): string {
  const line = `${JSON.stringify(frame)}\n`;
  if (Buffer.byteLength(line) > PI_HOST_MAX_FRAME_BYTES)
    throw new PiHostProtocolError('pi host frame exceeds the size limit');
  return line;
}

export function parseFrame<T>(line: string, schema: z.ZodType<T>): T {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    throw new PiHostProtocolError('pi host frame is not JSON');
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new PiHostProtocolError('pi host frame is invalid');
  return value as T;
}

export function readFrames(
  input: Readable,
  onLine: (line: string) => void,
  onEnd: (error: PiHostProtocolError | null) => void,
): void {
  let pending = Buffer.alloc(0);
  let finished = false;
  const finish = (error: PiHostProtocolError | null) => {
    if (finished) return;
    finished = true;
    onEnd(error);
  };
  input.on('data', (data: Buffer | string) => {
    if (finished) return;
    pending = Buffer.concat([pending, typeof data === 'string' ? Buffer.from(data) : data]);
    for (;;) {
      const newline = pending.indexOf(0x0a);
      if (newline === -1) break;
      const line = pending.subarray(0, newline).toString('utf8');
      pending = pending.subarray(newline + 1);
      if (line.trim() === '') continue;
      try {
        onLine(line);
      } catch (error) {
        finish(
          error instanceof PiHostProtocolError
            ? error
            : new PiHostProtocolError('pi host frame handler failed'),
        );
        return;
      }
    }
    if (pending.length > PI_HOST_MAX_FRAME_BYTES) {
      pending = Buffer.alloc(0);
      finish(new PiHostProtocolError('pi host frame exceeds the size limit'));
    }
  });
  input.on('end', () => finish(null));
  input.on('close', () => finish(null));
  input.on('error', () => finish(new PiHostProtocolError('pi host pipe failed')));
}

export class FrameWriter {
  private queue: string[] = [];
  private draining = false;
  private broken = false;

  constructor(
    private readonly output: Writable,
    private readonly write: (chunk: string) => boolean,
    private readonly onFailure: (error: PiHostProtocolError) => void,
  ) {
    output.on('error', () => this.fail('pi host pipe failed'));
  }

  send(frame: ParentFrame | ChildFrame): void {
    if (this.broken) return;
    let line: string;
    try {
      line = encodeFrame(frame);
    } catch (error) {
      this.fail(error instanceof Error ? error.message : 'pi host frame could not be encoded');
      return;
    }
    if (this.draining) {
      if (this.queue.length >= PI_HOST_MAX_QUEUED_FRAMES) {
        this.fail('pi host frame queue overflow');
        return;
      }
      this.queue.push(line);
      return;
    }
    this.flush(line);
  }

  private flush(first: string): void {
    let line: string | undefined = first;
    while (line !== undefined) {
      if (!this.write(line)) {
        this.draining = true;
        this.output.once('drain', () => {
          this.draining = false;
          const next = this.queue.shift();
          if (next !== undefined) this.flush(next);
        });
        return;
      }
      line = this.queue.shift();
    }
  }

  private fail(message: string): void {
    if (this.broken) return;
    this.broken = true;
    this.queue = [];
    this.onFailure(new PiHostProtocolError(message));
  }
}
