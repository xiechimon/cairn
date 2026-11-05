import { z } from 'zod';
import { epochMs, recordId } from '../records/common.js';

export const COMPUTER_SCREEN_CAP_TTL_MS = 5 * 60_000;
export const COMPUTER_CONTROL_LEASE_MS = 30 * 60_000;
export const COMPUTER_SCREEN_MAX_BUFFER_BYTES = 8 * 1024 * 1024;
export const COMPUTER_SCREEN_MAX_FRAME_BYTES = 1024 * 1024;
export const computerScreenKindSchema = z.enum(['view', 'control', 'terminal']);
export type ComputerScreenKind = z.infer<typeof computerScreenKindSchema>;
export const computerScreenChannelIdSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const computerScreenRequestSchema = z
  .object({
    id: computerScreenChannelIdSchema,
    computerId: recordId,
    scopeKey: z.string().min(1).max(200),
    generation: z.number().int().nonnegative(),
    kind: computerScreenKindSchema,
    expiresAt: epochMs,
    controlLeaseId: z.string().nullable(),
    controlFence: z.number().int().nonnegative(),
  })
  .strict()
  .refine((request) => request.kind === 'view' || request.controlLeaseId !== null);
export type ComputerScreenRequest = z.infer<typeof computerScreenRequestSchema>;

export const openComputerScreenSchema = z
  .object({
    kind: computerScreenKindSchema,
    leaseId: z.string().min(1).max(200).optional(),
  })
  .strict();
export type OpenComputerScreen = z.infer<typeof openComputerScreenSchema>;

export const computerControlLeaseSchema = z.object({
  leaseId: z.string().min(1).max(200),
  expiresAt: epochMs,
  controlFence: z.number().int().nonnegative(),
});
export type ComputerControlLease = z.infer<typeof computerControlLeaseSchema>;
