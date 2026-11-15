import { z } from 'zod';
import { askUserAnswerSchema } from '../records/message.js';
import { deviceNameSchema } from '../remote-access.js';

export const RELAY_FRAME_BYTES = 65_536;
export const RELAY_PAYLOAD_BYTES = 60 * 1024;
const encoder = new TextEncoder();
const uuid = z.uuid().regex(/^[0-9a-f-]+$/);
const recordId = z.string().min(1).max(128);
const positiveInteger = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const digest = z.string().regex(/^[0-9a-f]{64}$/);
const code = z.string().regex(/^[A-Za-z0-9_-]{32}$/);
const byteString = (max: number) =>
  z.string().refine((value) => encoder.encode(value).byteLength <= max);
const payloadFits = (value: unknown) =>
  encoder.encode(JSON.stringify(value)).byteLength <= RELAY_PAYLOAD_BYTES;

export const relayPairBodySchema = z.strictObject({ code, name: deviceNameSchema });
export const relayDescriptorSchema = z.strictObject({
  v: z.literal(1),
  installationId: uuid,
  environmentId: uuid,
});

const answer = askUserAnswerSchema
  .safeExtend({
    header: byteString(4096),
    choices: z.array(byteString(4096).min(1)).min(1).max(10).optional(),
    text: byteString(4096).optional(),
  })
  .strict();

export const relayRequestSchema = z
  .discriminatedUnion('op', [
    z.strictObject({ op: z.literal('projects.list') }),
    z.strictObject({
      op: z.literal('coordinator.read'),
      limit: z.number().int().min(1).max(20),
      before: recordId.optional(),
    }),
    z.strictObject({
      op: z.literal('coordinator.send'),
      projectId: recordId,
      content: byteString(8192).min(1),
      clientMessageId: uuid,
    }),
    z.strictObject({ op: z.literal('coordinator.watch') }),
    z.strictObject({ op: z.literal('coordinator.stop') }),
    z.strictObject({
      op: z.literal('coordinator.answer'),
      requestId: recordId,
      answers: z.array(answer).min(1).max(10),
    }),
    z.strictObject({ op: z.literal('coordinator.cancel'), requestId: recordId }),
  ])
  .refine(payloadFits);
export type RelayRequest = z.infer<typeof relayRequestSchema>;

export const relaySuccessSchemas = {
  'projects.list': z.strictObject({
    projects: z.array(z.strictObject({ id: recordId, name: z.string() })).max(50),
    hasMore: z.boolean(),
  }),
  'coordinator.read': z.strictObject({
    threadId: recordId,
    messages: z
      .array(
        z.strictObject({
          id: recordId,
          role: z.enum(['system', 'user', 'assistant']),
          content: z.string(),
          createdAt: positiveInteger,
          projectId: recordId.nullable(),
        }),
      )
      .max(20),
    hasEarlier: z.boolean(),
  }),
  'coordinator.send': z.strictObject({
    threadId: recordId,
    messageId: recordId,
    replayed: z.boolean(),
  }),
  'coordinator.watch': z.strictObject({ watching: z.literal(true) }),
  'coordinator.stop': z.strictObject({ delegated: z.boolean() }),
  'coordinator.answer': z.strictObject({ answered: z.literal(true) }),
  'coordinator.cancel': z.strictObject({ cancelled: z.literal(true) }),
};
const error = z.enum([
  'denied',
  'invalid',
  'busy',
  'not_found',
  'conflict',
  'too_large',
  'unknown',
]);
const failure = z.strictObject({ ok: z.literal(false), error });
const success = z.strictObject({
  ok: z.literal(true),
  value: z.union([
    relaySuccessSchemas['projects.list'],
    relaySuccessSchemas['coordinator.read'],
    relaySuccessSchemas['coordinator.send'],
    relaySuccessSchemas['coordinator.watch'],
    relaySuccessSchemas['coordinator.stop'],
    relaySuccessSchemas['coordinator.answer'],
    relaySuccessSchemas['coordinator.cancel'],
  ]),
});
export const relayResultSchema = z.union([success, failure]).refine(payloadFits);
export type RelayResult = z.infer<typeof relayResultSchema>;

