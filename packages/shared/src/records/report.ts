import { z } from 'zod';

export const REPORT_FILE_NAME = 'report.md';
export const INFO_REPORT_MAX_BYTES = 512 * 1024;
export const infoReportMessageSchema = z.object({
  kind: z.literal('info-report'),
  attachmentId: z.string(),
  attachmentToken: z.string(),
  content: z.string(),
});

export type InfoReportMessage = z.infer<typeof infoReportMessageSchema>;

export const deliverablesMessageSchema = z.object({
  kind: z.literal('deliverables'),
  items: z.array(
    z.object({
      attachmentId: z.string(),
      kind: z.enum(['page', 'slides']),
      name: z.string(),
      sizeBytes: z.number().int().min(0),
      attachmentToken: z.string(),
    }),
  ),
});

export type DeliverablesMessage = z.infer<typeof deliverablesMessageSchema>;
