import { z } from 'zod';
import { thinkingLevelSchema } from '../agent-backend.js';

export const capabilitiesResponseSchema = z.object({
  thinkingLevels: z.array(thinkingLevelSchema),
});
export type CapabilitiesResponse = z.infer<typeof capabilitiesResponseSchema>;
