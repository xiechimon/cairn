import { z } from 'zod';

export const deliverableKindSchema = z.enum(['page', 'slides', 'image']);
export type DeliverableKind = z.infer<typeof deliverableKindSchema>;

export const DELIVERABLES_MESSAGE_PREFIX = 'deliverables-';
export const REPORT_FILE_NAME = 'report.md';
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
      kind: deliverableKindSchema,
      name: z.string(),
      sizeBytes: z.number().int().min(0),
      attachmentToken: z.string(),
    }),
  ),
  skipped: z.array(z.object({ name: z.string(), reason: z.string() })),
});

export type DeliverablesMessage = z.infer<typeof deliverablesMessageSchema>;
