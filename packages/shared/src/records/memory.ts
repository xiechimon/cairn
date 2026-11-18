import { z } from 'zod';
import { epochMs, recordId } from './common.js';

export const MEMORY_LAYERS = ['core', 'scratchpad', 'searchable'] as const;
export type MemoryLayer = (typeof MEMORY_LAYERS)[number];

export const MEMORY_INDEX_TITLE = 'MEMORY.md';
export const MEMORY_INDEX_ID_PREFIX = 'memory-index:';

export const MEMORY_TOOLS = ['save_memory', 'update_memory', 'delete_memory', 'memories'] as const;

export const memoryRecordSchema = z.object({
  id: recordId,
  agentId: recordId,
  teamId: recordId,
  title: z.string(),
  content: z.string(),
  projectId: recordId.nullable(),
  sourceTodoId: recordId.nullable(),
  sourceBuildId: z.string().nullable(),
  source: z.string().nullable().optional(),
  layer: z.enum(MEMORY_LAYERS).optional(),
  threadId: recordId.nullable().optional(),
  createdAt: epochMs,
  updatedAt: epochMs,
  invalidAt: epochMs.nullable().optional(),
  supersededBy: recordId.nullable().optional(),
  lastInjectedAt: epochMs.nullable().optional(),
  history: z
    .array(z.object({ title: z.string(), content: z.string(), updatedAt: epochMs }))
    .optional(),
});
export type MemoryRecord = z.infer<typeof memoryRecordSchema>;

export const MEMORY_UI_COPY = {
  searchPlaceholder: '搜索记忆…',
  sort: '排序',
  sourceLink: '来源任务',
} as const;

export const patchMemoryBodySchema = z
  .object({
    content: z.string().optional(),
    title: z
      .string()
      .min(1)
      .max(1024)
      .regex(/^[^\r\n\0]+$/)
      .optional(),
  })
  .strict()
  .refine((body) => body.content !== undefined || body.title !== undefined, {
    message: 'no memory edit provided',
  });
export type PatchMemoryBody = z.infer<typeof patchMemoryBodySchema>;

export const MEMORY_EDIT_STATUSES = [
  'working',
  'awaiting_input',
  'done',
  'failed',
  'stopped',
  'partial',
] as const;
export type MemoryEditStatus = (typeof MEMORY_EDIT_STATUSES)[number];

export const memoryEditBodySchema = z
  .object({
    text: z.string().min(1).max(8192),
    file: z
      .string()
      .min(1)
      .max(1024)
      .regex(/^[^\r\n\0]+$/)
      .optional(),
    projectId: z.string().min(1).nullable().optional(),
    editId: z.string().min(1).optional(),
    attempt: z.number().int().positive().safe().optional(),
  })
  .strict();
export type MemoryEditBody = z.infer<typeof memoryEditBodySchema>;

export const memoryEditStopBodySchema = z
  .object({ attempt: z.number().int().positive().safe().optional() })
  .strict();
export type MemoryEditStopBody = z.infer<typeof memoryEditStopBodySchema>;

export const memoryEditReceiptRecordSchema = z.object({
  id: recordId,
  editId: recordId,
  callId: z.string(),
  tool: z.string(),
  scope: z.string().nullable(),
  file: z.string().nullable(),
  beforeVersion: z.string().nullable(),
  afterVersion: z.string().nullable(),
  before: z.string().nullable(),
  after: z.string().nullable(),
  summary: z.string(),
  createdAt: epochMs,
});
export type MemoryEditReceiptRecord = z.infer<typeof memoryEditReceiptRecordSchema>;

export const memoryEditRecordSchema = z.object({
  id: recordId,
  teamId: recordId,
  status: z.enum(MEMORY_EDIT_STATUSES),
  attempt: z.number().int(),
  instruction: z.string(),
  file: z.string().nullable(),
  projectId: z.string().nullable(),
  reply: z.string().nullable(),
  receipts: z.array(memoryEditReceiptRecordSchema),
  createdAt: epochMs,
  updatedAt: epochMs,
});
export type MemoryEditRecord = z.infer<typeof memoryEditRecordSchema>;

const memoryScopeParam = z
  .string()
  .min(1)
  .describe('"team" or a project id; workers may select only team/current project.');
const memoryFileParam = z
  .string()
  .min(1)
  .max(1024)
  .regex(/^[^\r\n\0]+$/)
  .describe('Exact memory file name; MEMORY.md is the always-loaded index.');
const memoryDocumentParams = z.object({ scope: memoryScopeParam, file: memoryFileParam }).strict();
const memoryMutationParams = memoryDocumentParams.extend({
  baseVersion: z.string().min(1).describe('Current document revision.'),
});
export const memoryToolParamsSchemas = {
  save_memory: memoryDocumentParams.extend({ content: z.string().describe('Full file text.') }),
  update_memory: memoryMutationParams.extend({
    content: z.string().optional().describe('Full text; empty clears the index.'),
    old_str: z.string().min(1).optional().describe('Exact unique text to replace.'),
    new_str: z.string().optional().describe('Replacement text, including empty string.'),
    moveTo: memoryScopeParam.optional(),
    renameTo: memoryFileParam.optional().describe('New file name; MEMORY.md is reserved.'),
    restoreVersion: z.string().min(1).optional().describe('Retained version id.'),
  }),
  delete_memory: memoryMutationParams,
  memories: memoryDocumentParams.partial().extend({
    offset: z
      .number()
      .int()
      .nonnegative()
      .safe()
      .optional()
      .describe('Non-negative offset from nextOffset.'),
    query: z.string().optional().describe('Space-separated search terms, all must match.'),
    versions: z
      .string()
      .min(1)
      .optional()
      .describe(
        '"list" lists retained earlier versions; a retained version id reads its paged full text with the current baseVersion.',
      ),
  }),
};
