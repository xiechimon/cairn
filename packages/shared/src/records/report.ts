import { z } from 'zod';

export const REPORT_FILE_NAME = 'report.md';
export const INFO_REPORT_MAX_BYTES = 512 * 1024;
export const infoReportMessageSchema = z.object({
  kind: z.literal('info-report'),
  attachmentId: z.string(),
  attachmentToken: z.string(),
  content: z.string(),
});
