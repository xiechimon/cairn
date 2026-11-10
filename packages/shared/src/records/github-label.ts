import { z } from 'zod';
import { epochMs, recordId } from './common.js';

export const githubLabelRecordSchema = z.object({
  id: recordId,
  projectId: recordId,
  name: z.string(),
  color: z.string(),
  createdAt: epochMs,
  v: z.number().int(),
});
export type GithubLabelRecord = z.infer<typeof githubLabelRecordSchema>;

export const GITHUB_LABEL_DEFAULT_COLOR = '#6366f1';
