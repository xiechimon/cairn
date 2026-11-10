import { z } from 'zod';

export const categoryFreeTaskInputSchema = z.object({ tagIds: z.never().optional() }).passthrough();
