import { z } from 'zod';
import { thinkingLevelSchema } from '../thinking-levels.js';

export const capabilitiesResponseSchema = z.object({
  thinkingLevels: z.array(thinkingLevelSchema),
  githubOAuth: z.boolean(),
  githubDeviceInstallUrl: z.string().nullable(),
});
export type CapabilitiesResponse = z.infer<typeof capabilitiesResponseSchema>;
