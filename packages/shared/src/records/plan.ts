import { z } from 'zod';
import { epochMs, recordId } from './common.js';

export const PLAN_FILE_NAME = 'plan.md';

export const planRecordSchema = z.object({
  id: recordId,
  buildId: recordId,
  version: z.number().int().min(1),
  createdAt: epochMs,
});
export type PlanRecord = z.infer<typeof planRecordSchema>;

export const planRowSchema = planRecordSchema.extend({
  content: z.string(),
});
export type PlanRow = z.infer<typeof planRowSchema>;

export {
  checkPlanContract,
  PLAN_SECTIONS,
  type PlanContractCheck,
  planVerificationItems,
} from './merge-gate.js';