export function parseRelayResult(op: RelayRequest['op'], value: unknown): RelayResult {
  const result = relayResultSchema.parse(value);
  if (result.ok) relaySuccessSchemas[op].parse(result.value);
  return result;
}

const envelope = { v: z.literal(1) };
const correlated = { ...envelope, id: uuid };
const connection = { ...envelope, connectionId: uuid };
const admission = { ...correlated, connectionId: uuid };
const drop = z.strictObject({ ...connection, type: z.literal('drop') });

export const relayHostFrameSchema = z.discriminatedUnion('type', [
  z.strictObject({
    ...correlated,
    type: z.literal('grant.put'),
    digest,
    expiresAt: positiveInteger,
  }),
  z.strictObject({
    ...correlated,
    type: z.literal('paired'),
    deviceId: recordId,
    sessionToken: digest,
    expiresAt: positiveInteger,
  }),
  z.strictObject({
    ...admission,
    type: z.literal('admitted'),
    deviceId: recordId,
    expiresAt: positiveInteger,
  }),
  z.strictObject({ ...admission, type: z.literal('admit.committed') }),
  drop,
  z.strictObject({ ...correlated, type: z.literal('result'), result: relayResultSchema }),
  z.strictObject({ ...connection, type: z.literal('changed') }),
  z.strictObject({
    ...correlated,
    type: z.literal('failed'),
    error: z.enum(['denied', 'busy', 'invalid', 'too_large', 'unknown']),
  }),
]);
export type RelayHostFrame = z.infer<typeof relayHostFrameSchema>;

export const relayControlFrameSchema = z.discriminatedUnion('type', [
  z.strictObject({
    ...envelope,
    type: z.literal('host.ready'),
    epoch: uuid,
    expiresAt: positiveInteger,
  }),
  z.strictObject({ ...correlated, type: z.literal('grant.ack'), ok: z.boolean() }),
  z.strictObject({
    ...correlated,
    type: z.literal('pair'),
    ...relayPairBodySchema.shape,
    deadlineAt: positiveInteger,
  }),
  z.strictObject({
    ...admission,
    type: z.literal('admit'),
    sessionToken: digest,
    deadlineAt: positiveInteger,
  }),
  z.strictObject({
    ...admission,
    type: z.literal('admit.commit'),
    expiresAt: positiveInteger,
  }),
  drop,
  z.strictObject({
    ...admission,
    type: z.literal('call'),
    deadlineAt: positiveInteger,
    request: relayRequestSchema,
  }),
]);
export type RelayControlFrame = z.infer<typeof relayControlFrameSchema>;

export const relayClientFrameSchema = z.strictObject({
  ...envelope,
  type: z.literal('request'),
  seq: positiveInteger,
  request: relayRequestSchema,
});
export const relayBrowserFrameSchema = z.discriminatedUnion('type', [
  z.strictObject({
    ...connection,
    type: z.literal('client.ready'),
    expiresAt: positiveInteger,
  }),
  z.strictObject({
    ...envelope,
    type: z.literal('response'),
    seq: positiveInteger,
    result: relayResultSchema,
  }),
  z.strictObject({ ...envelope, type: z.literal('changed') }),
]);
export type RelayClientFrame = z.infer<typeof relayClientFrameSchema>;
export type RelayBrowserFrame = z.infer<typeof relayBrowserFrameSchema>;

export function parseRelayFrame<T>(schema: z.ZodType<T>, text: unknown): T {
  if (typeof text !== 'string' || encoder.encode(text).byteLength > RELAY_FRAME_BYTES) {
    throw new Error('invalid relay frame');
  }
  return schema.parse(JSON.parse(text));
}

export function serializeRelayFrame<T>(schema: z.ZodType<T>, value: T): string {
  const text = JSON.stringify(schema.parse(value));
  if (encoder.encode(text).byteLength > RELAY_FRAME_BYTES) throw new Error('invalid relay frame');
  return text;
}
