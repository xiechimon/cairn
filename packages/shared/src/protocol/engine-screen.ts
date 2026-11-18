import { z } from 'zod';
import { epochMs, recordId } from '../records/common.js';

export const ENGINE_SCREEN_CAP_TTL_MS = 5 * 60_000;
export const ENGINE_TAKEOVER_LEASE_MS = 30 * 60_000;
export const ENGINE_SCREEN_MAX_BUFFER_BYTES = 8 * 1024 * 1024;
export const ENGINE_SCREEN_MAX_FRAME_BYTES = 256 * 1024;
export const ENGINE_SCROLLBACK_BYTES = 1024 * 1024;
export const ENGINE_SCROLLBACK_CHUNK_BYTES = 64 * 1024;
export const ENGINE_PTY_LOG_FILE_NAME = 'engine-pty.log';
export const ENGINE_PTY_LOG_MAX_BYTES = 4 * 1024 * 1024;
export const engineScreenKindSchema = z.enum(['view', 'takeover']);
export type EngineScreenKind = z.infer<typeof engineScreenKindSchema>;
export const engineScreenChannelIdSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const engineScreenRequestSchema = z
  .object({
    id: engineScreenChannelIdSchema,
    stepId: recordId,
    buildId: recordId,
    generation: z.number().int().nonnegative(),
    kind: engineScreenKindSchema,
    takeoverLeaseId: z.string().nullable(),
    takeoverFence: z.number().int().nonnegative(),
    fromSeq: z.number().int().nonnegative(),
    expiresAt: epochMs,
  })
  .strict()
  .refine((request) => request.kind === 'view' || request.takeoverLeaseId !== null);
export type EngineScreenRequest = z.infer<typeof engineScreenRequestSchema>;

export const openEngineScreenSchema = z
  .object({
    kind: engineScreenKindSchema,
    leaseId: z.string().min(1).max(200).optional(),
    fromSeq: z.number().int().nonnegative().optional(),
  })
  .strict();
export type OpenEngineScreen = z.infer<typeof openEngineScreenSchema>;

export const engineTakeoverLeaseSchema = z.object({
  leaseId: z.string().min(1).max(200),
  fence: z.number().int().nonnegative(),
  expiresAt: epochMs,
});
export type EngineTakeoverLease = z.infer<typeof engineTakeoverLeaseSchema>;
