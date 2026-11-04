import { z } from 'zod';

export const diffHunkSchema = z.object({
  header: z.string(),
  lines: z.array(z.string()),
});

export const diffFileSchema = z.object({
  path: z.string(),
  additions: z.number().int(),
  deletions: z.number().int(),
  hunks: z.array(diffHunkSchema),
});
export type DocumentDiffFile = z.infer<typeof diffFileSchema>;

export const documentDiffSchema = z.object({
  fromVersion: z.number().int(),
  toVersion: z.number().int(),
  files: z.array(diffFileSchema),
});
export type DocumentDiff = z.infer<typeof documentDiffSchema>;

export const diffFileContentSchema = z.object({
  ref: z.string(),
  commit: z.string(),
  path: z.string(),
  size: z.number().int(),
  encoding: z.enum(['utf-8', 'base64']),
  content: z.string(),
});
export type DiffFileContent = z.infer<typeof diffFileContentSchema>;

export const DIFF_UI_COPY = {
  compareWith: '与其他版本对比…',
  previousVersion: '上一版本',
  expandAll: '全部展开',
  preview: '预览',
} as const;
