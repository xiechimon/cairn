import { z } from 'zod';

export const whatsNewRecordSchema = z.record(z.string(), z.unknown());
export type WhatsNewRecord = z.infer<typeof whatsNewRecordSchema>;
