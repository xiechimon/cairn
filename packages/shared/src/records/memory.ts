import { z } from 'zod';
import { epochMs, recordId } from './common.js';

export const MEMORY_QUOTA_PER_AGENT = 100;

export const MEMORY_TOOLS = ['save_memory', 'update_memory', 'delete_memory', 'memories'] as const;

export const MEMORY_EMPTY_COPY = '尚无记忆。Agent 会在工作中将值得沉淀的经验存入此处。';

export const memoryRecordSchema = z.object({
  id: recordId,
  agentId: recordId,
  teamId: recordId,
  title: z.string(),
  content: z.string(),
  projectId: recordId.nullable(),
  sourceTodoId: recordId.nullable(),
  sourceBuildId: z.string().nullable(),
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
