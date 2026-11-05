import { z } from 'zod';

export const deployRecordSchema = z.object({
  sha: z.string().min(1),
  previous: z.string(),
  result: z.string().min(1),
  failed: z.string(),
  snapshot: z.string(),
  at: z.string(),
  host: z.string(),
});
export type DeployRecord = z.infer<typeof deployRecordSchema>;

export const deployStatusSchema = z.object({ deployed: deployRecordSchema.nullable() });
export type DeployStatus = z.infer<typeof deployStatusSchema>;
